FROM node:18-slim

# Install basic tools
RUN apt-get update && apt-get install -y curl tar procps && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy worker server files
COPY package.json ./
RUN npm install

# Copy the Next.js template
COPY template ./template

# Pre-install Next.js dependencies inside the template
# This runs during image build so workers don't npm install at runtime
WORKDIR /app/template
RUN npm install

# Go back to app root
WORKDIR /app

# Copy worker server files
COPY worker.js ./

# Create workspace directory
# In GKE this gets replaced by an emptyDir volume
# Locally this is just a regular folder
RUN mkdir -p /workspace

EXPOSE 3000

CMD ["node", "--expose-gc", "worker.js"]
