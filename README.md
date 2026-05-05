# AI Studio - Microservice Architecture

This repository has been separated into three distinct services to support distributed deployments (Kubernetes + EC2).

## Project Structure

- **[/frontend](./frontend)**: React + Vite application. Handles the UI and triggers previews.
- **[/backend](./backend)**: Node.js API server. Serves AI-generated code mocks.
- **[/runner](./runner)**: Node.js Worker Pool Orchestrator. Manages Next.js preview instances on EC2.

## Deployment Strategy

1.  **Frontend**: Deploy static assets to Vercel, Netlify, or an NGINX pod in K8s.
2.  **Backend**: Deploy as a containerized service in Kubernetes.
3.  **Runner**: Deploy to a dedicated EC2 instance (Ubuntu) to handle heavy Next.js compilation workloads.

For detailed instructions on how to run each service, please refer to the [README-Deployment.md](./README-Deployment.md).
