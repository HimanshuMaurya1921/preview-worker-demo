# AI Studio Preview System - Local Architecture

This document explains exactly how the AI Studio Preview system works on your local machine. We'll trace the journey of a single click in the UI all the way down to a live Next.js preview, focusing heavily on the "magic" happening inside the Worker Pool.

---

## 🌊 Request Flow: From Click to Preview

Here is the visual text-based ASCII flow of the entire process:

```text
      [User Clicks "Generate Demo"]
                   │
                   ▼
       ┌───────────────────────┐
       │ React App (Vite UI)   │
       │ Fetches mock JSON     │
       └───────────┬───────────┘
                   │ POST /api/preview/start
                   ▼
       ┌───────────────────────┐
       │ Express Orchestrator  │
       │ (Runs on port 3000)   │
       └───────────┬───────────┘
                   │ 1. Gets a pre-warmed worker from WorkerPool
                   │ 2. Forwards code JSON to worker's port
                   ▼
       ┌───────────────────────┐         ┌───────────────────────┐
       │ Next.js Worker Node   │ ──────> │ Worker Pool Manager   │
       │ (e.g. port 4000)      │ Spawns  │ (Instantly replenishes│
       └───────────┬───────────┘ New     │  queue in background) │
                   │                     └───────────────────────┘
                   │ Flattens JSON and writes files
                   │ to disk (e.g., /tmp/ai-studio...)
                   ▼
       ┌───────────────────────┐
       │  Next.js Dev Server   │
       │ (Hidden port 14000)   │
       └───────────┬───────────┘
                   │ HMR detects new files on disk
                   │ and instantly compiles pages
                   ▼
       ┌───────────────────────┐
       │ Iframe (React App)    │
       │ Points to direct URL  │
       │ (http://localhost:4000)
       └───────────────────────┘
```

Here is the step-by-step breakdown of the flow above:

1. **The Click (React Frontend)**: You click the button in your Vite React app. 
2. **Fetching Mock Code**: The React app makes a `GET` request to the Express server (`http://localhost:3000/next-code`). The server returns a large JSON object containing the code for an entire Next.js project.
3. **Triggering the Preview**: The React app takes this JSON and passes it to the `<PreviewFrame>` component. The `usePreview` hook detects new code and sends a `POST` request to `http://localhost:3000/api/preview/start` with the code payload.

   > **💡 Why does the frontend fetch the code just to send it back to the backend?**  
   > This two-step process mimics a real AI Studio environment! In a real app, an AI model streams the generated code directly to the user's browser so they can see it being "typed" in the UI. Once the browser has the code, it sends the payload to the `/start` endpoint to boot up the live preview.

4. **The Orchestrator**: The Express server's orchestrator receives the `/start` request and immediately asks the `WorkerPool` for an available, pre-warmed Next.js worker.
5. **Code Injection**: The orchestrator takes the worker it received (let's say it's on port 4000) and forwards your JSON code payload to the worker's internal endpoint: `POST http://localhost:4000/__inject`.
6. **File Writing**: The worker script takes the JSON, flattens the nested folder structures, and writes the actual `.js` and `package.json` files to a temporary directory on your hard drive (e.g., `/tmp/ai-studio-w-1234`).
7. **The Live Reload**: Because the worker is already running `next dev` in that temporary directory, Next.js detects the new files, compiles them via Hot Module Replacement (HMR), and updates its server.
8. **The Iframe Render**: The `/start` request finishes and returns the worker's direct URL (`http://localhost:4000`) back to the React app. The iframe `src` is updated to this URL, and the live preview appears on your screen!

---

## 🧠 Deep Dive: How the Workers Do the Heavy Lifting

The secret to getting a 1-3 second Next.js boot time is that **we don't wait for Next.js to boot**. The system anticipates the request and prepares Next.js environments in the background.

Here is the breakdown of how the `WorkerPool.js` and `worker.js` scripts pull this off locally.

### 1. The Worker Pool (The Manager)
When you start `node backend/server.js`, the `WorkerPool` immediately spins up a minimum number of workers (by default, 3) before you even open your browser. 

