const status = document.createElement('span');
status.className = 'sr-only';
status.setAttribute('role', 'status');
status.setAttribute('aria-live', 'polite');
document.body.append(status);
const states = new WeakMap();

function fallbackCopy(text) {
  const active = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
  } finally {
    field.remove();
    active?.focus({ preventScroll: true });
    if (selection) { selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range)); }
  }
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-ceobe-copy]');
  if (!button) return;
  event.preventDefault();
  let state = states.get(button);
  if (!state) {
    state = { label: button.getAttribute('aria-label'), title: button.getAttribute('title'), html: button.innerHTML };
    states.set(button, state);
  }
  if (state.pending) return;
  state.pending = true;
  clearTimeout(state.timer);
  let success = false;
  try {
    const text = button.getAttribute('data-ceobe-copy');
    const html = button.getAttribute('data-ceobe-copy-html');
    try {
      if (html && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        })]);
      } else {
        if (!navigator.clipboard?.writeText) throw new Error('Use fallback');
        await navigator.clipboard.writeText(text);
      }
    } catch { fallbackCopy(text); }
    success = true;
  } catch { /* Report failure rather than claiming clipboard success. */ }
  const label = success ? '已复制' : '复制失败，请手动选择文本复制';
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.setAttribute('data-ceobe-copy-state', success ? 'success' : 'error');
  status.textContent = label;
  if (success) {
    const icon = button.querySelector('svg');
    if (icon) icon.innerHTML = '<path d="M4 10l4 4 8-8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  state.pending = false;
  state.timer = setTimeout(() => {
    button.innerHTML = state.html;
    button.setAttribute('aria-label', state.label);
    button.setAttribute('title', state.title);
    button.removeAttribute('data-ceobe-copy-state');
    status.textContent = '';
  }, 2000);
});
