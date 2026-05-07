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

### 2.3 Iframe Refresh Strategy
Next.js Hot Module Replacement (HMR) is fast, but for massive code changes (e.g., changing a layout or adding a route), a full iframe refresh is recommended to reset the React state.
- **Requirement**: After the `/start` call returns successfully, append a cache-busting parameter to the `previewUrl`.
- **Example**: `iframe.src = `${session.previewUrl}?v=${Date.now()}`;`

### 2.4 Loading States
- **Cold Start**: Orchestrator returns `warm: false`. Display a "Booting Container..." message (~11s).
- **Warm Update**: Orchestrator returns `warm: true`. Display a "Syncing Changes..." message (<1s).

### 2.5 Self-Healing (Session Expiry)
The Orchestrator may return a `status: "expired"` if the pod was reaped by the TTL cleaner.
- **Requirement**: If `data.status === "expired"`, the frontend MUST clear the current `workerId` and re-trigger the `/start` call immediately.
- **User Feedback**: It is recommended to update the loading text to "Session expired, re-booting..." during this phase.

## 3. Networking & Security
- **WebSockets**: The preview URL MUST be loaded in an environment that allows WebSocket connections (for HMR).
- **Cookies**: The Orchestrator sets a `preview-worker-id` cookie for asset routing. Ensure the frontend does not block `SameSite=Lax` cookies in the iframe.

## 4. Environment Variables
- `VITE_WORKER_URL`: The URL of the Orchestrator (e.g., `http://localhost:3001` or `https://preview.yourdomain.com`).
