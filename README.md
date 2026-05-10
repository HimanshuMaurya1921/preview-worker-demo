# AI Studio Preview System (Refactored)

A high-performance, Kubernetes-native preview infrastructure for Next.js and Vite applications. This system allows you to spin up ephemeral sandbox environments for live previews with support for file injection and HMR.

## 🏗 Architecture

The system consists of three main components:

1.  **Frontend**: A React-based dashboard that generates code and manages preview sessions.
2.  **Orchestrator**: A thin Node.js session router that interacts with the Kubernetes API to manage preview pods. It uses Redis for state management.
3.  **Sandbox Worker**: A specialized container image that runs the Next.js dev server and handles live file injections.

```text
Browser Editor
    ↓ websocket / fetch
Thin Session Manager (Orchestrator)
    ↓
Kubernetes API / Redis
    ↓
Sandbox Pod (Worker)
    ↓
Vite/Next.js Dev Server
    ↓
Reverse Proxy (Sticky Session)
    ↓
iframe Preview
```

## 🚀 Key Features

- **Kubernetes-Native**: Leverages K8s for scheduling, resource isolation, and lifecycle management.
- **Atomic Project Swaps**: Implements a robust `Stop-Wipe-Inject-Restart` lifecycle (Worker v1.0.2+) to ensure 100% clean state between project updates.
- **Readiness-Aware Proxying**: The orchestrator automatically handles transient boot-up windows, serving a graceful "Syncing" state instead of proxy errors.
- **Memory Efficiency**: Optimized to run at a consistent **~60MB RSS baseline** with automated Garbage Collection.
- **Warm Pod Reuse**: Detects existing sessions for the same project/user to avoid cold start times.
- **High Performance**: Uses `emptyDir` (Memory) for workspace storage and optimized resource limits.

## 📁 Project Structure

- `/backend`: Sample code provider (React/Next.js templates).
- `/frontend`: The web interface with built-in readiness polling.
- `/orchestrator`: Session management and proxying logic.
- `/preview-worker`: The hardened sandbox runner (v1.0.2).
- `/k8s`: Kubernetes manifests for GKE/Kind.

## 🛠 Setup Guides

- [GKE Production Setup](./README-GKE-SETUP.md)
- [Local Development with Kind](./README-KIND-LOCAL-SETUP.md)
- [Frontend Development](./README-FRONTEND.md)

> [!IMPORTANT]
> All Kubernetes resources are deployed in the `preview` namespace. Always use the `-n preview` flag when running `kubectl` commands.

## ⚙️ Environment Variables (Orchestrator)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `RUNTIME` | `gke` or `local` | `local` |
| `REDIS_HOST` | Redis server address | `localhost` |
| `WORKER_IMAGE` | Docker image for the sandbox worker | `preview-worker:local` |
| `WORKER_AUTH_TOKEN` | Shared secret for internal communication | (auto-generated) |
| `SESSION_TTL_SECONDS` | How long to keep a session alive | `3600` |

## 🛡 Stability & Reliability (Senior Dev Note)

The system is now hardened against common Next.js/K8s issues:
1. **Zombie Processes**: Uses aggressive `pkill -9` cleanup during swaps.
2. **Port Resilience**: Includes a 500ms safety cooldown for port `3001` release.
3. **Readiness Polling**: The frontend waits for the `/__health` ready signal before showing the app.
