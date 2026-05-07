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
# Build Worker (Next.js runner)
docker build -t preview-worker:local ./worker

# Build Orchestrator (K8s API client)
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
npm run dev
```

### 3.2 Start Frontend
Ensure your Frontend is configured to use `http://localhost:3001` for previews.
```bash
cd frontend
npm install
npm run dev
```

## 4. End-to-End Verification

1. **Open Browser**: Go to the local Frontend URL.
2. **Generate Code**: Trigger an AI generation.
3. **Sticky Session Verification**:
    - The first time you hit the preview, the Orchestrator sets a `preview-worker-id` cookie.
    - All subsequent requests for `/_next/static`, `/api`, and WebSockets (HMR) will be routed automatically to your specific pod.
4. **Verify Orchestration**:
    - Watch pods in KIND: `kubectl get pods -n preview -w`
    - You should see a `preview-xxxxx` pod transition from `Pending` -> `ContainerCreating` -> `Running`.

## 5. Heavy Testing (Stress Suite)

### 5.1 Queue & Backpressure
- Start 10 preview sessions.
- Verify that pods remain `Pending` if they exceed node capacity, and start automatically as old ones are deleted.

### 5.2 TTL Reaper Test
1. Manually age a pod:
   ```bash
   kubectl annotate pod <pod-name> -n preview created-at=1609459200000 --overwrite
   ```
2. Wait for the CronJob (runs every minute) or trigger manually:
   ```bash
   kubectl create job --from=cronjob/preview-pod-ttl-cleanup manual-cleanup -n preview
   ```

### 5.3 Liveness Probe Recovery
1. Kill the node process inside a pod:
   ```bash
   kubectl exec -n preview <pod-name> -- pkill -9 node
   ```
2. Verify the pod status changes to `Error` and eventually get reaped.

## 🛠 Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `CreateContainerConfigError` | Missing secret in `default` namespace | Run the `kubectl create secret` command in step 1.3 |
| `Completed` Status on Workers | `node_modules` missing in `/workspace` | Ensure you ran `docker build` AFTER the symlink fix in `worker.js` |
| 404 for `_next/static` | Cookie missing or proxy misconfigured | Clear your cookies for `localhost:3001` and reload the preview URL |
| `MODULE_NOT_FOUND` | Dependency missing in `package.json` | Ensure `@kubernetes/client-node` and `cookie-parser` are in `worker/package.json` |
