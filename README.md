# 🚀 AI Studio Next.js Runtime (WebContainer)

[![WebContainer](https://img.shields.io/badge/Runtime-WebContainer-orange.svg)](https://webcontainers.io/)
[![Next.js](https://img.shields.io/badge/Framework-Next.js-black.svg)](https://nextjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

![AI Studio Runtime Hero](file:///home/dev/.gemini/antigravity/brain/a4e79d03-f6d5-47af-9eda-b1072b766226/webcontainer_runtime_hero_1778301561622.png)

A high-performance, client-side runtime for AI-generated Next.js applications. This project replaces traditional server-side K8s/Docker previews with a near-instant, browser-based environment powered by **StackBlitz WebContainers**.

---

## ✨ Key Features

- ⚡ **1-3s Warm Starts**: Proactive background booting ensures your preview is ready before the code even finishes generating.
- 📦 **OPFS Caching**: Persistent local storage of the `node_modules` layer (100MB+) using the Origin Private FileSystem.
- 🛠️ **Layered Patching**: Differential file updates preserve Next.js HMR state for a seamless editing experience.
- 🛡️ **Security Guardrails**: Intelligent normalization prevents AI from modifying sensitive system files.

---

## 🏗️ Project Structure

| Component | Description |
| :--- | :--- |
| [**frontend/**](./frontend) | React application orchestrating the WebContainer and Telemetry. |
| [**backend/**](./backend) | Express server simulating the AI code generation engine. |
| [**packages/webcontainer-runtime/**](./packages/webcontainer-runtime) | The core SDK powering the preview environment. |
| [**template/**](./template) | The base Next.js project used for snapshot generation. |

---

## 🚀 Quick Start

### 1. Setup Runtime Template
Initialize the source directory that forms the base layer for the container.
```bash
cd template
npm install 
cd ..
```

### 2. Generate Snapshot
Create the binary chunks that the browser will use to boot the container instantly.
```bash
node scripts/generate-binary-chunks.js
```

### 3. Launch the Stack
Start both the AI Backend and the Studio Frontend.

**Backend:**
```bash
cd backend && npm start
```

**Frontend:**
```bash
cd frontend && npm run dev
```

Visit [**http://localhost:5173**](http://localhost:5173) to see the magic.

---

## 📖 Documentation

- 🛠️ [**Integration Guide**](./STEPS-README.md) - How to use this runtime in your own stack.
- 🔬 [**Technical Walkthrough**](./packages/webcontainer-runtime/walkthrough.md) - Deep dive into architecture and performance.
- 📡 [**Backend API**](./backend/README.md) - Documentation for the AI generation service.
- 🎨 [**Frontend UI**](./frontend/README.md) - Details on the studio interface and telemetry.

---

<p align="center">
  Built with ❤️ for the next generation of AI development tools.
</p>

