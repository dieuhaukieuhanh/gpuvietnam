/**
 * P0-C Minimal Alerting — email operator via Resend.
 *
 * Fire-and-forget. Never throws to callers. No-op when RESEND_API_KEY missing.
 *
 * Env:
 *   OPS_ALERT_EMAIL     default dieuhaukieuhanh@gmail.com (or ADMIN_NOTIFY_EMAIL)
 *   OPS_ALERT_DEDUP_MS  default 15 minutes
 *   OPS_ALERT_ENABLED   default true (set false to silence)
 *   RESEND_API_KEY      required to send
 */

import { sendEmail } from '../resend.js';

/** @typedef {'provision_timeout'|'orphan_clore'|'settlement_failed'|'machine_op_stuck'|'recovery_exhausted'|'smoke'} OpsAlertEvent */

const DEFAULT_OPS_EMAIL = 'dieuhaukieuhanh@gmail.com';
const DEFAULT_DEDUP_MS = 15 * 60 * 1000;

/** @type {Map<string, number>} */
const recent = new Map();

/** @returns {string} */
export function resolveOpsAlertEmail() {
  // Prefer OPS_ALERT_EMAIL; do not inherit ADMIN_NOTIFY_EMAIL (may be a shared inbox).
  const raw = process.env.OPS_ALERT_EMAIL || DEFAULT_OPS_EMAIL;
  return String(raw).trim();
}

/** @returns {boolean} */
export function isOpsAlertEnabled() {
  const raw = String(process.env.OPS_ALERT_ENABLED ?? 'true')
    .replace(/\r/g, '')
    .trim()
    .toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

/** @returns {number} */
export function resolveOpsAlertDedupMs() {
  const n = Number(process.env.OPS_ALERT_DEDUP_MS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DEDUP_MS;
}

/**
 * @param {string} key
 * @param {number} [nowMs]
 * @returns {boolean} true if should send
 */
export function shouldSendAlert(key, nowMs = Date.now()) {
  const dedupMs = resolveOpsAlertDedupMs();
  if (dedupMs <= 0) return true;
  const prev = recent.get(key);
  if (prev != null && nowMs - prev < dedupMs) return false;
  recent.set(key, nowMs);
  // Bound map size
  if (recent.size > 500) {
    const cutoff = nowMs - dedupMs;
    for (const [k, t] of recent) {
      if (t < cutoff) recent.delete(k);
    }
  }
  return true;
}

/** @param {unknown} details */
function formatDetailsHtml(details) {
  if (details == null) return '';
  let body;
  try {
    body =
      typeof details === 'string'
        ? details
        : JSON.stringify(details, null, 2);
  } catch {
    body = String(details);
  }
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<pre style="white-space:pre-wrap;font-size:12px;background:#f4f4f5;padding:12px;border-radius:6px">${escaped}</pre>`;
}

/**
 * @param {{
 *   event: OpsAlertEvent | string;
 *   severity?: 'critical' | 'warning' | 'info';
 *   title: string;
 *   details?: Record<string, unknown> | string | null;
 *   dedupeKey?: string | null;
 * }} input
 * @returns {Promise<{ sent: boolean; skipped?: string; id?: string }>}
 */
export async function opsAlert(input) {
  if (!isOpsAlertEnabled()) {
    return { sent: false, skipped: 'disabled' };
  }

  const event = String(input.event || 'unknown');
  const severity = input.severity || 'critical';
  const title = String(input.title || event).slice(0, 200);
  const dedupeKey = String(input.dedupeKey || `${event}:${title}`).slice(0, 300);

  if (!shouldSendAlert(dedupeKey)) {
    return { sent: false, skipped: 'deduped' };
  }

  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === 're_xxxxxxxx') {
    console.warn('[ops-alert] skip — RESEND_API_KEY not configured', { event, title });
    return { sent: false, skipped: 'no_resend_key' };
  }

  const to = resolveOpsAlertEmail();
  if (!to) {
    return { sent: false, skipped: 'no_email' };
  }

  const at = new Date().toISOString();
  const subject = `[GPUVietnam ${severity}] ${event}: ${title}`.slice(0, 240);
  const html = `
    <h2>${title}</h2>
    <p><strong>Event:</strong> ${event}<br/>
    <strong>Severity:</strong> ${severity}<br/>
    <strong>Time (UTC):</strong> ${at}</p>
    ${formatDetailsHtml(input.details)}
    <p style="color:#666;font-size:12px">P0-C ops alert · GPUVietnam</p>
  `;

  try {
    const result = await sendEmail({ to, subject, html });
    console.info('[ops-alert] sent', { event, to, id: result?.id });
    return { sent: true, id: result?.id };
  } catch (err) {
    console.error('[ops-alert] send failed', {
      event,
      message: err instanceof Error ? err.message : String(err),
    });
    return { sent: false, skipped: 'send_failed' };
  }
}

/**
 * Fire-and-forget wrapper for call sites (never await-critical).
 * @param {Parameters<typeof opsAlert>[0]} input
 */
export function opsAlertAsync(input) {
  void opsAlert(input).catch((err) => {
    console.error('[ops-alert] unexpected', err instanceof Error ? err.message : err);
  });
}

/** @internal test helper */
export function _resetOpsAlertDedupForTests() {
  recent.clear();
}
