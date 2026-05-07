# KIND Local Development Setup

This guide covers setting up a local Kubernetes-in-Docker (KIND) cluster to test the AI Studio Preview system with full production parity.

## 1. Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- [KIND](https://kind.sigs.k8s.io/docs/user/quick-start/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [jq](https://stedolan.github.io/jq/download/) (for TTL cleanup monitoring)

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

# Load into KIND
kind load docker-image preview-worker:local --name ai-studio
kind load docker-image orchestrator:local --name ai-studio
```

## 4. Deployment
Apply the Kubernetes manifests:
```bash
# 1. Create namespaces and RBAC
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/rbac.yaml

# 2. Create Secrets (Development)
kubectl create secret generic preview-worker-secret --from-literal=auth-token=local-dev-token -n default
kubectl create secret generic preview-worker-secret --from-literal=auth-token=local-dev-token -n preview

# 3. Deploy Orchestrator and policies
kubectl apply -f k8s/network-policy.yaml
kubectl apply -f k8s/cronjob.yaml
kubectl apply -f k8s/orchestrator-deployment.yaml
```

## 5. Connecting the Host
Since the Orchestrator runs inside KIND, you need to "bridge" it to your local machine:
```bash
# In a dedicated terminal
kubectl port-forward svc/orchestrator 3001:80
```

## 6. Development Workflow

### 6.1 Sticky Sessions
The Orchestrator uses a **Sticky Session** logic to handle Next.js assets (`/_next/static`, etc.).
- When you hit a preview URL for the first time, a `preview-worker-id` cookie is set.
- This cookie allows the Orchestrator to route absolute asset paths to the correct worker pod.
- **Tip**: If you see 404s for assets, clear your cookies for `localhost:3001` and reload the preview.

### 6.2 WebSocket / HMR
The proxy is configured to support WebSockets. This allows **Hot Module Replacement** (live reloading) to work inside the preview frame just like it does in local development.

## 7. Verification Tests

### 7.1 Personalization Test
1. Start your local Frontend (`npm run dev`) and Backend (`node server.js`).
2. Type a name in the frontend input.
3. Click "Generate Next.js Demo".
4. **Verify**: The preview should display your name and the API response should contain your personalized greeting.

### 7.2 TTL Cleanup Test
1. Trigger a preview.
2. Wait for the pod to expire (default 3 minutes in `cronjob.yaml`).
3. Verify the pod is deleted: `kubectl get pods -n preview`.

### 7.3 Network Isolation Test
1. Find a worker pod: `kubectl get pods -n preview`
2. Try to hit your local backend from inside the pod:
   ```bash
   kubectl exec -n preview <pod-name> -- curl http://host.docker.internal:3000/health
   ```
3. **Verify**: The request should fail/timeout, confirming the `NetworkPolicy` is active.

## 8. Cleanup
```bash
kind delete cluster --name ai-studio
```
