# ☁️ AI Studio Cloud Preview System

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Architecture](https://img.shields.io/badge/architecture-microservices-success.svg)

AI Studio is a high-performance, distributed web application designed to instantly compile and preview AI-generated code. It utilizes a highly optimized, pre-warmed worker pool architecture to deliver near-instant Next.js previews directly in the user's browser.

This project is separated into a scalable microservice architecture to support enterprise-grade deployments combining Kubernetes (K8s) for lightweight services and dedicated EC2 instances for heavy, isolated compilation workloads.

---

## 🌟 Key Features

- **Near-Instant Previews:** Utilizes a pre-warmed pool of Next.js dev servers to reduce preview boot times from >15s down to 1-3s.
- **Microservice Architecture:** Fully decoupled Frontend, Backend, and Worker orchestrators allowing for independent scaling and failure isolation.
- **Dynamic Proxy Routing:** Seamlessly injects code and routes preview traffic from the frontend iframe to the dedicated internal Next.js worker via dynamically generated proxy paths.
- **Cloud-Native Deployment Ready:** Built with Kubernetes and AWS EC2 integration in mind, balancing containerized stateless API handling with raw compute performance for builds.

---

## 🏗️ Architecture

The system consists of three core components:

1. **Frontend (`/frontend`)**
   - **Stack:** React, Vite, TailwindCSS (optional).
   - **Role:** The user interface containing the code editor and the `<PreviewFrame>`. It communicates with the Backend to fetch code and directly injects it into the Worker Pool for rendering.

2. **API Backend (`/backend`)**
   - **Stack:** Node.js, Express.
   - **Role:** The stateless core API server. Handles code generation requests, user management, and serves mocked code structures to the frontend.

3. **Worker Orchestrator (`/worker`)**
   - **Stack:** Node.js, Next.js, HTTP-Proxy.
   - **Role:** The heavy-lifting server. It manages a dynamic pool of Next.js child processes. It allocates available ports, injects user code, and sets up real-time proxy middlewares to stream the compiled output back to the user's iframe.

---

## 🚀 Quick Start (Local Development)

To run the entire ecosystem locally on your machine for development:

1. **Setup Environment:**
   Ensure your `frontend/.env` contains:
   ```env
   VITE_API_URL=http://localhost:3000
   VITE_WORKER_URL=http://localhost:3001
   ```

2. **Start Backend (Terminal 1):**
   ```bash
   cd backend
   npm install
   node server.js
   ```

3. **Start Worker Pool (Terminal 2):**
   ```bash
   cd worker
   npm install
   node server.js
   ```

4. **Start Frontend (Terminal 3):**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

---

## 🌍 Production Deployment

The recommended production architecture distributes these services across Kubernetes and EC2:

- **Frontend:** Hosted on a CDN (Vercel/Netlify) or as an NGINX Pod in K8s.
- **Backend:** Deployed as a scalable Deployment/Service in Kubernetes.
- **Worker Orchestrator:** Deployed on a dedicated, hardened AWS EC2 instance (e.g., `t3.large` or `c5.xlarge`) to provide raw compute for Next.js builds.

For detailed deployment strategies (including routing configurations and Cloudflare/AWS proxy setups), see the [**Deployment Guide (README-Deployment.md)**](./README-Deployment.md).

---

## 🛡️ Security Considerations

Executing untrusted, AI-generated code is inherently risky. If deploying the Worker Pool to an EC2 instance, strict OS-level hardening is required to prevent server compromise. 

Key security measures implemented/required:
- **Unprivileged Execution:** Workers must run under a non-sudo sandbox user.
- **Metadata Protection:** AWS IMDS (`169.254.169.254`) must be blocked via `iptables`.
- **Resource Limits:** OS-level `ulimit` restrictions are required to prevent memory leaks and fork bombs.
- **File System Jails:** Strict directory ownership limiting access to the project root.

Read the **Security & OS Hardening** section in the [Deployment Guide](./README-Deployment.md) for full instructions.
