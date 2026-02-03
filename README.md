# Polymarket CLOB Latency Test

This tool measures the HTTP latency of the Polymarket CLOB (Limit Order Book) API.

## Prerequisites

- **Docker** installed on your machine.
- (Optional) A valid Polymarket `TOKEN_ID` if you want to bypass market discovery.

## 1. Build the Image

Run the following command in the project root:

```bash
docker build -t latency-test .
```

## 2. Run the Test

### Standard Mode (Auto-Discovery)
This mode uses the Gamma API (Indexer) to find an active market, then tests CLOB latency against it.

```bash
docker run --rm -e REGION="Local" latency-test
```

### Strict Mode (CLOB Only)
To avoid *any* calls to the Gamma API, provide a known valid `TOKEN_ID`. The script will only hit `clob.polymarket.com`.

```bash
# Example Token ID (You must provide a valid active ID)
docker run --rm -e REGION="Local" -e TOKEN_ID="YOUR_TOKEN_ID_HERE" latency-test
```

## 3. Saving Results

The container saves results to a JSON file inside `/app`. To access these files on your host machine, mount the current directory:

```bash
docker run --rm -v $(pwd):/app -e REGION="Local" latency-test
```

## Output

The tool will print a summary table to the console:

```text
┌───────────────┬─────────┬───────┬───────┬───────┬────────┐
│ (index)       │ samples │ min   │ mean  │ p95   │ status │
├───────────────┼─────────┼───────┼───────┼───────┼────────┤
│ CLOB Book     │ 30      │ 45.20 │ 52.10 │ 65.40 │ 'OK'   │
│ CLOB Price    │ 30      │ 42.10 │ 48.30 │ 58.90 │ 'OK'   │
│ CLOB Midpoint │ 30      │ 40.00 │ 45.50 │ 55.20 │ 'OK'   │
└───────────────┴─────────┴───────┴───────┴───────┴────────┘
```
