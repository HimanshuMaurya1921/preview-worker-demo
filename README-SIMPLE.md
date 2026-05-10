# The AI Studio Preview System: How It Works

This document explains the entire architecture of the AI Studio Preview System. It is written in simple English so that non-technical stakeholders (like a CEO or Product Manager) can understand the "why" and "what", while containing enough technical depth for a Junior Developer to fully understand the flow of data.

---

## 1. The Big Picture (For the CEO)

Imagine trying to build a brand new house (a website) every time a customer asks for one. Normally, building a house from scratch takes minutes: you have to buy materials (downloading internet dependencies), pour the foundation, and wait for it to dry. In the cloud world, making a user wait 2 minutes to preview a website is a terrible user experience.

Our system acts like a magical factory that keeps fully-built, empty houses on standby. When a user asks our AI for a website, we instantly "teleport" their custom furniture (the code) into one of these empty houses and turn on the lights. If they want to change the design, we instantly swap the furniture without having to rebuild the house.

**The Business Value:** This gives the user an instant, live preview of their AI-generated website in seconds instead of minutes. It saves huge amounts of cloud costs (because we recycle the houses) and provides a magical, snappy user experience.

---

## 2. The Core Components (The Factory Floor)

The system is separated into four distinct parts:

1. **The Frontend (The Storefront):** This is the React website the user interacts with. It shows the AI chat/code and has a live preview window (an iframe) to see the result.
2. **The Backend (The Brains):** This generates the raw code files (React/Next.js) based on user prompts.
3. **The Orchestrator (The Traffic Cop):** A lightweight server that manages the traffic. It talks to our cloud provider (Kubernetes) to assign an isolated "Sandbox" for the user, and securely routes the user's browser to that exact sandbox.
4. **The Preview Worker (The Sandbox):** An isolated, temporary mini-computer (Kubernetes Pod). It runs the actual Next.js server, receives the code, and immediately displays the website.

---

## 3. The Step-by-Step Flow (For Developers)

Here is exactly what happens when a user clicks "Generate".

### Phase A: The Request
1. **User Action:** The user clicks "Generate" on the Frontend.
2. **Code Generation:** The Frontend asks the Backend for the code. The Backend returns a JSON object containing all the files (like `page.js`, `layout.js`, etc.).
3. **Session Request:** The Frontend sends this JSON code to the **Orchestrator** (via `POST /api/preview/start`), essentially asking: *"Please find a place to run this code."*

### Phase B: Provisioning the Sandbox
4. **Checking for "Warm" Pods:** The Orchestrator checks a fast memory database (Redis) to see: *"Does this user already have a running sandbox?"*
    - **If YES (Warm Start):** We reuse the existing pod! This skips the boot process entirely and is blazingly fast.
    - **If NO (Cold Start):** The Orchestrator talks to the Kubernetes API to create a brand new Pod.
5. **The Secret Handshake:** The Orchestrator shares a secure password (`AUTH_TOKEN`) with the new Pod. This ensures that nobody on the internet can inject malicious code into the pod directly—they MUST go through the Orchestrator.

### Phase C: Making the Sandbox Blazingly Fast
If we just booted a standard Next.js app, it would take a long time. Here is how we cheat physics to make it instant:

6. **The Symlink Trick:** A standard Next.js app needs to run `npm install` to download dependencies, which takes 1-2 minutes. Instead, our Docker image already has `node_modules` pre-installed inside a hidden template folder. The worker creates a "Symlink" (a shortcut) from the active workspace directly to this template. **Time taken: 1 millisecond.**

7. **RAM-Disk (Memory Storage):** The worker writes the user's code files directly into a Kubernetes `emptyDir` backed by RAM (`Medium: Memory`). Because it's writing to physical memory instead of a hard drive, reading and writing files happens at the speed of light.

### Phase D: Injecting and Running the Code
8. **File Injection:** The Orchestrator sends the code files to the Worker's internal `/__inject` endpoint.

9. **Next.js Boot:** The Worker starts the `next dev` background process. 

10. **Smart Polling:** The Frontend doesn't just blindly load the iframe and show an ugly "Bad Gateway" error while Next.js is booting. Instead, it constantly pings the worker's `/__health` endpoint: *"Are you ready yet?"* It shows a beautiful "Syncing..." spinner to the user until Next.js gives the green light.

11. **Live Preview:** The Frontend's iframe loads the final URL, and the user sees their website!

---

## 4. Hot Module Replacement (HMR) & Live Updates

When a user asks the AI to change a button from Blue to Red, we do not want to restart the whole server.

- The Frontend sends *just* the updated files to the Orchestrator.
- The Worker overwrites the files in the memory disk.
- Next.js detects the file change and uses **WebSockets (HMR)** to instantly update the user's iframe without them having to refresh the page! 
- *Optimization Note:* The Orchestrator uses a special proxy (`http-proxy-middleware`) that specifically keeps these WebSocket connections "Sticky", ensuring the live-refresh magic never breaks.

---

## 5. The "Stop-Wipe-Inject-Restart" Lifecycle

What happens if the user wants to completely switch from building a "Portfolio" to building an "E-commerce" site? 
Next.js aggressively caches old files. If we just overwrite the files, the old Portfolio cache will mix with the new E-commerce code, causing horrible bugs. 

To solve this, the Worker detects a "Wipe" command and does the following:
1. **The Assassin:** It uses a hard Linux command (`pkill -9 -f next`) to instantly assassinate the old Next.js process and forcefully clear its locked ports.
2. **Memory Sweep:** It triggers a manual Garbage Collection (`global.gc()`) to free up RAM.
3. **Rebirth:** It deletes all old files, injects the new E-commerce files, and starts a fresh Next.js server. 

**Result:** A 100% clean state. The user keeps the same Pod (so no K8s cold start), but the memory stays locked at an incredibly efficient ~60MB footprint.

---

## 6. Cleanup & Security (The Janitor)

Cloud computing costs money. We cannot keep Sandbox Pods running forever if the user closes their laptop and goes to sleep. We also cannot let AI-generated code hack our network.

1. **No Outbound Traffic (Security):** The Pods are locked in a Kubernetes `NetworkPolicy`. They cannot access the open internet (except to resolve DNS). If the AI accidentally generates malicious code, it cannot hack out of the sandbox to steal data or mine crypto.
2. **The 30-Minute Janitor (CronJob):** A Kubernetes `CronJob` wakes up every single minute. It looks at the creation time of all Pods. If a Pod has been alive for more than 30 minutes, the Janitor mercilessly deletes it (`kubectl delete pod`). 
3. **Self-Healing Orchestrator:** If the Orchestrator notices a Pod was deleted by the Janitor, it cleans up the Redis database, ensuring no "ghost sessions" exist. The next time the user comes back, they seamlessly get a fresh Cold Start.
