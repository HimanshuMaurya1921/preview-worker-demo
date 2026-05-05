# AI Studio: Deployment & Execution Guide

This project features a scalable microservice architecture separated into three core components:
1. **Frontend (React/Vite)**: The user interface containing the `<PreviewFrame>`.
2. **API Backend (Node.js)**: The core server handling code generation/mocks.
3. **Runner Orchestrator (Node.js)**: The heavy-lifting server that manages the Next.js worker pool.

Below are the step-by-step instructions to run this project across three different scenarios: from purely local development to a full Kubernetes + EC2 production deployment.

---

## 💻 Scenario 1: Running Everything Locally (Development)
Use this setup when actively developing or testing on your own machine.

**Step 1: Configure Environment Variables**
In the `frontend/` folder, ensure your `.env` contains:
```env
VITE_API_URL=http://localhost:3000
VITE_RUNNER_URL=http://localhost:3001
```

**Step 2: Start the API Backend**
Open Terminal 1 and run:
```bash
<<<<<<< HEAD
node backend/server.js
=======
cd backend
node server.js
>>>>>>> 2370a35 (seprated the microservices)
```
*(Runs on port 3000)*

**Step 3: Start the Runner Orchestrator**
Open Terminal 2 and run:
```bash
<<<<<<< HEAD
node worker/runner-server.js
=======
cd runner
node server.js
>>>>>>> 2370a35 (seprated the microservices)
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

## ☁️ Scenario 2: Local Development with an EC2 Runner
Use this setup if your local machine is too slow to handle Next.js compilation, and you want to offload the heavy Worker Pool to a remote EC2 server while keeping your frontend and backend local.

**Step 1: Deploy Runner to EC2**
1. Provision an Ubuntu EC2 instance (e.g., `t3.large` with 8GB RAM).
<<<<<<< HEAD
2. Copy the `worker/preview-system/` folder, `worker/runner-server.js`, and `package.json` to the EC2 server.
3. Install dependencies (`npm install`) and start the runner using PM2:
   ```bash
   pm2 start worker/runner-server.js --name "ai-runner"
=======
2. Copy the `runner/` folder to the EC2 server.
3. Install dependencies (`npm install`) and start the runner using PM2:
   ```bash
   cd runner
   pm2 start server.js --name "ai-runner"
>>>>>>> 2370a35 (seprated the microservices)
   ```

**Step 2: Secure the EC2 Connection (AWS IAM / GCP Service Account)**
Instead of relying on public tunnels, secure the communication between your environments using cloud-native identity:
* **AWS:** Assign an IAM Role to your local/K8s environment with policies that allow it to securely invoke or access the EC2 instance (e.g., via AWS API Gateway or an internal VPC peering setup if using a VPN).
* **GCP:** Use a Service Account attached to your GKE cluster with Identity-Aware Proxy (IAP) or VPC peering to securely route traffic to the Compute Engine instance.
*(Note: If the EC2 instance is completely private, ensure your local browser is connected to the cloud VPC via VPN to view the iframe previews!)*

**Step 3: Update Local Environment**
On your local machine, update your `frontend/.env` to point to the secure internal IP or API Gateway URL:
```env
VITE_API_URL=http://localhost:3000
VITE_RUNNER_URL=http://<secure-internal-ec2-ip-or-gateway>:3001
```

**Step 4: Run Locally**
Start your local `server.js` and `npm run dev`. When you click "Generate", your local frontend will blast the code to the remote EC2 server, which will compile it and stream the preview back to your local iframe!

---

## 🚀 Scenario 3: Full Production (Kubernetes + EC2)
This is the ultimate production deployment. The lightweight stateless services run in K8s, while the heavy stateful previews run safely isolated on EC2.

**Step 1: Deploy API Backend & Frontend to Kubernetes**
1. Dockerize `server.js` and deploy it as a Pod/Deployment in your K8s cluster. Expose it via an Ingress (e.g., `api.yourdomain.com`).
2. Build your React frontend (`npm run build`) and deploy the static assets to an NGINX container in K8s, or host it on Vercel/Netlify. 

**Step 2: Deploy Runner Orchestrator to EC2**
Exactly the same as Scenario 2.
<<<<<<< HEAD
1. Deploy `worker/runner-server.js` to EC2 via PM2.
=======
1. Deploy the `runner/` folder to EC2 via PM2.
>>>>>>> 2370a35 (seprated the microservices)
2. Secure the EC2 instance within your VPC. Attach an AWS IAM Role to your K8s worker nodes (or GCP Service Account to GKE) to allow secure internal routing via VPC Peering or Internal Load Balancers.

**Step 3: Configure Frontend Production Environment**
Before building your frontend container/deployment, ensure your production environment variables are set to the public/internal URLs:
```env
VITE_API_URL=https://api.yourdomain.com
# If your frontend routes directly to EC2 from the user's browser, the EC2 must be behind an Application Load Balancer (ALB).
VITE_RUNNER_URL=https://runner-alb.yourdomain.com 
```

### How Traffic Flows in Production:
1. User opens `yourdomain.com` (K8s Frontend).
2. User clicks Generate. Frontend fetches code from `api.yourdomain.com` (K8s Backend).
3. Frontend injects code via `POST` directly to `runner.yourdomain.com` (EC2 Runner).
4. EC2 Runner replies with a temporary proxy path (e.g., `/api/preview/proxy/w-abcd/`).
5. Iframe loads `https://runner.yourdomain.com/api/preview/proxy/w-abcd/` and displays the live Next.js preview safely compiled on the EC2 machine!
