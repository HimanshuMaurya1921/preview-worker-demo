# AI Studio Next.js Runtime (WebContainer)

A high-performance, client-side runtime for AI-generated Next.js applications. This project replaces server-side K8s/Docker previews with a near-instant browser-based environment.

## 🚀 Quick Start

### 0. Setup Runtime Template
The snapshot needs a source directory (`template`) with Next.js and React installed. This forms the base layer for the container.
```bash
cd template
# Install dependencies (this creates the critical node_modules layer)
npm install 
cd ..
```

### 1. Prerequisite: Snapshot Generation
Generate the binary chunks that the browser will download to "boot" the container.
```bash
# From the root directory
node scripts/generate-binary-chunks.js
```
This will create `manifest.json` and `.wasm` chunks in `frontend/public/snapshot/`.

### 2. Start the Backend (AI Code Generator)
The backend simulates an AI engine that provides the Next.js file structure.
```bash
cd backend
npm install
npm start
```

### 3. Start the Frontend (AI Studio UI)
The frontend orchestrates the WebContainer and displays the preview.
```bash
cd frontend
npm install
npm run dev
```
Visit `http://localhost:5173`.

---

## 🏗️ Project Structure

*   `frontend/`: React application with WebContainer integration and Telemetry.
*   `backend/`: Express server providing the AI-generated code template.
*   `packages/webcontainer-runtime/`: The modular SDK containing:
    *   **Core Client**: Handles proactive boot and process spawning.
    *   **Snapshot Loader**: Manages binary chunk restoration and OPFS caching.
    *   **Normalizer**: Enforces security guardrails and differential patching.
    *   **React Hook**: Easy integration for standard UI components.

---

## ⚡ Key Features

*   **1-3s Warm Starts**: Proactive background booting of the WebContainer.
*   **OPFS Caching**: Persistent local storage of the 100MB+ `node_modules` layer.
*   **Layered Patching**: Differential file updates preserve Next.js HMR state.
*   **Guardrails**: AI cannot modify sensitive files (e.g., `package.json`, `.env`).

---

## 📖 Further Documentation

For a detailed guide on how to integrate this runtime into your own full-stack project, see:
👉 [**STEPS-README.md**](./STEPS-README.md)

For a deep dive into the architecture and performance metrics, see:
👉 [**walkthrough.md**](./packages/webcontainer-runtime/walkthrough.md)
