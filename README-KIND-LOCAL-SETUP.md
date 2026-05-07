# Local Setup Guide (KIND) — AI Studio Preview System

This guide explains how to run the full Kubernetes-based architecture on your local machine using **KIND (Kubernetes in Docker)**. This is the best way to test manifests and orchestrator logic before deploying to GKE.

## 1. Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.
- [KIND](https://kind.sigs.k8s.io/docs/user/quick-start/) installed.
- `kubectl` installed.

## 2. Create KIND Cluster
We'll create a cluster with a specific configuration that includes our "preview" node pool labels and taints.

```bash
# Create the KIND config
cat <<EOF > kind-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
- role: worker # Default pool for orchestrator
- role: worker # Preview pool
  kubeadmConfigPatches:
  - |
    kind: JoinConfiguration
    nodeRegistration:
      kubeletExtraArgs:
        node-labels: "workload=preview"
        register-with-taints: "workload=preview:NoSchedule"
EOF

# Create the cluster
kind create cluster --name ai-studio --config kind-config.yaml
```

## 3. Build and Load Images
KIND doesn't pull images from your local Docker registry by default; you must "load" them into the cluster.

```bash
# Build local images
docker build -t preview-worker:local ./worker
docker build -t orchestrator:local ./worker --file worker/Dockerfile.orchestrator

# Load images into KIND
kind load docker-image preview-worker:local --name ai-studio
kind load docker-image orchestrator:local --name ai-studio
```

## 4. Apply Kubernetes Manifests
Apply the same manifests used for GKE.

```bash
# 1. Create Namespace
kubectl apply -f k8s/namespace.yaml

# 2. Create Auth Secret
kubectl create secret generic preview-worker-secret \
  --from-literal=auth-token=local-dev-token \
  --namespace=preview

# 3. Apply RBAC, Network Policy, and CronJob
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/network-policy.yaml
kubectl apply -f k8s/cronjob.yaml

# 4. Deploy Orchestrator
# Make sure orchestrator-deployment.yaml uses the :local images and RUNTIME=gke
kubectl apply -f k8s/orchestrator-deployment.yaml
```

## 5. Access the System
Since we are local, we use port-forwarding to reach the Orchestrator.

```bash
# Forward traffic to the orchestrator service
kubectl port-forward svc/orchestrator 3001:80
```

Now you can point your frontend at `http://localhost:3001` or use `curl` to test.

## 7. Heavy Testing & Stress Validation
Before moving to GKE, run these tests to ensure the system is bulletproof.

### 7.1 Queue & Backpressure Test
Reduce the CPU/RAM on your KIND nodes or lower the `MAX_PREVIEW_PODS` to 2 in `orchestrator-deployment.yaml`.
1. Start 5 sessions in quick succession.
2. Run `kubectl get pods -n preview`.
3. **Verify**: You should see 2 pods `Running` and 3 pods `Pending`.
4. Delete one `Running` pod.
5. **Verify**: One `Pending` pod should immediately move to `Running`.

### 7.2 TTL Cleanup Verification
1. Start a session and wait for the pod to be `Running`.
2. Edit the pod's annotation:
   ```bash
   kubectl annotate pod <pod-name> -n preview created-at=1609459200000 --overwrite
   ```
3. Wait up to 2 minutes for the CronJob to trigger.
4. **Verify**: The pod should be deleted by the `preview-ttl-cleanup` job.

### 7.3 Network Isolation Test
1. Inject a file that tries to access a different pod's IP or the orchestrator's internal service.
2. **Verify**: The request should fail (timeout), proving the `NetworkPolicy` is active.

### 7.4 Liveness Probe Test
1. Find a running worker pod.
2. Kill the Next.js process:
   ```bash
   kubectl exec -n preview <pod-name> -- pkill -9 node
   ```
3. **Verify**: After ~30s, the pod status should show failure and eventually be reaped, confirming the liveness probe works.

## 8. Cleanup
```bash
kind delete cluster --name ai-studio
rm kind-config.yaml
```
