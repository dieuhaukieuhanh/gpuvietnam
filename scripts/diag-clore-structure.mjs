const res = await fetch('https://api.clore.ai/v1/marketplace', {
  method: 'GET',
  headers: { Accept: 'application/json' },
});
const data = await res.json();
const servers = Array.isArray(data?.servers) ? data.servers : [];
console.log(`Total servers: ${servers.length}`);
console.log(`First server keys:`, Object.keys(servers[0] ?? {}));
console.log(`\nFirst server (full):`);
console.log(JSON.stringify(servers[0], null, 2));
console.log(`\n--- Sample servers with RTX 3090/4090 ---`);
const matches = servers.filter((s) => {
  const arr = Array.isArray(s.gpu_array) ? s.gpu_array : [];
  const joined = arr.join(' ').toLowerCase();
  return /3090|4090/.test(joined);
}).slice(0, 5);
for (const s of matches) {
  console.log(JSON.stringify({
    id: s.id,
    rented: s.rented,
    reliability: s.reliability,
    gpu_array: s.gpu_array,
    specs_gpu: s.specs?.gpu,
    net_cc: s.specs?.net?.cc,
    price: s.price,
  }, null, 2));
}
