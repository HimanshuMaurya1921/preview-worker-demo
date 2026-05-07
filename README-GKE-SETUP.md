# GKE Setup Guide — AI Studio Preview System

This guide walks you through deploying the AI Studio Preview System to a production-grade GKE (Google Kubernetes Engine) cluster.

## 1. Prerequisites
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed and authenticated.
- `kubectl` installed.
- A Google Cloud Project with billing enabled.

## 2. Cluster Creation
We use two separate node pools to isolate the Orchestrator (API) from the bursty, memory-hungry Preview Workers.

```bash
# Set your project and region
export PROJECT_ID=$(gcloud config get-value project)
export REGION=us-central1
export CLUSTER_NAME=ai-studio-cluster

# 1. Create the cluster with the default pool (for Orchestrator)
gcloud container clusters create $CLUSTER_NAME \
  --region $REGION \
  --num-nodes 1 \
  --machine-type e2-standard-2 \
  --enable-autoscaling \
  --min-nodes 1 \
  --max-nodes 3

# 2. Add the specialized Preview Pool (Tainted)
gcloud container node-pools create preview-pool \
  --cluster $CLUSTER_NAME \
  --region $REGION \
  --num-nodes 1 \
  --machine-type e2-standard-4 \
  --node-taints workload=preview:NoSchedule \
  --node-labels workload=preview \
  --enable-autoscaling \
  --min-nodes 1 \
  --max-nodes 5
```

## 3. Image Registry Setup
We'll use Google Artifact Registry to host our Docker images.

```bash
# Create the repository
gcloud artifacts repositories create ai-studio \
  --repository-format=docker \
  --location=$REGION

# Configure Docker to use the registry
gcloud auth configure-docker ${REGION}-docker.pkg.dev
```

## 4. Build and Push Images
Build the images for the `linux/amd64` architecture used by GKE.

```bash
export WORKER_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/ai-studio/preview-worker:latest"
export ORCH_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/ai-studio/orchestrator:latest"

# Build and Push Worker
docker build --platform linux/amd64 -t $WORKER_IMAGE ./worker
docker push $WORKER_IMAGE

# Build and Push Orchestrator
# (Note: Use the worker directory as context or ensure package.json is correct)
docker build --platform linux/amd64 -t $ORCH_IMAGE ./worker --file worker/Dockerfile.orchestrator
docker push $ORCH_IMAGE
```

## 5. Deploy Kubernetes Resources
Apply the manifests in the `k8s/` directory.

```bash
# Connect kubectl to the cluster
gcloud container clusters get-credentials $CLUSTER_NAME --region $REGION

# 1. Create Namespace
kubectl apply -f k8s/namespace.yaml

# 2. Create Auth Secret
export AUTH_TOKEN=$(openssl rand -hex 32)
kubectl create secret generic preview-worker-secret \
  --from-literal=auth-token=$AUTH_TOKEN \
  --namespace=preview

# 3. Apply RBAC, Network Policy, and CronJob
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/network-policy.yaml
kubectl apply -f k8s/cronjob.yaml

# 4. Deploy Orchestrator
# Update the image fields in orchestrator-deployment.yaml first!
kubectl apply -f k8s/orchestrator-deployment.yaml
```

## 6. Verification
```bash
# Get the Orchestrator's External IP
kubectl get service orchestrator

# Watch preview pods being created in real-time
kubectl get pods -n preview -w
```

## 7. Management
- **Scale Workers**: Update the `preview-pool` autoscaling limits.
- **Logs**: Use `kubectl logs -n preview <pod-name>` or Google Cloud Logging.
- **Cleanup**: The `preview-ttl-cleanup` CronJob runs every 2 minutes to reap sessions older than 5 minutes.
