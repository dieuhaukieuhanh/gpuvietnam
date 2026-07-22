/**
 * A0.5 lab bridge — Save/Load graph to Control Plane; surface Runtime-offline Generate.
 * Injected only by lab server (not production).
 */
(function () {
  const WORKFLOW_ID =
    window.localStorage.getItem('a05_workflow_id') ||
    'f287ec3d-f268-4ddb-a0cd-460deec8e5bf';
  const TOKEN_KEY = 'a05_cp_token';

  function msg(text, ok) {
    const el = document.getElementById('a05-msg');
    if (!el) return;
    el.textContent = text;
    el.className = ok ? 'ok' : 'warn';
  }

  function token() {
    return (
      window.localStorage.getItem(TOKEN_KEY) ||
      window.sessionStorage.getItem(TOKEN_KEY) ||
      ''
    );
  }

  async function waitApp(timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const app = window.app;
      if (app?.graph && typeof app.graph.serialize === 'function') return app;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }

  async function saveCp() {
    const app = await waitApp(5000);
    if (!app) return msg('App chưa sẵn sàng', false);
    const t = token();
    if (!t) {
      return msg('Thiếu token — set localStorage.a05_cp_token (Supabase JWT)', false);
    }
    const document = app.graph.serialize();
    document.extra = document.extra || {};
    document.extra.a05 = `a05-${Date.now()}`;
    const res = await fetch(`/lab/cp/api/cp/comfy-sync`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${t}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workflowId: WORKFLOW_ID, document }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return msg(`CP save FAIL ${res.status}: ${data.error || ''}`, false);
    window.localStorage.setItem('a05_workflow_id', data.workflow?.workflowId || WORKFLOW_ID);
    msg(`Đã lưu CP rev ${data.workflow?.revision ?? '?'}`, true);
  }

  async function loadCp() {
    const app = await waitApp(5000);
    if (!app) return msg('App chưa sẵn sàng', false);
    const t = token();
    if (!t) return msg('Thiếu token — set localStorage.a05_cp_token', false);
    const res = await fetch(
      `/lab/cp/api/cp/comfy-sync?workflowId=${encodeURIComponent(WORKFLOW_ID)}`,
      { headers: { Authorization: `Bearer ${t}` } },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return msg(`CP load FAIL ${res.status}`, false);
    const doc = data.workflow?.document;
    if (!doc) return msg('CP không có document', false);
    if (typeof app.loadGraphData === 'function') {
      await app.loadGraphData(doc);
    } else if (app.graph?.configure) {
      app.graph.configure(doc);
    } else {
      return msg('Không có loadGraphData', false);
    }
    msg(`Đã nạp CP rev ${data.workflow?.revision ?? '?'}`, true);
  }

  function patchQueue() {
    const api = window.app?.api || window.api;
    if (!api || api.__a05Patched) return;
    const orig = api.queuePrompt?.bind(api);
    if (!orig) return;
    api.queuePrompt = async function patchedQueuePrompt(...args) {
      const status = document.getElementById('a05-status');
      if (status) status.textContent = 'Runtime offline — Generate bị chặn';
      try {
        return await orig(...args);
      } catch (e) {
        msg('Generate: Runtime chưa sẵn sàng', false);
        throw e;
      }
    };
    api.__a05Patched = true;
  }

  function boot() {
    document.getElementById('a05-save')?.addEventListener('click', () => void saveCp());
    document.getElementById('a05-load')?.addEventListener('click', () => void loadCp());
    const iv = setInterval(() => {
      if (window.app?.graph) {
        patchQueue();
        const st = document.getElementById('a05-status');
        if (st) st.textContent = 'Runtime offline — soạn graph OK; Generate bị chặn';
        clearInterval(iv);
      }
    }, 500);
    window.__a05 = { saveCp, loadCp, waitApp, workflowId: WORKFLOW_ID };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
