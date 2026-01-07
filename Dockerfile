# Use the official Bun image
FROM oven/bun:1.1-alpine

# Set working directory
WORKDIR /app

# Copy the script
COPY latency-test.ts .

# Install dependencies? None needed, Bun has built-in fetch.

# Allow passing a REGION env var for logging purposes
ENV REGION="Local"

# Run the test
CMD ["bun", "run", "latency-test.ts"]