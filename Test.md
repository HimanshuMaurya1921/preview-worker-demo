# Full System Test Guide (Hybrid Host + KIND)

This guide covers the complete end-to-end testing flow for the GKE-migrated architecture using a local KIND cluster and host-based applications.

## 1. Infrastructure Setup (KIND)

### 1.1 Create Cluster
```bash
# Create cluster with tainted node pools for workers
kind create cluster --name ai-studio --config kind-config.yaml
```

### 1.2 Build & Load Images
```bash
# Build Worker
docker build -t preview-worker:local ./worker

# Build Orchestrator
docker build -t orchestrator:local -f ./worker/Dockerfile.orchestrator ./worker

# Load into KIND
kind load docker-image preview-worker:local --name ai-studio
kind load docker-image orchestrator:local --name ai-studio
```

### 1.3 Create Secrets (Development)
We need the same secret in both namespaces: one for the Orchestrator (default) and one for the Workers (preview).

```bash
# Create for Orchestrator (default namespace)
kubectl create secret generic preview-worker-secret \
  --from-literal=auth-token=local-dev-token \
  --namespace=default

# Create for Workers (preview namespace)
kubectl create secret generic preview-worker-secret \
  --from-literal=auth-token=local-dev-token \
  --namespace=preview
```

### 1.4 Deploy K8s Resources
```bash
# Apply all manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/network-policy.yaml
kubectl apply -f k8s/cronjob.yaml
kubectl apply -f k8s/orchestrator-deployment.yaml

# Wait for Orchestrator to boot
kubectl wait --for=condition=available deployment/orchestrator --timeout=60s
```

## 2. Connectivity (Bridging Host to KIND)

Run this in a **dedicated terminal** to expose the Orchestrator to your host applications:
```bash
# Map KIND Orchestrator to localhost:3001
kubectl port-forward svc/orchestrator 3001:80
```

## 3. Running Local Applications

### 3.1 Start Main Backend
```bash
cd backend
npm install
npm run dev # Typically runs on port 3000 or 4000
```

### 3.2 Start Frontend
Ensure your Frontend is configured to use `http://localhost:3001` for previews.
```bash
cd frontend
npm install
npm run dev # Typically runs on port 5173 or 3000
```

## 4. End-to-End Verification

1. **Open Browser**: Go to the local Frontend URL.
2. **Generate Code**: Trigger an AI generation.
3. **Verify Orchestration**:
    - Watch pods in KIND: `kubectl get pods -n preview -w`
    - You should see a `preview-xxxxx` pod transition from `Pending` -> `ContainerCreating` -> `Running`.
4. **View Preview**: The iframe in your frontend should load the Next.js app served from inside the KIND pod.

## 5. Heavy Testing (Stress Suite)

### 5.1 Queue & Backpressure
- Start 10 preview sessions.
- Verify that pods remain `Pending` if they exceed node capacity, and start automatically as old ones are deleted.

### 5.2 TTL Reaper Test
1. Manually age a pod:
   ```bash
   kubectl annotate pod <pod-name> -n preview created-at=1609459200000 --overwrite
   ```
2. Wait 2 minutes or trigger the job manually:
   ```bash
   kubectl create job --from=cronjob/preview-pod-ttl-cleanup manual-cleanup -n preview
   ```
3. Verify the pod is deleted.

### 5.3 Liveness Probe Recovery
1. Kill the node process inside a pod:
   ```bash
   kubectl exec -n preview <pod-name> -- pkill -9 node
   ```
2. Verify the pod status changes to `Error` and eventually get reaped (since `restartPolicy: Never`).
