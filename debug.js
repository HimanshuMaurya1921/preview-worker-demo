const fetch = require('node-fetch'); // wait, built in fetch is v18+
async function test() {
  const payload = {"projectId": "test-1", "files": {"app": {"directory": {"page.js": {"file": {"contents": "test"}}}}}};
  try {
    const res = await fetch('http://localhost:3000/api/preview/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    console.log(res.status, text);
  } catch (err) {
    console.error(err);
  }
}
test();
