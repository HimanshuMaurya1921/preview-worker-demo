FROM node:18-bullseye-slim

# Install system utilities needed by the worker (tar and procps)
RUN apt-get update && apt-get install -y tar procps && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package configuration
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy all worker source files
COPY . .

# Secure the container by running as the built-in non-root 'node' user
RUN chown -R node:node /app
USER node

# Expose the Orchestrator port
EXPOSE 3001

# Expose the port range for the Next.js workers (Pool size config)
EXPOSE 4000-4050

# Set default environment variables
ENV WORKER_PORT=3001
ENV POOL_MIN=3
ENV POOL_MAX=10
ENV PORT_BASE=4000
ENV SESSION_TTL_MS=300000

# Start the worker orchestrator
CMD ["node", "server.js"]
