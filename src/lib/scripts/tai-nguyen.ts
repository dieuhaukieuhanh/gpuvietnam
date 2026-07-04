export function initTaiNguyen(): void {
  if (typeof window === 'undefined') return;
  const run = new Function(`// ─── TAB SWITCH ──────────────────────────────────────────────
  function switchTab(tabId) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    // Show selected tab
    document.getElementById('tab-' + tabId).classList.add('active');
    // Update button styles
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    // Find button that matches
    document.querySelectorAll('.tab-btn').forEach(btn => {
      if (btn.textContent.includes('Tổng quan') && tabId === 'overview') btn.classList.add('active');
      else if (btn.textContent.includes('Workflows') && tabId === 'workflows') btn.classList.add('active');
      else if (btn.textContent.includes('Models') && tabId === 'models') btn.classList.add('active');
      else if (btn.textContent.includes('Thư viện') && tabId === 'libraries') btn.classList.add('active');
    });
  }`);
  run();
}
