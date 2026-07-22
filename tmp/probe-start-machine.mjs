const res = await fetch('https://gpuvietnam.com/api/user/start-machine', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});
const text = await res.text();
console.log('HTTP', res.status);
console.log(text.slice(0, 400));
