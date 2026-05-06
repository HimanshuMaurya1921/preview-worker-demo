FROM node:18-bullseye-slim

# Install system utilities needed by the worker
RUN apt-get update && apt-get install -y tar procps && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package configuration
COPY package*.json ./

# Install only production dependencies for the Orchestrator
RUN npm install --omit=dev

# Copy all worker source files
COPY . .

# Optimization: Pre-extract the Next.js template node_modules into a central location
# This avoids doing 'tar -xzf' per worker, saving massive CPU and IO.
RUN mkdir -p /app/central_modules && \
    if [ -f /app/preview-system/preview-worker/node_modules-snapshot.tar.gz ]; then \
        tar -xzf /app/preview-system/preview-worker/node_modules-snapshot.tar.gz -C /app/central_modules; \
    fi

# Secure the container
RUN chown -R node:node /app
USER node

# Expose ports
EXPOSE 3001
EXPOSE 4000-4100

# Set production environment variables
ENV WORKER_PORT=3001
ENV POOL_MIN=3
ENV POOL_MAX=25
ENV QUEUE_MAX=15
ENV PORT_BASE=4000
ENV SESSION_TTL_MS=300000
ENV BOOT_TIMEOUT_MS=60000

# Start the worker orchestrator
CMD ["node", "server.js"]
