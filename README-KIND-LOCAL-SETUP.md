# KIND Local Development Setup

This guide covers setting up a local Kubernetes-in-Docker (KIND) cluster to test the AI Studio Preview system with full production parity.

## 1. Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- [KIND](https://kind.sigs.k8s.io/docs/user/quick-start/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)

## 2. Cluster Creation
Create a multi-node cluster with dedicated worker pools:
```bash
kind create cluster --name ai-studio --config kind-config.yaml
```

## 3. Image Preparation
Build and load the local images into the KIND nodes:
```bash
# Build Worker
docker build -t preview-worker:local ./worker

# Build Orchestrator
docker build -t orchestrator:local -f ./worker/Dockerfile.orchestrator ./worker

# Load into KIND (IMPORTANT: This makes images available to the cluster)
kind load docker-image preview-worker:local --name ai-studio
kind load docker-image orchestrator:local --name ai-studio
```

## 4. Deployment
Apply the Kubernetes manifests. **Note: We use the `preview` namespace for all resources.**

```bash
# 1. Create namespaces, RBAC, and Redis
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/redis.yaml

# 2. Create Secrets
kubectl create secret generic preview-worker-secret \
  --from-literal=auth-token=local-dev-token \
  -n preview

# 3. Deploy Orchestrator and policies
kubectl apply -f k8s/network-policy.yaml
kubectl apply -f k8s/orchestrator-deployment.yaml
```

## 5. Connecting to the Orchestrator
Since the Orchestrator runs inside the `preview` namespace in KIND, you must use the `-n preview` flag and port-forward the service:

```bash
# Port-forward the orchestrator service to localhost:3001
kubectl port-forward svc/orchestrator -n preview 3001:80
```

> [!TIP]
> If you see `ImagePullBackOff`, ensure you have run `kind load docker-image` and that `imagePullPolicy` is set to `IfNotPresent` in your deployment manifest.

## 6. Verification
1. Open the frontend: `cd frontend && npm run dev`
2. Ensure `VITE_WORKER_URL` is set to `http://localhost:3001`.
3. Check pod status: `kubectl get pods -n preview`

## 7. Cleanup
```bash
kind delete cluster --name ai-studio
```
