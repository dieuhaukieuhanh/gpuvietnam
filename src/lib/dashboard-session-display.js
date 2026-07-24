/** Presentation-only helpers for dashboard session / timer UX (SCB server views). */

/** @typedef {'loading'|'idle'|'opening'|'running'|'stopping'|'disconnected'|'error'} SessionPhase */
/** @typedef {'hidden'|'muted'|'live'|'paused'} TimerDisplayMode */
/** @typedef {'gpu-boot'|'comfy-boot'} OpeningBootStep */

export function formatRuntimeClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/** Human-readable hours for plan / remaining display (2 decimal places ≈ 36s precision). */
export function formatDisplayHours(hours) {
  if (hours == null || !Number.isFinite(hours)) return '—';
  const h = Math.max(0, hours);
  if (h < 1 / 60) return '< 1 phút';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} phút`;
  const rounded = Math.round(h * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(2)}h`;
}

export function formatSessionElapsedLabel(totalSeconds) {
  return formatDisplayHours(totalSeconds / 3600);
}

export function formatIdleMinutes(totalMinutes) {
  const minutes = Math.max(0, Math.floor(totalMinutes));
  if (minutes >= 60) {
    const hour = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${hour}h${m}p` : `${hour}h`;
  }
  return `${minutes} phút`;
}

/**
 * Boot timeline step during opening — server message + infra comfyUrl hint only.
 * @param {SessionPhase|null|undefined} phase
 * @param {string|null|undefined} statusMessage
 * @param {boolean} hasComfyUrl
 * @returns {OpeningBootStep|null}
 */
export function resolveOpeningBootStep(phase, statusMessage, hasComfyUrl) {
  if (phase !== 'opening') return null;
  const msg = (statusMessage ?? '').toLowerCase();
  if (
    hasComfyUrl ||
    msg.includes('comfy') ||
    msg.includes('sẵn sàng') ||
    msg.includes('san sang') ||
    msg.includes('traffic')
  ) {
    return 'comfy-boot';
  }
  return 'gpu-boot';
}

/** @param {SessionPhase|null|undefined} phase @param {boolean} billingStarted @returns {TimerDisplayMode} */
export function resolveTimerDisplayMode(phase, billingStarted) {
  if (!phase || phase === 'idle' || phase === 'loading') return 'hidden';
  if (phase === 'opening') return 'muted';
  if (phase === 'running') {
    return billingStarted ? 'live' : 'muted';
  }
  // P0-B: Runtime DEAD / replace — wall-clock billing continues (do not freeze timer).
  if (phase === 'disconnected' && billingStarted) return 'live';
  if (phase === 'error' && billingStarted) return 'live';
  if (phase === 'disconnected' || phase === 'stopping') return 'paused';
  if (phase === 'error') return 'hidden';
  return 'hidden';
}

/** @param {SessionPhase|null|undefined} phase @param {boolean} billingStarted */
export function resolveShowSessionStats(phase, billingStarted) {
  if (phase === 'running') return true;
  if (phase === 'disconnected' || phase === 'stopping' || phase === 'error') {
    return billingStarted;
  }
  return false;
}

/** @param {SessionPhase|null|undefined} phase */
export function isPlanSessionActive(phase) {
  return (
    phase === 'opening' ||
    phase === 'running' ||
    phase === 'stopping' ||
    phase === 'disconnected' ||
    phase === 'error'
  );
}