* It assigns sequential ports to them (4000, 4001, 4002).
* It listens to their console output. Once a worker prints `Ready` or `started server on`, the Manager marks that worker as "warm" (ready to be used).
* When a user requests a preview, the Manager pops a worker out of the "warm" queue, hands it to the user, and immediately spawns a *new* worker in the background to replace the one that was just taken. This ensures there are always 3 warm workers waiting.

### 2. The Worker Script (The Engine)
Each individual worker is managed by `worker.js`. When the Manager spawns a worker, it does several things in a fraction of a second:

* **Creates an Isolated Workspace**: It creates a unique temporary folder in your OS (like `/tmp/ai-studio-w-abcd`) by recursively copying our generic Next.js `template/` folder.
* **The Snapshot Mechanism (Zero `npm install` wait time)**: Normally, running `npm install` for Next.js takes 20 to 60 seconds because it has to download thousands of files. To bypass this, we use a snapshot strategy:
  * **Compression**: Before you even start the server, we generated a `node_modules-snapshot.tar.gz` file. This is a highly compressed archive of a fully installed `node_modules` folder.
  * **Decompression**: When the worker boots, it runs a blazing-fast `tar -xzf` command to instantly decompress this archive into the new `/tmp` workspace. This gives the new worker a fully functioning `node_modules` folder in milliseconds, completely eliminating the need to ever run `npm install`!
* **Starts the Mini-Server**: It launches a tiny Express server on the assigned port (e.g., 4000). This mini-server is the "gatekeeper" for this specific Next.js instance.
* **Boots Next.js**: It spawns the actual `next dev` process on a hidden internal port (e.g., 14000). 
* **The Proxy**: The gatekeeper mini-server (4000) silently proxies all normal web traffic to the hidden Next.js port (14000).

### 3. The Injection Magic (`/__inject`)
This is where the magic happens. The gatekeeper mini-server (on port 4000) intercepts any `POST` request sent to `/__inject`.

When the Manager sends the AI-generated code to this endpoint, the worker intercepts it:
1. **Flattening**: AI models often return code in nested JSON formats (like WebContainers use). The script recursively flattens this into standard file paths (e.g., turning `{ app: { directory: { page: "..." } } }` into `app/page.js`).
2. **Disk Writing**: It instantly writes these files directly into the temporary `/tmp` workspace.
3. **HMR Takeover**: Because `next dev` is already running and watching that `/tmp` folder, Next.js sees the new files instantly. Next.js triggers a fast refresh, compiling the new pages in milliseconds.

Because everything was pre-warmed and pre-installed, the entire process from clicking "Generate" to seeing the website takes about 1 second!

### 4. Memory Management & Session TTL
Running multiple Next.js environments takes a lot of RAM. If a user previews some code and then closes the browser, we don't want that Next.js server running forever and eating up your memory!

To solve this, the Worker Pool implements a strict **Time-To-Live (TTL)** cleanup system:
* Every time you inject code or view the preview, the worker's "Last Active" timer is reset.
* The Manager constantly sweeps through all workers in the background (using an interval).
* If a worker has been idle for too long (e.g., 5 minutes), the Manager automatically kills the Node and Next.js processes, deletes the `/tmp` workspace directory from your hard drive, and completely frees up the memory.
* It then instantly spins up a fresh, warm worker to take its place in the queue. This guarantees your server will never crash from out-of-memory errors!

### 5. Resiliency & Smart Port Routing
If a background worker process crashes or if "zombie" processes from previous sessions accidentally hold onto their ports (e.g., port 4000), the system will not break or get stuck in an infinite crash loop.

The Worker Pool uses a **Smart Port Queue**:
* It keeps a rotating list of 500 available ports.
* If the Manager tries to boot a worker on port 4000 and fails (because a zombie process is blocking it), the worker safely exits.
* The Manager catches this failure, institutes a **1-second cooldown backoff**, and pushes the "bad" port 4000 to the very back of the queue.
* It then grabs the next port in line (4001) and tries again. It will cleanly skip blocked ports until it finds a healthy, completely free port!
