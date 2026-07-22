import { app } from "../../scripts/app.js";

const EXT_NAME = "gpuvietnam.cpSync";
const STORAGE_KEY = "gvn_cp_bootstrap_v1";
const SYNC_PATH = "/gpuvietnam/cp/sync";
const DEBOUNCE_MS = 3500;
const INDICATOR_ID = "gvn-cp-sync-indicator";

/** @type {{ token?: string; workflowId?: string; apiBase?: string; revision?: number } | null} */
let bootstrap = null;
/** @type {number | null} */
let knownRevision = null;
let saveTimer = null;
let saving = false;
let dirty = false;
let injectedOnce = false;
/** True after CP returned a non-empty LiteGraph (protect SoT from empty canvas autosave). */
let cpHadNodes = false;
/** After boot load finishes — ignore dirty marks from pre-inject canvas churn. */
let syncReady = false;
/**
 * Block autosave until CP inject succeeds (or CP has nothing to inject).
 * Prevents local Comfy draft / Manager race from overwriting SoT.
 */
let allowAutosave = false;
/** Soft lock after inject while Manager/frontend may still thrash the canvas. */
let bootGraceUntil = 0;
/** SoT marker we just injected — refuse saves that still carry a different gate1. */
let expectedGate1 = null;
/** Last CP document we intended to inject (for one re-inject after Manager thrash). */
let pendingInjectDocument = null;
let lastError = "";

