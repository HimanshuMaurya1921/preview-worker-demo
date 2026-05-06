
async function simulateBurst() {
  const CONCURRENCY = 15;
  const apiBase = 'http://localhost:3001';
  
  console.log(`🚀 Starting burst simulation with ${CONCURRENCY} concurrent requests...`);
  
  const startTime = Date.now();
  const requests = Array.from({ length: CONCURRENCY }).map((_, i) => {
    return fetch(`${apiBase}/api/preview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: `burst-test-${i}`,
        files: { "app/page.js": `export default function Page() { return <h1>Burst ${i}</h1> }` }
      })
    }).then(async r => {
      const data = await r.json();
      console.log(`✅ Request ${i} finished with worker ${data.workerId} (${Date.now() - startTime}ms)`);
      return data;
    }).catch(err => {
      console.error(`❌ Request ${i} failed:`, err.message);
    });
  });

  await Promise.all(requests);
  console.log(`🏁 Burst simulation complete in ${Date.now() - startTime}ms`);
}

simulateBurst();
