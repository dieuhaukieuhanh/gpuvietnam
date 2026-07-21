import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[t.slice(0, i).trim()] = v;
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const userId = "70feafcf-6ad1-4b13-bb99-eae5a538d20a";
const key = (env.CLORE_AI_KEY || env.CLORE_API_KEY || "").trim();

const { data: machines } = await sb.from("machines")
  .select("id,status,instance_id,subscription_id,billing_started_at,gpu_session_id,ip_address,port,projection_verified_at,projection_message,created_at,updated_at")
  .eq("user_id", userId)
  .order("created_at", { ascending: false })
  .limit(5);

const active = (machines||[]).filter(m => ["pending","starting","running","stopping"].includes(String(m.status)));
const m = active[0] || null;

let session = null;
if (m?.gpu_session_id) {
  const r = await sb.from("gpu_sessions").select("id,status,settlement_status,started_at,plan,subscription_id,verified_running_at").eq("id", m.gpu_session_id).maybeSingle();
  session = r.data;
}

const { data: subs } = await sb.from("subscriptions")
  .select("id,server_status,plan,billing,env_name,provisioning_started_at,provisioning_lease_id")
  .eq("user_id", userId).eq("status","active")
  .in("server_status", ["online","provisioning"]);

const ordersRes = await fetch("https://api.clore.ai/v1/my_orders", { headers: { Accept: "application/json", auth: key } });
const ordersJson = await ordersRes.json();
const online = (Array.isArray(ordersJson?.orders) ? ordersJson.orders : []).filter(o => o.online).map(o => ({
  id: String(o.id ?? o.order_id),
  si: o.si ?? o.renting_server,
  hasHttp: Boolean(o.http_pub || o.pub_cluster || o.tcp_ports),
  image: String(o.image||"").slice(0,40),
}));

let phase = "idle";
const st = String(m?.status || "");
if (subs?.some(s => s.server_status === "provisioning") && st !== "running") phase = "provisioning";
else if (st === "pending" || st === "starting") phase = "booting";
else if (st === "running" && m?.billing_started_at) phase = "running_ok";
else if (st === "running") phase = "running_waiting_billing";
else if (online.length >= 1 && !m) phase = "clore_rented_db_lag";
else if (online.length >= 1 && m && String(m.instance_id) !== online[0].id) phase = "mismatch";

const issues = [];
if (online.length > 1) issues.push("multi_gpu="+online.length);
if (online.length === 0 && phase !== "idle") issues.push("no_clore_order");
if (m && online.length === 1 && String(m.instance_id) !== online[0].id) issues.push("instance_mismatch");
if (phase === "running_ok" && !m?.ip_address && !m?.port) issues.push("no_endpoint");

const report = {
  at: new Date().toISOString(),
  phase,
  healthy: phase === "running_ok",
  inProgress: ["provisioning","booting","running_waiting_billing","clore_rented_db_lag"].includes(phase),
  issues,
  machine: m && {
    id: m.id, status: m.status, instance_id: m.instance_id,
    billing_started_at: m.billing_started_at, gpu_session_id: m.gpu_session_id,
    ip: m.ip_address, port: m.port, projection: m.projection_message, created_at: m.created_at,
  },
  session,
  subs,
  cloreOnlineCount: online.length,
  cloreOnline: online,
  latestDestroyed: !m && machines?.[0] ? { id: machines[0].id.slice(0,8), status: machines[0].status, instance_id: machines[0].instance_id, created: machines[0].created_at } : null,
};
mkdirSync("tmp", { recursive: true });
writeFileSync("tmp/session-init-now.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));