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
docker build --platform linux/amd64 -t $WORKER_IMAGE ./preview-worker
docker push $WORKER_IMAGE

# Build and Push Orchestrator
docker build --platform linux/amd64 -t $ORCH_IMAGE ./orchestrator
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

# 3. Apply RBAC, Network Policy, and Redis
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/network-policy.yaml
kubectl apply -f k8s/redis.yaml

# 4. Deploy Orchestrator
# (Make sure to update the image paths in orchestrator-deployment.yaml)
kubectl apply -f k8s/orchestrator-deployment.yaml
```

## 6. Resource Configuration
The system is optimized for high-density Next.js workloads. We recommend a "bursty" configuration to balance performance and cost:
- **Requests**: 0.5 CPU / 512Mi RAM
- **Limits**: 1.0 CPU / 1Gi RAM
- **Storage**: 2Gi `emptyDir` (Memory) for high-speed workspace I/O.

## 7. Production Networking Considerations

### 6.1 Session Affinity (Sticky Sessions)
The Orchestrator uses a `preview-worker-id` cookie to route Next.js assets to the correct pod.
- **Ingress**: If you use an Ingress Controller (like NGINX or GCE), ensure you enable **Session Affinity** based on cookies.
- **HTTPS**: Since cookies are used, ensure your Ingress is configured with SSL (Managed Certificates) so that `SameSite=Lax` cookies work correctly in modern browsers.

### 6.2 WebSocket Support
Next.js HMR uses WebSockets. Your GKE Load Balancer or Ingress must have WebSockets enabled (standard on GCE Ingress, but may require timeout adjustments).

## 8. Management
- **Scale Workers**: Update the `preview-pool` autoscaling limits.
- **Logs**: Use `kubectl logs -n preview <pod-name>` or Google Cloud Logging.
- **Check Status**: `kubectl get all -n preview`
