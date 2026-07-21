const fs=require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'docs', 'ui');
const htmlPath = path.join(dir, 'session-hub-ux-preview.html');

if (fs.existsSync(htmlPath)) {
  const raw = fs.readFileSync(htmlPath);
  const isUtf16 = raw.length > 2 && raw[1] === 0;
  if (isUtf16) {
    fs.writeFileSync(htmlPath, raw.toString('utf16le'), 'utf8');
    console.log('converted html to utf8');
  }
}

const js = String.raw`const PHASES = {
  idle: {
    badge: { cls: '', text: 'Ch\u01b0a m\u1edf phi\u00ean' },
    workspaceSub: 'Ch\u1ecdn workspace tr\u01b0\u1edbc khi m\u1edf phi\u00ean',
    showCreditFull: true,
    showPerf: false,
    showCreditCompact: false,
    alerts: [],
    html: '<div class="hub-message">Ch\u01b0a m\u1edf phi\u00ean l\u00e0m vi\u1ec7c.</div><div class="hub-timer-block"><div class="hub-timer muted">00:00:00</div><div class="hub-timer-label">Timer \u1ea9n khi ch\u01b0a c\u00f3 phi\u00ean</div></div><div class="hub-actions"><button class="btn btn-primary">M\u1edf phi\u00ean l\u00e0m vi\u1ec7c</button><button class="btn btn-ghost">\u0110\u1ed5i workspace</button></div>',
  },
  'opening-gpu': {
    badge: { cls: 'starting', text: '\u0110ang m\u1edf phi\u00ean' },
    workspaceSub: 'Workspace \u0111\u00e3 kh\u00f3a',
    showCreditFull: false, showPerf: false, showCreditCompact: true, alerts: [],
    html: '<div class="boot-progress"><div class="boot-progress-fill"></div></div><div class="boot-timeline"><div class="boot-step active"><span class="boot-icon">\u25cf</span><span>\u0110ang b\u1eadt GPU...</span></div><div class="boot-step"><span class="boot-icon">\u25cb</span><span>Ch\u1edd ComfyUI</span></div><div class="boot-step"><span class="boot-icon">\u25cb</span><span>B\u1eaft \u0111\u1ea7u t\u00ednh gi\u1edd</span></div></div><div class="hub-timer-block"><div class="hub-timer muted">00:00:00</div><div class="hub-timer-label">Ch\u01b0a b\u1eaft \u0111\u1ea7u t\u00ednh gi\u1edd</div><div class="hub-timer-note">Gi\u1edd ch\u1ec9 t\u00ednh khi ComfyUI traffic-ready</div></div><div class="hub-actions"><button class="btn btn-primary" disabled>\u0110ang kh\u1edfi t\u1ea1o...</button><button class="btn btn-secondary">H\u1ee7y kh\u1edfi t\u1ea1o</button></div>',
  },
  'opening-comfy': {
    badge: { cls: 'starting', text: '\u0110ang m\u1edf phi\u00ean' },
    workspaceSub: 'GPU \u0111\u00e3 ch\u1ea1y',
    showCreditFull: false, showPerf: false, showCreditCompact: true, alerts: [],
    html: '<div class="boot-progress"><div class="boot-progress-fill"></div></div><div class="boot-timeline"><div class="boot-step done"><span class="boot-icon">\u2713</span><span>GPU \u0111\u00e3 b\u1eadt</span></div><div class="boot-step active"><span class="boot-icon">\u25cf</span><span>ComfyUI \u0111ang s\u1eb5n s\u00e0ng...</span></div><div class="boot-step"><span class="boot-icon">\u25cb</span><span>B\u1eaft \u0111\u1ea7u t\u00ednh gi\u1edd</span></div></div><div class="hub-timer-block"><div class="hub-timer muted">00:00:00</div><div class="hub-timer-label">Ch\u01b0a b\u1eaft \u0111\u1ea7u t\u00ednh gi\u1edd</div></div><div class="hub-actions"><button class="btn btn-primary" disabled>\u0110ang kh\u1edfi t\u1ea1o...</button><button class="btn btn-secondary">H\u1ee7y kh\u1edfi t\u1ea1o</button></div>',
  },
  running: {
    badge: { cls: 'online', text: '\u0110ang ch\u1ea1y' },
    workspaceSub: '\u0110\u00f3ng phi\u00ean \u0111\u1ec3 \u0111\u1ed5i workspace',
    showCreditFull: false, showPerf: true, showCreditCompact: true,
    alerts: [
      { type: 'danger', text: '\u23f0 M\u00e1y s\u1ebd t\u1eaft ngay khi h\u1ebft gi\u1edd' },
      { type: 'warning', text: '\u26a0\ufe0f M\u00e1y s\u1ebd t\u1ef1 t\u1eaft sau 12 ph\u00fat n\u1ebfu kh\u00f4ng c\u00f3 ho\u1ea1t \u0111\u1ed9ng' },
    ],
    liveTimer: true,
    html: '<div class="hub-timer-block"><div class="hub-timer" id="live-timer">01:24:08</div><div class="hub-timer-label">Th\u1eddi gian phi\u00ean \u00b7 \u0111ang t\u00ednh gi\u1edd</div></div><div class="hub-stats"><span>C\u00f2n <strong>8.42h</strong> trong g\u00f3i</span><span>Phi\u00ean n\u00e0y ~0.35h</span><span>\ud83d\uddbc\ufe0f 12 \u1ea3nh</span><span>\ud83d\udd50 Idle 4 ph\u00fat</span></div><div class="hub-actions"><button class="btn btn-primary">M\u1edf ComfyUI</button><button class="btn btn-danger">\u0110\u00f3ng phi\u00ean</button></div>',
  },
  'running-pending-bill': {
    badge: { cls: 'starting', text: '\u0110ang ch\u1ea1y' },
    workspaceSub: 'Comfy ho\u00e0n t\u1ea5t \u2014 ch\u01b0a billing',
    showCreditFull: false, showPerf: true, showCreditCompact: true, alerts: [],
    html: '<div class="hub-message warn">Comfy \u0111ang ho\u00e0n t\u1ea5t \u2014 ch\u01b0a b\u1eaft \u0111\u1ea7u t\u00ednh gi\u1edd</div><div class="hub-timer-block"><div class="hub-timer muted">00:00:00</div></div><div class="hub-actions"><button class="btn btn-primary" disabled>M\u1edf ComfyUI</button><button class="btn btn-danger">\u0110\u00f3ng phi\u00ean</button></div>',
  },
  disconnected: {
    badge: { cls: 'offline', text: 'M\u1ea5t k\u1ebft n\u1ed1i' },
    workspaceSub: '\u0110ang th\u1eed k\u1ebft n\u1ed1i l\u1ea1i',
    showCreditFull: false, showPerf: true, showCreditCompact: true, alerts: [],
    html: '<div class="hub-message warn">M\u1ea5t k\u1ebft n\u1ed1i t\u1ea1m th\u1eddi</div><div class="hub-timer-block"><div class="hub-timer paused">01:24:08</div><div class="hub-timer-label">Th\u1eddi gian phi\u00ean (t\u1ea1m d\u1eebng)</div></div><div class="hub-actions"><button class="btn btn-primary">M\u1edf ComfyUI</button><button class="btn btn-danger">\u0110\u00f3ng phi\u00ean</button></div>',
  },
  stopping: {
    badge: { cls: 'starting', text: '\u0110ang \u0111\u00f3ng phi\u00ean' },
    workspaceSub: '\u0110ang x\u1eed l\u00fd settlement',
    showCreditFull: false, showPerf: false, showCreditCompact: true, alerts: [],
    html: '<div class="hub-timer-block"><div class="hub-timer paused">01:24:08</div><div class="hub-timer-label">Phi\u00ean \u0111ang \u0111\u00f3ng</div></div><div class="hub-message">Thanh to\u00e1n \u0111ang \u0111\u01b0\u1ee3c x\u1eed l\u00fd...</div><div class="hub-actions"><button class="btn btn-danger" disabled>\u0110ang \u0111\u00f3ng phi\u00ean...</button></div>',
  },
  error: {
    badge: { cls: 'offline', text: 'L\u1ed7i' },
    workspaceSub: 'Kh\u00f4ng kh\u1edfi \u0111\u1ed9ng \u0111\u01b0\u1ee3c phi\u00ean',
    showCreditFull: true, showPerf: false, showCreditCompact: false, alerts: [],
    html: '<div class="hub-message error">Kh\u1edfi t\u1ea1o m\u00e1y th\u1ea5t b\u1ea1i</div><div class="hub-timer-block"><div class="hub-timer muted">00:00:00</div></div><div class="hub-actions"><button class="btn btn-primary">Th\u1eed l\u1ea1i</button><button class="btn btn-ghost">Li\u00ean h\u1ec7 h\u1ed7 tr\u1ee3</button></div>',
  },
};

let timerInterval = null;
let timerSeconds = 5028;

function fmt(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function renderPerf(show) {
  const perfBody = document.getElementById('perf-body');
  if (show) {
    perfBody.innerHTML = '<div class="perf-row"><div class="perf-item"><div class="value" style="color:var(--accent-green)">68%</div><div class="label">VRAM</div></div><div class="perf-item"><div class="value" style="color:var(--accent-blue)">82%</div><div class="label">GPU</div></div></div>';
  } else {
    perfBody.innerHTML = '<div class="perf-empty">M\u00e1y ch\u01b0a ch\u1ea1y</div>';
  }
}

function setPhase(phaseKey) {
  const phase = PHASES[phaseKey];
  if (!phase) return;
  document.querySelectorAll('[data-phase]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.phase === phaseKey);
  });
  const badge = document.getElementById('hub-badge');
  badge.className = 'status-badge ' + (phase.badge.cls || '');
  badge.innerHTML = '<span class="dot"></span><span id="hub-badge-text">' + phase.badge.text + '</span>';
  document.getElementById('hub-workspace-sub').textContent = phase.workspaceSub;
  document.getElementById('hub-content').innerHTML = phase.html;
  document.getElementById('credit-card').style.display = phase.showCreditFull ? 'block' : 'none';
  document.getElementById('credit-compact').style.display = phase.showCreditCompact ? 'block' : 'none';
  renderPerf(phase.showPerf);
  document.getElementById('alert-stack').innerHTML = (phase.alerts || []).map((a) => '<div class="alert ' + a.type + '">' + a.text + '</div>').join('');
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (phase.liveTimer) {
    const el = document.getElementById('live-timer');
    if (el) {
      el.textContent = fmt(timerSeconds);
      timerInterval = setInterval(() => { timerSeconds += 1; el.textContent = fmt(timerSeconds); }, 1000);
    }
  }
}

document.querySelectorAll('[data-phase]').forEach((btn) => {
  btn.addEventListener('click', () => setPhase(btn.dataset.phase));
});
document.querySelectorAll('[data-viewport]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-viewport]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('canvas').classList.toggle('mobile', btn.dataset.viewport === 'mobile');
  });
});
setPhase('running');
`;

fs.writeFileSync(path.join(dir, 'session-hub-ux-preview.js'), js, 'utf8');
console.log('wrote js utf8');
