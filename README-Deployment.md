# AI Studio: Deployment & Execution Guide

> [!NOTE]
> For a deep dive into the internal System Design and Architecture of the Worker Pool, see **[README-WORKER.md](./README-WORKER.md)**.

This project features a scalable microservice architecture separated into three core components:
1. **Frontend (React/Vite)**: The user interface containing the `<PreviewFrame>`.
2. **API Backend (Node.js)**: The core server handling code generation/mocks.
3. **Worker Orchestrator (Node.js)**: The heavy-lifting server that manages the Next.js worker pool.

Below are the step-by-step instructions to run this project across three different scenarios: from purely local development to a full Kubernetes + EC2 production deployment.

---

## 💻 Scenario 1: Running Everything Locally (Development)
Use this setup when actively developing or testing on your own machine.

**Step 1: Configure Environment Variables**
In the `frontend/` folder, ensure your `.env` contains:
```env
VITE_API_URL=http://localhost:3000
VITE_WORKER_URL=http://localhost:3001
```

**Step 2: Start the API Backend**
Open Terminal 1 and run:
```bash
cd backend
node server.js
```
*(Runs on port 3000)*

**Step 3: Start the Worker Orchestrator**
Open Terminal 2 and run:
```bash
cd worker
node server.js
```
*(Runs on port 3001 and pre-warms the Next.js workers)*

