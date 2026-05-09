# 🎨 AI Studio Frontend

The Studio Frontend is a React application powered by Vite that orchestrates the WebContainer lifecycle, displays the AI-generated preview, and provide real-time telemetry.

## 🚀 Getting Started

### Installation
```bash
npm install
```

### Start Development Server
```bash
npm run dev
```
Visit `http://localhost:5173`.

---

## 🏗️ Architecture

### WebContainer Orchestration
The frontend uses the `@packages/webcontainer-runtime` SDK to:
1.  **Proactively Boot**: Start the container in the background as soon as the app loads.
2.  **Restore Snapshot**: Fetch binary chunks and restore the `node_modules` layer.
3.  **Patch Filesystem**: Receive file maps from the backend and write them to the container.

### UI Components
- **`PreviewFrame`**: An iframe wrapper that displays the running Next.js application.
- **`TelemetryOverlay`**: A real-time dashboard showing boot times, FS operations, and server status.
- **`CodeTerminal`**: A simulated terminal showing the Next.js build logs from within the container.

---

## ⚡ Performance Features

- **Parallel Asset Loading**: Binary chunks are fetched in parallel to saturate the network bandwidth.
- **OPFS Integration**: Leverages the Origin Private FileSystem for near-instant subsequent boots.
- **SharedArrayBuffer**: Requires `COOP`/`COEP` headers for multi-threaded performance.
