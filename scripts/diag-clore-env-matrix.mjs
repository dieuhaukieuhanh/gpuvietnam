import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i <= 0) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  const k = t.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = v;
}

const key = (process.env.CLORE_AI_KEY || process.env.CLORE_API_KEY || "").trim();
const currency = process.env.CLORE_CURRENCY || "USD-Blockchain";
const base = "https://api.clore.ai/v1";
const serverId = Number(process.argv[2] || 100890);

async function req(method, path, body) {
  const init = { method, headers: { Accept: "application/json", auth: key } };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function createAndCancel(label, body) {
  await new Promise((r) => setTimeout(r, 6000));
  const created = await req("POST", "/create_order", body);
  let orderId = created.json?.order_id ?? created.json?.id ?? null;
  if (!orderId && Number(created.json?.code) === 0) {
    await new Promise((r) => setTimeout(r, 2500));
    const orders = await req("GET", "/my_orders");
    const list = Array.isArray(orders.json?.orders) ? orders.json.orders : [];
    const hit = list.find((o) => Number(o.si ?? o.renting_server) === serverId);
    orderId = hit?.order_id ?? hit?.id ?? null;
  }
  let cancel = null;
  if (orderId) {
    await new Promise((r) => setTimeout(r, 5000));
    cancel = await req("POST", "/cancel_order", { id: Number(orderId), order_id: Number(orderId) });
  }
  return { label, status: created.status, code: created.json?.code, orderId, cancelCode: cancel?.json?.code ?? null, bodyKeys: Object.keys(body) };
}

const image = "dieuhaukieuhanh/gpuvietnam-comfyui:v1";
const baseBody = {
  currency,
  image,
  renting_server: serverId,
  type: "on-demand",
  ports: { "22": "tcp", "8080": "http" },
  ssh_password: "GvTestPass123A1",
};

const variants = [
  ["A_minimal", { ...baseBody }],
  ["B_env_port_only", { ...baseBody, env: { COMFYUI_PORT: "8080" } }],
  ["C_env_package", { ...baseBody, env: { COMFYUI_PORT: "8080", GPUVIETNAM_DISK_GB: "40", GPUVIETNAM_PACKAGE: "starter", GPUVIETNAM_LABEL: "gv-test-label" } }],
  ["D_env_workstation", { ...baseBody, env: { COMFYUI_PORT: "8080", GPUVIETNAM_WORKSTATION: "commerce-product", GPUVIETNAM_ENV_NAME: "ComfyUI - Commerce and Product" } }],
  ["E_env_ampersand", { ...baseBody, env: { COMFYUI_PORT: "8080", GPUVIETNAM_ENV_NAME: "ComfyUI - Commerce & Product" } }],
];

const only = process.argv[3] || null;
const report = { at: new Date().toISOString(), serverId, results: [] };
for (const [label, body] of variants) {
  if (only && label !== only) continue;
  console.error("trying", label);
  try {
    report.results.push(await createAndCancel(label, body));
  } catch (e) {
    report.results.push({ label, error: e instanceof Error ? e.message : String(e) });
  }
  console.error(JSON.stringify(report.results[report.results.length - 1]));
}

mkdirSync("tmp", { recursive: true });
writeFileSync("tmp/clore-env-matrix.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