**Step 4: Start the Frontend**
Open Terminal 3 and run:
```bash
cd frontend
npm run dev
```
*(Open http://localhost:5173 in your browser)*

---

## ☁️ Scenario 2: Local Development with an EC2 Worker
Use this setup if your local machine is too slow to handle Next.js compilation, and you want to offload the heavy Worker Pool to a remote EC2 server while keeping your frontend and backend local.

You have **two options** for running the worker on EC2:

### Option A: Bare-Metal with PM2 (Simple, for quick testing)

Best for developers who want to quickly spin up a worker without Docker.

**Step 1: Provision & Secure EC2**
1. Provision an Ubuntu EC2 instance (e.g., `t3.large` with 8GB RAM).
2. SSH into your instance. **WARNING:** Do not run the worker under the default user (e.g., `ubuntu` or `root`) for security reasons. Create a dedicated non-root user:
   ```bash
   sudo adduser --disabled-password --gecos "" ai-worker-user
   sudo su - ai-worker-user
   ```
3. (Optional) Add swap space if using a 4GB RAM instance:
   ```bash
   # Run these commands as the ubuntu user, NOT ai-worker-user
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   free -h  # Verify swap
   ```

**Step 2: Deploy & Start**
1. Copy the `worker/` folder to the EC2 server (ensure it is owned by `ai-worker-user`).
2. Install dependencies and start with PM2:
   ```bash
   cd worker
   npm install
   npm install -g pm2
   pm2 start server.js --name "ai-worker" --max-memory-restart 2500M
   pm2 startup   # Auto-start on reboot
   pm2 save
   ```
3. Monitor logs:
   ```bash
   pm2 logs ai-worker -f
   ```

---

### Option B: Docker Container (Recommended for EC2)

Best for production-like deployments with automatic memory limits, health checks, and self-healing restarts.

**Step 1: Provision EC2 & Install Docker**
1. Provision an Ubuntu EC2 instance (e.g., `t3.large` with 8GB RAM).
2. Install Docker and Docker Compose:
   ```bash
   sudo apt-get update
   sudo apt-get install -y docker.io docker-compose-plugin
   sudo usermod -aG docker ubuntu
   # Log out and back in for group changes to take effect
   ```

**Step 2: Deploy & Start**
1. Copy the `worker/` folder to the EC2 server.
2. Build and start the container:
   ```bash
   cd worker
   docker compose up -d --build
   ```
   This single command will:
   - Build the Docker image with a **non-root** user.
   - Start the container with a **3 GB memory limit** (hard cap — the container is OOM-killed if it exceeds this).
   - Mount `/tmp` as a **RAM-backed tmpfs** (2 GB) to prevent the disk ENOSPC crash loop.
   - Enable **auto-restart** (`unless-stopped`) — the container will self-heal after crashes and survive EC2 reboots.
   - Run a **health check** every 30 seconds against the `/health` endpoint.

3. Monitor logs:
   ```bash
   docker compose logs -f ai-worker
   ```

4. To adjust the memory limit, edit `docker-compose.yml`:
   ```yaml
   deploy:
     resources:
       limits:
         memory: 2.5g   # Change to 2.5 GB for smaller instances
   ```

5. Useful commands:
   ```bash
   docker compose ps          # Check status & health
   docker compose restart     # Restart the worker
   docker compose down        # Stop and remove the container
   docker compose up -d       # Start again (no rebuild needed)
   docker stats ai-worker-pool  # Live CPU/memory usage
   ```

---

### Common Steps (Both Options)

**Step 3: Configure EC2 Security Group**
Ensure the following inbound rules are set on your EC2 Security Group:
| Port        | Protocol | Source          | Purpose                        |
|-------------|----------|-----------------|--------------------------------|
| 22          | TCP      | Your IP         | SSH access                     |
| 3001        | TCP      | Your IP / 0.0.0.0/0 | Worker Orchestrator API    |
| 4000–4500   | TCP      | Your IP         | Direct Next.js worker access (DEV mode only) |

**Step 4: Secure the EC2 Connection (AWS IAM / GCP Service Account)**
Instead of relying on public tunnels, secure the communication between your environments using cloud-native identity:
* **AWS:** Assign an IAM Role to your local/K8s environment with policies that allow it to securely invoke or access the EC2 instance (e.g., via AWS API Gateway or an internal VPC peering setup if using a VPN).
* **GCP:** Use a Service Account attached to your GKE cluster with Identity-Aware Proxy (IAP) or VPC peering to securely route traffic to the Compute Engine instance.

> ⚠️ If the EC2 instance is completely private, ensure your local browser is connected to the cloud VPC via VPN to view the iframe previews!

**Step 5: Update Local Environment**
On your local machine, update your `frontend/.env` to point to your EC2 instance:
```env
VITE_API_URL=http://localhost:3000
VITE_WORKER_URL=http://<your-ec2-public-ip>:3001
```
> ⚠️ If your EC2 Public IP changes on every reboot, consider attaching an **Elastic IP** to your instance.

**Step 6: Run Locally**
Start your local `backend/server.js` and `frontend (npm run dev)`. When you click "Generate", your local frontend will send the code to the remote EC2 worker, which compiles it and streams the preview back to your local iframe!

---

## 🚀 Scenario 3: Full Production (Kubernetes + EC2)
This is the ultimate production deployment. The lightweight stateless services run in K8s, while the heavy stateful previews run safely isolated on EC2.

**Step 1: Deploy API Backend & Frontend to Kubernetes**
1. Dockerize `server.js` and deploy it as a Pod/Deployment in your K8s cluster. Expose it via an Ingress (e.g., `api.yourdomain.com`).
2. Build your React frontend (`npm run build`) and deploy the static assets to an NGINX container in K8s, or host it on Vercel/Netlify. 

**Step 2: Deploy Worker Orchestrator to EC2**
Follow Scenario 2 above. For production, **Option B (Docker Container)** is recommended:
1. Copy the `worker/` folder to EC2 and run `docker compose up -d --build`.
2. The container runs with a 3 GB memory limit, auto-restart, and health checks out of the box.
3. Secure the EC2 instance within your VPC. Attach an AWS IAM Role to your K8s worker nodes (or GCP Service Account to GKE) to allow secure internal routing via VPC Peering or Internal Load Balancers.

**Step 3: Configure Frontend Production Environment**
Before building your frontend container/deployment, ensure your production environment variables are set to the public/internal URLs:
```env
VITE_API_URL=https://api.yourdomain.com
# If your frontend routes directly to EC2 from the user's browser, the EC2 must be behind an Application Load Balancer (ALB).
VITE_WORKER_URL=https://worker-alb.yourdomain.com 
```

### How Traffic Flows in Production:
1. User opens `yourdomain.com` (K8s Frontend).
2. User clicks Generate. Frontend fetches code from `api.yourdomain.com` (K8s Backend).
3. Frontend injects code via `POST` directly to `worker.yourdomain.com` (EC2 Worker).
4. EC2 Worker replies with a temporary proxy path (e.g., `/api/preview/proxy/w-abcd/`).
5. Iframe loads `https://worker.yourdomain.com/api/preview/proxy/w-abcd/` and displays the live Next.js preview safely compiled on the EC2 machine!

---

## 🛡️ EC2 Worker Security & OS Hardening

If you are running the `worker` orchestrator on an EC2 instance (Scenario 2 or 3), you are executing untrusted AI-generated code directly on the host OS via child processes. To prevent malicious code from compromising your server or cloud environment, you **must** implement the following OS-level restrictions:

1. **Dedicated Unprivileged User:** Create a dedicated user (e.g., `ai-sandbox-user`) with **zero `sudo` privileges**. Run the worker orchestrator (`server.js`) as this user so any shell commands executed by the AI code are restricted.
2. **Block AWS Metadata Access:** Use `iptables` to block the sandbox user from querying the AWS Instance Metadata Service (`169.254.169.254`). This prevents the generated code from stealing the EC2 instance's IAM credentials.
   ```bash
   sudo iptables -A OUTPUT -m owner --uid-owner ai-sandbox-user -d 169.254.169.254 -j DROP
   ```
3. **File System Restrictions:** Ensure the `ai-sandbox-user` only has read/write access to the `/worker/` directory. They should have no read access to sensitive OS files (e.g., `/etc/passwd`, `/var/log`).
4. **Resource Limits (`ulimit`):** Prevent the AI from accidentally crashing the EC2 instance (e.g., via fork bombs or memory leaks) by configuring OS limits for the sandbox user:
   * **Max Processes (`ulimit -u`):** Cap child processes.
   * **Max Memory (`ulimit -m` / `ulimit -v`):** Cap RAM usage per worker.
   * **Max File Size (`ulimit -f`):** Prevent disk exhaustion.
5. **Internal Network Blocking:** Block outbound traffic to any internal VPC IP ranges (e.g., `10.0.x.x`) to prevent the code from scanning or accessing internal databases and APIs.
