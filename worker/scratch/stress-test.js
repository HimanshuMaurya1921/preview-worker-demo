/**
 * STRESS TEST: AI PREVIEW WORKER
 * Scenarios:
 * 1. Parallel Start (Burst)
 * 2. Rapid Patch (Injection Stress)
 * 3. Client Disconnect (Abort)
 * 4. Queue Overfill (Backpressure)
 */

async function runTest() {
  const API_BASE = 'http://localhost:3001';
  const TOTAL_SESSIONS = 40; // Exceeds POOL_MAX (10) + QUEUE_MAX (20)
  
  console.log(`\n🔥 Starting HEAVY STRESS TEST...`);
  console.log(`Targeting ${API_BASE} with ${TOTAL_SESSIONS} potential sessions.\n`);

  // --- 1. Burst Parallel Start ---
  console.log(`--- PHASE 1: Burst Parallel Start ---`);
  const startPromises = Array.from({ length: TOTAL_SESSIONS }).map(async (_, i) => {
    const projectId = `stress-project-${i}`;
    const startTime = Date.now();
    
    // Simulate some users disconnecting randomly while in queue
    const shouldAbort = i % 5 === 0;
    const controller = new AbortController();
    
    if (shouldAbort) {
      setTimeout(() => {
        console.log(`   [Abort] Aborting request for ${projectId}...`);
        controller.abort();
      }, Math.random() * 5000);
    }

    try {
      const res = await fetch(`${API_BASE}/api/preview/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          files: { "app/page.js": `export default function Page() { return <h1>Stress ${i}</h1> }` }
        }),
        signal: controller.signal
      });

      const data = await res.json();
      if (!res.ok) {
        console.log(`   [Result] ${projectId}: FAILED (${res.status}) - ${data.error}`);
        return null;
      }
      console.log(`   [Result] ${projectId}: SUCCESS (${data.workerId}) in ${Date.now() - startTime}ms`);
      return { projectId, workerId: data.workerId };
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log(`   [Result] ${projectId}: ABORTED as planned.`);
      } else {
        console.log(`   [Result] ${projectId}: ERROR - ${err.message}`);
      }
      return null;
    }
  });

  const sessions = (await Promise.all(startPromises)).filter(Boolean);
  console.log(`\nActive sessions created: ${sessions.length}`);

  // --- 2. Rapid Patching ---
  console.log(`\n--- PHASE 2: Rapid Patching (Injection Stress) ---`);
  const patchPromises = sessions.map(async (s, i) => {
    const patches = 3;
    for (let p = 0; p < patches; p++) {
      await new Promise(r => setTimeout(r, Math.random() * 1000));
      try {
        const res = await fetch(`${API_BASE}/api/preview/${s.workerId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: s.projectId,
            files: { "app/page.js": `export default function Page() { return <h1>Patch ${p} for ${i}</h1> }` }
          })
        });
        if (res.ok) console.log(`   [Patch] ${s.workerId} patch ${p} success.`);
      } catch (err) {
        console.error(`   [Patch] ${s.workerId} failed:`, err.message);
      }
    }
  });
  await Promise.all(patchPromises);

  // --- 3. Check Final Stats ---
  console.log(`\n--- PHASE 3: System Health Check ---`);
  const statsRes = await fetch(`${API_BASE}/api/preview/stats`);
  const stats = await statsRes.json();
  console.log(`Final Stats:`, JSON.stringify(stats, null, 2));

  // --- 4. Cleanup ---
  console.log(`\n--- PHASE 4: Graceful Cleanup ---`);
  const deletePromises = sessions.map(s => 
    fetch(`${API_BASE}/api/preview/${s.workerId}/delete`, { method: 'POST' })
  );
  await Promise.all(deletePromises);
  console.log(`All clean. Stress test complete.\n`);
}

runTest().catch(console.error);
