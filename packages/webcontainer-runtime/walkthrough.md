# 🔬 Technical Deep Dive: WebContainer AI Runtime

This document provides a detailed breakdown of the architectural decisions, performance benchmarks, and implementation strategies used to build the high-performance AI preview runtime.

---

## 🚀 Performance Benchmarks

The migration from server-side K8s to client-side WebContainers has yielded significant improvements in boot time and responsiveness.

| Metric | Server-Side (Legacy) | WebContainer (Current) | Delta |
| :--- | :--- | :--- | :--- |
| **Environment Provisioning** | 45-90s | **~1s** | ⬇️ 98% |
| **Initial Boot (Cold)** | 120s+ | **15.8s** | ⬇️ 86% |
| **Warm Start (Proactive)** | 10-15s | **2.4s** | ⬇️ 80% |

> [!IMPORTANT]
> The **2.4s Warm Start** is achieved through background booting. By the time the AI generation logic reaches the UI, the WebContainer is already running and ready to accept file patches.

---

## 🏗️ Core Architectural Pillars

### 1. Binary Chunking & Snapshot Restoration
To avoid the overhead of transferring 10,000+ small files (the `node_modules` layer), we use a binary snapshotting strategy:
- **`generate-binary-chunks.js`**: Prunes non-essential files (docs, tests, types) to reduce file count and size. It then bundles the remaining filesystem into 21 parallel-loadable `.wasm` chunks.
- **`snapshot-loader.js`**: Orchestrates the restoration. It leverages **OPFS (Origin Private FileSystem)** for persistent local caching, meaning subsequent boots skip the network entirely.

### 2. Intelligent Layered Patching
Instead of re-mounting the filesystem for every AI update, we use a differential patching model:
- The **Immutable Base** contains the Next.js framework and dependencies.
- The **Patch Layer** consists of the AI-generated code.
- Only files with changed content are written to the WebContainer filesystem, which preserves the **Next.js HMR (Hot Module Replacement)** state and prevents full page refreshes.

### 3. Security & Normalization Guardrails
The `AiOutputNormalizer` acts as a security middleware between the AI and the container:
- **Path Isolation**: Restricts AI writes to specific directories (`app/`, `components/`, etc.).
- **System Integrity**: Blocks modification of critical files like `package.json`, `next.config.js`, or `.env`.
- **Content Sanitization**: Automatically fixes common AI hallucinations in imports or configuration.

---

## ✅ Verification & Stability

Our automated validation suite ensures the runtime remains stable across generations:
- [x] **Binary Integrity**: Verified via `verify-snapshot.js` checksums.
- [x] **Proactive Boot**: Confirmed via internal telemetry metrics.
- [x] **Memory Management**: Efficient disposal of unused containers to prevent browser leaks.
- [x] **HMR Stability**: Confirmed that multiple patches do not break the Next.js dev server lifecycle.

---

<p align="center">
  <i>"Moving the compute to the edge, one preview at a time."</i>
</p>

