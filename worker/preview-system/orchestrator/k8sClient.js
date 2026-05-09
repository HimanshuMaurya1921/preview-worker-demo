const k8s = require('@kubernetes/client-node');

const kc = new k8s.KubeConfig();

// loadFromCluster() reads the service account token that GKE automatically
// mounts inside every pod. Zero config needed.
if (process.env.KUBERNETES_SERVICE_HOST) {
  kc.loadFromCluster();
} else {
  kc.loadFromDefault(); // Fallback for local testing if needed
}

const coreApi = kc.makeApiClient(k8s.CoreV1Api);

const NAMESPACE = 'preview';
const WORKER_IMAGE = process.env.WORKER_IMAGE;
const AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN;
const BOOT_TIMEOUT_MS = parseInt(process.env.BOOT_TIMEOUT_MS || '90000');
const MAX_PODS = parseInt(process.env.MAX_PREVIEW_PODS || '40');

// ─── Create a pod for one user session ───────────────────────────────────────
async function createPreviewPod(sessionId, projectId) {
  const podName = `preview-${sessionId}`;

  // Sanitize projectId for use as a k8s label value
  const safeProjectId = projectId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 63);

  await coreApi.createNamespacedPod(NAMESPACE, {
    metadata: {
      name: podName,
      namespace: NAMESPACE,
      labels: {
        app: 'preview-worker',
        type: 'preview-worker',
        session: sessionId,
        project: safeProjectId
      },
      annotations: {
        // TTL CronJob uses this to find old pods
        'created-at': Date.now().toString()
      }
    },
    spec: {
      // Never restart — if Next.js crashes, let the session expire
      restartPolicy: 'Never',
      terminationGracePeriodSeconds: 30,

      // This pod can only land on preview-pool nodes
      tolerations: [{
        key: 'workload',
        operator: 'Equal',
        value: 'preview',
        effect: 'NoSchedule'
      }],
      affinity: {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [{
              matchExpressions: [{
                key: 'workload',
                operator: 'In',
                values: ['preview']
              }]
            }]
          }
        }
      },

      containers: [{
        name: 'worker',
        image: WORKER_IMAGE,
        imagePullPolicy: 'IfNotPresent',
        ports: [{ containerPort: 3000 }],
        env: [
          { name: 'AUTH_TOKEN', value: AUTH_TOKEN },
          { name: 'WORKSPACE', value: '/workspace' },
          { name: 'NODE_OPTIONS', value: '--max-old-space-size=3072' },
          { name: 'RUNTIME', value: process.env.RUNTIME || 'gke' },
          {
            name: 'POD_NAME',
            valueFrom: {
              fieldRef: {
                fieldPath: 'metadata.name'
              }
            }
          }
        ],
        resources: {
          requests: { memory: '3Gi', cpu: '1000m' },
          limits:   { memory: '4Gi', cpu: '1000m' }
        },

        // Readiness probe: k8s will not send traffic until this returns 200
        // Also used by waitForPodReady() to know when Next.js is up
        readinessProbe: {
          httpGet: { path: '/__health', port: 3000 },
          initialDelaySeconds: 15,
          periodSeconds: 2,
          failureThreshold: 30
        },

        // Liveness probe: if Next.js crashes and stops responding,
        // k8s marks the pod Failed (restartPolicy:Never means no restart)
        livenessProbe: {
          httpGet: { path: '/__health', port: 3000 },
          initialDelaySeconds: 30,
          periodSeconds: 10,
          failureThreshold: 3
        },

        volumeMounts: [{
          name: 'workspace',
          mountPath: '/workspace'
        }]
      }],

      // emptyDir with Memory medium = tmpfs
      // Fast I/O, automatically wiped when pod is deleted
      volumes: [{
        name: 'workspace',
        emptyDir: {
          medium: 'Memory',
          sizeLimit: '4Gi'
        }
      }]
    }
  });

  return podName;
}

// ─── Wait until the pod is Running and Next.js is ready ──────────────────────
async function waitForPodReady(podName) {
  const start = Date.now();

  while (Date.now() - start < BOOT_TIMEOUT_MS) {
    try {
      const { body } = await coreApi.readNamespacedPod(podName, NAMESPACE);
      const phase = body.status?.phase;
      const conditions = body.status?.conditions || [];
      const isReady = conditions.find(c => c.type === 'Ready' && c.status === 'True');

      if (isReady) {
        return body.status.podIP;
      }

      // Fail fast on terminal states
      if (phase === 'Failed' || phase === 'Unknown') {
        throw new Error(`Pod ${podName} failed with phase: ${phase}`);
      }
    } catch (err) {
      if (err.response?.statusCode !== 404) throw err;
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  throw new Error(`Pod ${podName} did not become ready within ${BOOT_TIMEOUT_MS}ms`);
}

// ─── Delete a pod ─────────────────────────────────────────────────────────────
async function deletePreviewPod(podName) {
  try {
    await coreApi.deleteNamespacedPod(podName, NAMESPACE);
    console.log(`[k8s] Deleted pod ${podName}`);
  } catch (err) {
    if (err.response?.statusCode !== 404) throw err;
  }
}

// ─── Get current pod IP ───────────────────────────────────────────────────────
async function getPodIP(podName) {
  try {
    const { body } = await coreApi.readNamespacedPod(podName, NAMESPACE);
    if (body.status?.phase !== 'Running') return null;
    return body.status.podIP || null;
  } catch (err) {
    if (err.response?.statusCode === 404) return null;
    throw err;
  }
}

// ─── Check cluster capacity ───────────────────────────────────────────────────
async function getClusterCapacity() {
  const { body } = await coreApi.listNamespacedPod(
    NAMESPACE,
    undefined, undefined, undefined, undefined,
    'app=preview-worker'
  );
  const active = body.items.filter(p =>
    ['Running', 'Pending'].includes(p.status?.phase)
  ).length;
  return { active, max: MAX_PODS };
}

// ─── Check if a pod is actually running ───────────────────────────────────────
async function isWorkerRunning(podName) {
  try {
    const { body } = await coreApi.readNamespacedPod(podName, NAMESPACE);
    return body.status?.phase === 'Running';
  } catch (err) {
    return false;
  }
}

// ─── List all active worker IDs ───────────────────────────────────────────────
async function listActiveWorkerIds() {
  try {
    const { body } = await coreApi.listNamespacedPod(
      NAMESPACE,
      undefined, undefined, undefined, undefined,
      'app=preview-worker'
    );
    return body.items
      .filter(p => ['Running', 'Pending'].includes(p.status?.phase))
      .map(p => p.metadata.name);
  } catch (err) {
    console.error('[k8s] Failed to list pods:', err.message);
    throw err; // Throw instead of returning [] to prevent accidental Redis wipes
  }
}

module.exports = {
  createPreviewPod,
  waitForPodReady,
  deletePreviewPod,
  getPodIP,
  getClusterCapacity,
  isWorkerRunning,
  listActiveWorkerIds
};
