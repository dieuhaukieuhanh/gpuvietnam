const res = await fetch('https://api.clore.ai/v1/marketplace');
const data = await res.json();
const servers = data?.servers ?? [];

const target = servers.filter((s) => {
  const arr = Array.isArray(s.gpu_array) ? s.gpu_array : [];
  const joined = arr.join(' ').toLowerCase();
  if (!/3090|4090/.test(joined)) return false;
  if (s.rented === true) return false;
  const cc = s.specs?.net?.cc ?? '';
  return ['TW', 'JP', 'SG', 'HK', 'KR', 'TH', 'MY', 'ID', 'VN', 'PH', 'CN', 'IN', 'MO', 'DE', 'FR', 'GB', 'NL', 'US', 'CA'].includes(cc);
});

console.log(`Available RTX 3090/4090 in target regions: ${target.length}`);
console.log(`\nReliability distribution (raw values):`);
const rels = target.map((s) => Number(s.reliability ?? 0)).sort((a, b) => a - b);
console.log(`  min=${rels[0]}, max=${rels[rels.length - 1]}, median=${rels[Math.floor(rels.length / 2)]}`);
console.log(`  all values:`, rels);

console.log(`\n--- All available 3090/4090 in target regions (with gpu count + price) ---`);
for (const s of target) {
  const arr = s.gpu_array ?? [];
  const numGpus = arr.length;
  const totalPrice = Number(s.price?.usd?.on_demand_usd ?? 0);
  const perGpuPrice = numGpus > 0 ? totalPrice / numGpus : totalPrice;
  console.log(`  cc=${s.specs?.net?.cc} | gpus=${numGpus} (${arr.join(',').trim()}) | reliability=${s.reliability} | total=$${totalPrice} | per_gpu=$${perGpuPrice.toFixed(3)}`);
}
