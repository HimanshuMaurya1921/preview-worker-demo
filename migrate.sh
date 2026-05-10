#!/bin/bash
set -e

echo "Creating directories..."
mkdir -p orchestrator/src preview-worker

echo "Creating .dockerignore files..."
echo -e "node_modules\n.env\n.git" > orchestrator/.dockerignore
echo -e "node_modules\n.env\n.git" > preview-worker/.dockerignore

echo "Moving Orchestrator files..."
mv worker/server.js orchestrator/src/
mv worker/preview-system/orchestrator/* orchestrator/src/
mv worker/Dockerfile.orchestrator orchestrator/Dockerfile
mv worker/.env.example orchestrator/

echo "Updating Orchestrator imports..."
# server.js imports orchestrator/index.js from './preview-system/orchestrator/index'
sed -i "s|require('./preview-system/orchestrator/index')|require('./index')|g" orchestrator/src/server.js

# Dockerfile needs to be updated to copy package.json and src
sed -i "s|CMD \\[\"node\", \"server.js\"\\]|CMD [\"node\", \"src/server.js\"]|g" orchestrator/Dockerfile

echo "Moving Preview Worker files..."
mv worker/preview-system/preview-worker/* preview-worker/
mv worker/Dockerfile preview-worker/Dockerfile

echo "Updating Preview Worker Dockerfile..."
# Dockerfile originally did: COPY preview-system/preview-worker/template ./template
# Now the template is right next to it.
sed -i "s|COPY preview-system/preview-worker/template ./template|COPY template ./template|g" preview-worker/Dockerfile
sed -i "s|COPY preview-system/preview-worker/worker.js ./|COPY worker.js ./|g" preview-worker/Dockerfile

echo "Removing deprecated files..."
rm worker/docker-compose.yml || true

echo "Cleaning up old worker directory..."
rm -rf worker/

echo "Migration complete!"
