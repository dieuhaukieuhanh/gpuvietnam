import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

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
process.env.GPU_CLORE_ONLY = "true";

const { CloreClient, sanitizeCloreContainerEnv } = await import(
  pathToFileURL(join(process.cwd(), "src/lib/gpu/providers/clore/clore-client.js")).href
);

const dirtyEnv = {
  GPUVIETNAM_WORKSTATION: "commerce-product",
  GPUVIETNAM_ENV_NAME: "ComfyUI — Commerce & Product",
  GPUVIETNAM_ENV_ICON: "🛒",
};
const cleanEnv = sanitizeCloreContainerEnv(dirtyEnv);
const mode = process.argv[2] || "clean";
const env = mode === "dirty" ? dirtyEnv : cleanEnv;
const client = new CloreClient();
const report = { at: new Date().toISOString(), mode, env, dirtyEnv, cleanEnv };

try {
  const raw = await client.createInstance({
    gpuLine: "rtx3090",
    plan: "starter",
    label: "gv-uitest-" + mode + "-" + Date.now().toString(36).slice(-6),
    env,
  });
  const oid = String(raw?.order_id ?? raw?.id ?? "");
  report.created = { id: oid, si: raw?.si ?? null };
  if (oid) {
    await new Promise((r) => setTimeout(r, 6000));
    report.cancel = await client.destroyInstance(oid);
  }
} catch (e) {
  report.error = e instanceof Error ? e.message : String(e);
}
mkdirSync("tmp", { recursive: true });
writeFileSync("tmp/clore-ui-env.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