function decodeBootstrapFromHash() {
  const raw = String(location.hash || "").replace(/^#/, "");
  if (!raw || !raw.includes("gvn_cp=")) return null;
  try {
    const params = new URLSearchParams(raw);
    const encoded = params.get("gvn_cp");
    if (!encoded) return null;
    const json = decodeBase64Url(encoded);
    const parsed = JSON.parse(json);
    if (!parsed || Number(parsed.v) !== 1) return null;
    return {
      token: parsed.t ? String(parsed.t) : undefined,
      workflowId: parsed.w ? String(parsed.w) : undefined,
      apiBase: parsed.a ? String(parsed.a).replace(/\/$/, "") : undefined,
      revision: parsed.r != null ? Number(parsed.r) : undefined,
    };
  } catch {
    return null;
  }
}

function decodeBase64Url(encoded) {
  const pad = encoded.length % 4 === 0 ? "" : "=".repeat(4 - (encoded.length % 4));
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  try {
    return decodeURIComponent(
      Array.from(bin)
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
  } catch {
    return bin;
  }
}

function clearBootstrapHash() {
  if (!location.hash.includes("gvn_cp=")) return;
  try {
    history.replaceState(null, "", location.pathname + location.search);
  } catch {
    location.hash = "";
  }
}

function loadBootstrap() {
  const fromHash = decodeBootstrapFromHash();
  if (fromHash) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fromHash));
    } catch {
      /* ignore */
    }
    clearBootstrapHash();
    return fromHash;
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function ensureIndicator() {
  let el = document.getElementById(INDICATOR_ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = INDICATOR_ID;
  el.setAttribute("aria-live", "polite");
  Object.assign(el.style, {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    zIndex: "99999",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    fontSize: "12px",
    lineHeight: "1.3",
    padding: "6px 10px",
    borderRadius: "6px",
    background: "rgba(20,20,20,0.82)",
    color: "#e8e8e8",
    pointerEvents: "none",
    maxWidth: "260px",
  });
  document.body.appendChild(el);
  return el;
}

function setStatus(text, kind) {
  const el = ensureIndicator();
  el.textContent = text;
  if (kind === "error") el.style.color = "#ffb4b4";
  else if (kind === "ok") el.style.color = "#b8f0c2";
  else el.style.color = "#e8e8e8";
}

/** A1 M3 status copy (DoD). */
const STATUS = {
  init: "Control Plane: khởi tạo…",
  loading: "Control Plane: đang tải…",
  saving: "Đang lưu…",
  saved: "Đã lưu Control Plane",
  synced: "Đã lưu Control Plane",
  ready: "Control Plane: sẵn sàng lưu",
  conflict: "Lỗi đồng bộ: có bản mới hơn trên Control Plane — đã tải lại",
  errorSync: "Lỗi đồng bộ",
};

/**
 * @param {"GET"|"PATCH"} method
 * @param {object} [body]
 */
async function syncRequest(method, body) {
  const headers = { Accept: "application/json" };
  if (bootstrap?.token) {
    headers.Authorization = `Bearer ${bootstrap.token}`;
  }
  if (body) headers["Content-Type"] = "application/json";

  const qs =
    bootstrap?.workflowId != null
      ? `?workflowId=${encodeURIComponent(bootstrap.workflowId)}`
      : "";

  // Prefer same-origin Worker path (cookie + Bearer).
  let res = await fetch(`${SYNC_PATH}${qs}`, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

  // Fallback: call Next origin directly with Comfy token (hash bootstrap).
  // Include 530 (Cloudflare origin/tunnel down) so Workspace still syncs via apiBase.
  if (
    (res.status === 404 ||
      res.status === 502 ||
      res.status === 503 ||
      res.status === 530 ||
      res.status === 521 ||
      res.status === 522 ||
      res.status === 523) &&
    bootstrap?.apiBase &&
    bootstrap?.token
  ) {
    res = await fetch(`${bootstrap.apiBase}/api/cp/comfy-sync${qs}`, {
      method,
      headers: {
        ...headers,
        Authorization: `Bearer ${bootstrap.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  const data = await res.json().catch(() => ({}));

  // Worker may hit wrong apex origin (HTML 200) — fall back to apiBase.
  const looksBroken =
    res.ok &&
    bootstrap?.apiBase &&
    bootstrap?.token &&
    method === "GET" &&
    data?.ok !== true &&
    !data?.workflow;
  if (looksBroken) {
    const direct = await fetch(`${bootstrap.apiBase}/api/cp/comfy-sync${qs}`, {
      method,
      headers: {
        ...headers,
        Authorization: `Bearer ${bootstrap.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const directData = await direct.json().catch(() => ({}));
    return { res: direct, data: directData };
  }

  return { res, data };
}

function serializeGraph() {
  try {
    if (app.graph && typeof app.graph.serialize === "function") {
      return app.graph.serialize();
    }
  } catch (err) {
    console.warn("[gpuvietnam_cp_sync] serialize failed", err);
  }
  return null;
}

function isEmptyGraphDocument(doc) {
  if (!doc || typeof doc !== "object") return true;
  if (!Array.isArray(doc.nodes)) return true;
  return doc.nodes.length === 0;
}

function documentLooksInjectable(doc) {
  return Boolean(
    doc &&
      typeof doc === "object" &&
      Array.isArray(doc.nodes) &&
      doc.nodes.length > 0 &&
      Object.keys(doc).length > 0,
  );
}

/** ComfyUI-Manager's loadGraphData wrapper calls getCanvas(); fail if canvas not mounted yet. */
function comfyCanvasReady() {
  try {
    if (app?.canvas && typeof app.canvas.getCanvas === "function") {
      const el = app.canvas.getCanvas();
      if (el) return true;
    }
    if (app?.canvas?.canvas) return true;
    if (app?.canvasEl) return true;
    const el = document.getElementById("graph-canvas") || document.querySelector("canvas.litegraph");
    return Boolean(el);
  } catch {
    return false;
  }
}

async function waitForComfyCanvas({ timeoutMs = 15_000, pollMs = 100 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (comfyCanvasReady()) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  // Soft continue — loadGraphData may still work on some builds; caller catches canvas-null.
}

function dismissComfyErrorModals() {
  try {
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
    for (const btn of buttons) {
      const label = String(btn.textContent || "").trim().toLowerCase();
      if (label === "close" || label === "đóng" || label === "×" || label === "x") {
        const root = btn.closest("dialog, [role='dialog'], .p-dialog, .comfy-modal, .p-component");
        const nearby = root?.textContent || btn.parentElement?.textContent || "";
        if (/Loading aborted|getCanvas|canvas is null|reloading workflow/i.test(nearby)) {
          btn.click();
        }
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Manager often throws once on first loadGraphData; retry after canvas settles.
 * @param {unknown} document
 */
async function injectGraphWithRetry(document, { attempts = 6 } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await waitForComfyCanvas({ timeoutMs: 8_000 });
      if (i > 0) dismissComfyErrorModals();
      await new Promise((r) => setTimeout(r, i === 0 ? 200 : 700 * i));
      await app.loadGraphData(document);
      return true;
    } catch (err) {
      lastErr = err;
      console.warn(`[gpuvietnam_cp_sync] loadGraphData attempt ${i + 1} failed`, err);
    }
  }
  if (lastErr) throw lastErr;
  return false;
}

async function loadFromCp() {
  setStatus(STATUS.loading, "info");
  const { res, data } = await syncRequest("GET");
  if (!res.ok) {
    lastError = data?.error || `HTTP ${res.status}`;
    setStatus(`${STATUS.errorSync}: tải (${lastError})`, "error");
    allowAutosave = false;
    return;
  }

  const wf = data?.workflow;
  if (!wf) {
    setStatus("Control Plane: chưa có workflow", "info");
    allowAutosave = true;
    return;
  }

  if (wf.workflowId) {
    bootstrap = { ...(bootstrap || {}), workflowId: wf.workflowId };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(bootstrap));
    } catch {
      /* ignore */
    }
  }
  knownRevision = Number(wf.revision ?? 1) || 1;
  cpHadNodes = documentLooksInjectable(wf.document);
  expectedGate1 =
    wf.document?.extra?.gate1 != null ? String(wf.document.extra.gate1) : null;

  if (!injectedOnce && wf.inject && documentLooksInjectable(wf.document)) {
    try {
      if (typeof app.loadGraphData === "function") {
        pendingInjectDocument = wf.document;
        await injectGraphWithRetry(wf.document);
        injectedOnce = true;
        // Hold autosave while Manager may still abort/reload local drafts over our inject.
        allowAutosave = false;
        bootGraceUntil = Date.now() + 20_000;
        setStatus("Đã khôi phục bài từ Control Plane", "ok");
        schedulePostInjectSettle();
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[gpuvietnam_cp_sync] loadGraphData failed", err);
      // Critical: do NOT autosave local draft over SoT after a failed inject.
      allowAutosave = false;
      setStatus(
        /canvas is null/i.test(msg)
          ? "Control Plane: chưa nạp được (Manager) — tạm khóa lưu"
          : "Control Plane: không nạp được graph — tạm khóa lưu",
        "error",
      );
      return;
    }
  }

  // Nothing to inject (empty CP) or already injected — safe to save user edits.
  allowAutosave = true;
  setStatus(injectedOnce ? STATUS.synced : STATUS.ready, "ok");
}

function canvasMatchesExpectedGate1() {
  if (!expectedGate1) return true;
  try {
    const doc = serializeGraph();
    const gate = doc?.extra?.gate1 != null ? String(doc.extra.gate1) : null;
    const title = doc?.nodes?.[0]?.title != null ? String(doc.nodes[0].title) : null;
    return gate === expectedGate1 || title === expectedGate1;
  } catch {
    return false;
  }
}

function schedulePostInjectSettle() {
  const finish = async () => {
    dismissComfyErrorModals();
    if (!canvasMatchesExpectedGate1() && pendingInjectDocument) {
      try {
        console.warn("[gpuvietnam_cp_sync] canvas drifted after inject — re-applying CP SoT");
        await injectGraphWithRetry(pendingInjectDocument, { attempts: 4 });
      } catch (err) {
        console.warn("[gpuvietnam_cp_sync] re-inject failed", err);
        allowAutosave = false;
        setStatus("Control Plane: khóa lưu (canvas lệch SoT)", "error");
        return;
      }
    }
    if (canvasMatchesExpectedGate1() || !expectedGate1) {
      allowAutosave = true;
      dirty = false;
      setStatus(STATUS.synced, "ok");
    } else {
      allowAutosave = false;
      setStatus("Control Plane: khóa lưu (canvas lệch SoT)", "error");
    }
  };
  // Two checkpoints: Manager often thrashes ~2–8s after first loadGraphData.
  setTimeout(() => {
    void finish();
  }, 8_000);
  setTimeout(() => {
    void finish();
  }, 18_000);
}

async function saveToCp({ force = false } = {}) {
  if (saving) return;
  if (!dirty && !force) return;
  if (Date.now() < bootGraceUntil && !force) {
    dirty = false;
    return;
  }
  if (!allowAutosave && !force) {
    dirty = false;
    return;
  }
  // Even force keepalive must not clobber SoT when boot inject failed.
  if (!allowAutosave && cpHadNodes && !injectedOnce) {
    dirty = false;
    return;
  }
  const document = serializeGraph();
  if (!document) return;
  // Refuse to push a drifted local draft that lost the SoT marker we just restored.
  if (
    expectedGate1 &&
    !force &&
    documentLooksInjectable(document) &&
    String(document?.extra?.gate1 || document?.nodes?.[0]?.title || "") !== expectedGate1 &&
    Date.now() < bootGraceUntil + 30_000
  ) {
    dirty = false;
    console.warn("[gpuvietnam_cp_sync] skip save — canvas gate1 != CP SoT", {
      expectedGate1,
      got: document?.extra?.gate1 || document?.nodes?.[0]?.title,
    });
    return;
  }

  // Never clobber Control Plane SoT with an empty boot canvas.
  if (isEmptyGraphDocument(document) && cpHadNodes) {
    dirty = false;
    setStatus("Control Plane: không ghi đè bằng canvas trống", "info");
    return;
  }

  saving = true;
  setStatus(STATUS.saving, "info");
  try {
    const body = {
      workflowId: bootstrap?.workflowId,
      document,
      expectedRevision: knownRevision,
    };
    const { res, data } = await syncRequest("PATCH", body);
    if (data?.skipped === "empty_document_overwrite") {
      dirty = false;
      knownRevision = Number(data?.workflow?.revision ?? knownRevision) || knownRevision;
      setStatus(STATUS.synced, "ok");
      return;
    }
    if (res.status === 409 && data?.code === "REVISION_CONFLICT") {
      // A1 M3: never silently overwrite a newer CP revision (two-tab safety).
      knownRevision = Number(data?.workflow?.revision ?? knownRevision) || knownRevision;
      if (data?.workflow?.workflowId) {
        bootstrap = { ...(bootstrap || {}), workflowId: data.workflow.workflowId };
      }
      dirty = false;
      lastError = "REVISION_CONFLICT";
      if (documentLooksInjectable(data?.workflow?.document)) {
        try {
          pendingInjectDocument = data.workflow.document;
          cpHadNodes = true;
          expectedGate1 =
            data.workflow.document?.extra?.gate1 != null
              ? String(data.workflow.document.extra.gate1)
              : expectedGate1;
          await injectGraphWithRetry(data.workflow.document, { attempts: 4 });
          injectedOnce = true;
          setStatus(STATUS.conflict, "error");
          return;
        } catch (err) {
          console.warn("[gpuvietnam_cp_sync] conflict reload failed", err);
        }
      }
      setStatus(
        `${STATUS.errorSync}: có bản mới hơn trên Control Plane (rev ${knownRevision})`,
        "error",
      );
      return;
    }
    if (!res.ok) {
      lastError = data?.error || `HTTP ${res.status}`;
      setStatus(`${STATUS.errorSync}: ${lastError}`, "error");
      return;
    }
    knownRevision = Number(data?.workflow?.revision ?? knownRevision + 1);
    if (data?.workflow?.workflowId) {
      bootstrap = { ...(bootstrap || {}), workflowId: data.workflow.workflowId };
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(bootstrap));
      } catch {
        /* ignore */
      }
    }
    if (!isEmptyGraphDocument(document)) cpHadNodes = true;
    dirty = false;
    setStatus(STATUS.saved, "ok");
  } finally {
    saving = false;
  }
}

function scheduleSave() {
  if (!syncReady) return;
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveToCp();
  }, DEBOUNCE_MS);
}

function attachGraphListeners() {
  const graph = app.graph;
  if (!graph) return;

  const mark = () => scheduleSave();

  // LiteGraph hooks (best-effort across Comfy versions)
  const prevOnNodeAdded = graph.onNodeAdded;
  graph.onNodeAdded = function (...args) {
    const r = prevOnNodeAdded?.apply(this, args);
    mark();
    return r;
  };
  const prevOnNodeRemoved = graph.onNodeRemoved;
  graph.onNodeRemoved = function (...args) {
    const r = prevOnNodeRemoved?.apply(this, args);
    mark();
    return r;
  };
  const prevOnConnectionChange = graph.onConnectionChange;
  graph.onConnectionChange = function (...args) {
    const r = prevOnConnectionChange?.apply(this, args);
    mark();
    return r;
  };

  // Periodic poll for property edits that don't fire hooks
  setInterval(() => {
    if (!app.graph) return;
    // Cheap dirty poke: if user interacted recently, serialize hash
    try {
      const ser = JSON.stringify(app.graph.serialize());
      if (attachGraphListeners._lastSer && attachGraphListeners._lastSer !== ser) {
        mark();
      }
      attachGraphListeners._lastSer = ser;
    } catch {
      /* ignore */
    }
  }, 5000);
}

function flushKeepalive() {
  if (!syncReady || !dirty) return;
  if (Date.now() < bootGraceUntil) {
    dirty = false;
    return;
  }
  if (!allowAutosave || (cpHadNodes && !injectedOnce)) {
    dirty = false;
    return;
  }
  const document = serializeGraph();
  if (!document) return;
  if (isEmptyGraphDocument(document) && cpHadNodes) {
    dirty = false;
    return;
  }
  const body = JSON.stringify({
    workflowId: bootstrap?.workflowId,
    document,
    expectedRevision: knownRevision,
  });
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (bootstrap?.token) headers.Authorization = `Bearer ${bootstrap.token}`;
  try {
    // keepalive survives tab close better than a normal async PATCH.
    void fetch(SYNC_PATH, {
      method: "PATCH",
      headers,
      credentials: "include",
      body,
      keepalive: true,
    });
    dirty = false;
  } catch {
    void saveToCp({ force: true });
  }
}

function attachLifecycleFlush() {
  const flush = () => {
    flushKeepalive();
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

app.registerExtension({
  name: EXT_NAME,
  async setup() {
    bootstrap = loadBootstrap();
    ensureIndicator();
    setStatus(STATUS.init, "info");

    // Wait until LiteGraph canvas exists — Manager's loadGraphData patch needs it.
    // Then load CP before edit listeners so empty boot canvas cannot overwrite SoT.
    try {
      await waitForComfyCanvas();
      // Give Manager / frontend a beat to finish first workflow bind.
      await new Promise((r) => setTimeout(r, 800));
      await loadFromCp();
    } catch (err) {
      console.warn("[gpuvietnam_cp_sync] boot load failed", err);
      allowAutosave = false;
      setStatus("Control Plane: không kết nối được", "error");
    }

    syncReady = true;
    dirty = false;
    attachGraphListeners();
    attachLifecycleFlush();
  },
});
