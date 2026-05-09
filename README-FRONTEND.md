# Frontend Integration Guide: AI Studio Preview System

This document outlines the requirements for the frontend to correctly interface with the K8s-based Preview Worker system.

## 1. Core Concepts
The system uses an **Orchestrator** to manage ephemeral Next.js pods. To achieve high performance, we use a **"Warm Update"** strategy where a single pod is reused for a specific user.

## 2. Mandatory Implementation Requirements

### 2.1 Persistent User Identity
Every user MUST have a stable `userId` persisted in `localStorage`. This allows the Orchestrator to route them back to their existing "Warm" pod.
```javascript
// Example implementation
let userId = localStorage.getItem('preview_user_id');
if (!userId) {
  userId = `user-${Math.random().toString(36).substring(2, 11)}`;
  localStorage.setItem('preview_user_id', userId);
}
```

### 2.2 The `/start` Endpoint
Always use the `/start` endpoint for both the initial preview and subsequent updates. The Orchestrator handles the reuse logic internally.
- **URL**: `${WORKER_URL}/api/preview/start`
- **Method**: `POST`
- **Body**:
  ```json
  {
    "projectId": "unique-project-id",
    "userId": "stable-user-id",
    "files": { ...WebContainerStyleFileTree... }
  }
  ```

### 2.3 Iframe Refresh & Readiness Polling
Next.js Hot Module Replacement (HMR) is fast, but for project swaps, we restart the server. To ensure a smooth transition, the frontend MUST poll for readiness before updating the iframe.

1. **Step 1**: Call `/api/preview/start`.
2. **Step 2**: Begin polling `${apiBase}/api/preview/proxy/${workerId}/__health`.
3. **Step 3**: Only update the iframe `src` when the response returns `status: "ready"`.
4. **Step 4**: Append a cache-busting parameter: `src = `${previewUrl}?v=${Date.now()}`;`

### 2.4 High-End Loading UX
To provide a premium feel, use a blurred overlay during the "Syncing" phase:
- **Condition**: Show overlay whenever the poll is active.
- **Styling**: `backdrop-blur-md` with a subtle spinner.
- **Text**: "Syncing changes..." or "Preparing environment..."

### 2.5 Self-Healing (Session Expiry)
The Orchestrator may return a `status: "expired"` if the pod was reaped by the TTL cleaner.
- **Requirement**: If `data.status === "expired"`, the frontend MUST clear the current `workerId` and re-trigger the `/start` call immediately.
- **User Feedback**: Update loading text to "Session expired, re-booting..." during this phase.

## 3. Networking & Security
- **WebSockets**: The preview URL MUST be loaded in an environment that allows WebSocket connections (for HMR).
- **Cookies**: The Orchestrator sets a `preview-worker-id` cookie for asset routing. Ensure the frontend does not block `SameSite=Lax` cookies in the iframe.

## 4. Environment Variables
- `VITE_API_URL`: The URL of the Code Provider Backend.
- `VITE_WORKER_URL`: The URL of the Orchestrator (e.g., `https://preview.yourdomain.com`).
