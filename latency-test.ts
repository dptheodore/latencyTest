import { format } from "util";

// --- CONFIGURATION ---
const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";
const ITERATIONS = 30; 
const SLEEP_MS = 250; 

// Headers (User-Agent is required to bypass Cloudflare WAF)
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "application/json"
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const percentile = (arr: number[], p: number) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
};

async function measureRequest(name: string, url: string, iteration: number) {
    const start = performance.now();
    let status = 0;
    let size = 0;
    let success = false;
    let errorMsg = "";

    try {
        const response = await fetch(url, { headers: HEADERS });
        status = response.status;
        
        if (response.ok) {
            const blob = await response.blob();
            size = blob.size;
            success = true;
        } else {
            const txt = await response.text();
            errorMsg = `HTTP ${status}: ${txt.slice(0, 50).replace(/[\n\r]/g, " ")}`;
        }
    } catch (error: any) {
        errorMsg = `NET: ${error.message}`;
    }

    return {
        id: iteration,
        type: name,
        timestamp: new Date().toISOString(),
        duration_ms: parseFloat((performance.now() - start).toFixed(2)),
        status: status,
        size_b: size,
        success: success ? "YES" : "NO",
        error_details: errorMsg
    };
}

// --- ROBUST DISCOVERY LOGIC ---
async function findValidMarket() {
    console.log("Step 1: Discovery (fetching top active markets)...");
    
    // Sort by volume to ensure liquidity exists
    const url = `${GAMMA_API}/events?limit=10&closed=false&order=volume24hr&ascending=false`;
    
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`Gamma API returned ${res.status}`);
    
    const events = await res.json();
    if (!Array.isArray(events) || events.length === 0) throw new Error("No events found");

    for (const event of events) {
        if (!event.markets || event.markets.length === 0) continue;
        
        const market = event.markets[0];
        
        // --- THE FIX: Handle Stringified JSON Arrays ---
        let rawIds = market.clobTokenIds; 
        
        // If it's a string like "['0x123']", parse it.
        if (typeof rawIds === 'string') {
            try {
                rawIds = JSON.parse(rawIds);
            } catch (e) {
                console.warn(`Failed to parse clobTokenIds for ${market.slug}`);
                continue;
            }
        }

        // Validate we have a real array now
        if (!Array.isArray(rawIds) || rawIds.length === 0) continue;

        const tokenId = rawIds[0]; // Grab the first outcome (usually "Yes" or "Candidate A")

        console.log(`[CANDIDATE] ${market.question}`);
        console.log(`           ID: ${tokenId.slice(0, 15)}...`);

        // PROBE: Verify CLOB accepts this ID
        const probeRes = await fetch(`${CLOB_API}/price?token_id=${tokenId}&side=buy`, { headers: HEADERS });
        
        if (probeRes.status === 200) {
            console.log(`[TARGET LOCKED] Validated on CLOB.`);
            return { tokenId, slug: event.slug, question: market.question };
        } else {
            console.log(`           Probe Failed (${probeRes.status}). Trying next...`);
        }
    }
    
    throw new Error("Could not find any market that responds to CLOB probes.");
}

async function run() {
    const region = process.env.REGION || "Unknown";
    const manualTokenId = process.env.TOKEN_ID;

    console.log(`--- Latency Test (Region: ${region}) ---`);

    let target;

    if (manualTokenId) {
        console.log(`[CONFIG] Using Manual Token ID: ${manualTokenId}`);
        console.log("Skipping Gamma API discovery...");
        
        // Validate manually provided ID against CLOB
        const probeRes = await fetch(`${CLOB_API}/price?token_id=${manualTokenId}&side=buy`, { headers: HEADERS });
        if (probeRes.status === 200) {
            console.log(`[TARGET LOCKED] Validated manual ID on CLOB.`);
            target = { tokenId: manualTokenId, slug: "manual-override", question: "Manual Token ID" };
        } else {
            console.error(`\nCRITICAL ERROR: Manual Token ID ${manualTokenId} is not responding on CLOB (Status: ${probeRes.status})`);
            return;
        }
    } else {
        try {
            target = await findValidMarket();
        } catch (e: any) {
            console.error(`\nCRITICAL ERROR: ${e.message}`);
            return;
        }
    }

    const { tokenId, slug } = target;
    console.log("-".repeat(60));

    // 2. DATA COLLECTION
    const allRequests: any[] = [];
    console.log(`Step 2: Running ${ITERATIONS} iterations...`);

    const clobBookUrl = `${CLOB_API}/book?token_id=${tokenId}`;
    const clobPriceUrl = `${CLOB_API}/price?token_id=${tokenId}&side=buy`;
    const clobMidUrl = `${CLOB_API}/midpoint?token_id=${tokenId}`;

    for (let i = 1; i <= ITERATIONS; i++) {
        process.stdout.write(`.`);
        
        allRequests.push(await measureRequest("CLOB Book", clobBookUrl, i));
        allRequests.push(await measureRequest("CLOB Price", clobPriceUrl, i));
        allRequests.push(await measureRequest("CLOB Midpoint", clobMidUrl, i));

        await sleep(SLEEP_MS);
    }
    console.log("\nDone.\n");

    // 3. METRICS
    const types = ["CLOB Book", "CLOB Price", "CLOB Midpoint"];
    const summary = types.map(t => {
        const relevant = allRequests.filter(r => r.type === t && r.success === "YES").map(r => r.duration_ms);
        
        if (relevant.length === 0) {
            const err = allRequests.find(r => r.type === t)?.error_details || "Unknown";
            return { type: t, status: "FAIL", error: err };
        }

        const sum = relevant.reduce((a, b) => a + b, 0);
        return {
            type: t,
            samples: relevant.length,
            min: Math.min(...relevant).toFixed(2),
            mean: (sum / relevant.length).toFixed(2),
            p95: percentile(relevant, 0.95).toFixed(2),
            status: "OK"
        };
    });

    console.table(summary);

    // 4. SAVE FILE
    const outputFilename = `latency_results_${region}_${Date.now()}.json`;
    await Bun.write(outputFilename, JSON.stringify({ 
        meta: { region, slug, tokenId, timestamp: new Date().toISOString() },
        summary, 
        detailed_log: allRequests 
    }, null, 2));
    
    console.log(`[SUCCESS] Saved to: ${outputFilename}`);
}

run();