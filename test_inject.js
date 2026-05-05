async function test() {
  const res0 = await fetch('http://localhost:3000/next-code');
  const mockData = await res0.json();
  const res = await fetch('http://localhost:3000/api/preview/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'test-1', files: mockData.files || mockData })
  });
  console.log(res.status, await res.text());
}
test();
