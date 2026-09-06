const toggles = [...document.querySelectorAll('[data-ceobe-sources-toggle]')];
const toggle = toggles[0];
const panel = document.querySelector('[data-ceobe-sources-panel]');
const rail = document.querySelector('[data-ceobe-prompt-rail]');
let expanded = false;
function setOpen(open) {
  panel.hidden = !open;
  for (const control of toggles) {
    control.setAttribute('aria-pressed', String(open));
    control.setAttribute('aria-expanded', String(open));
  }
  if (rail) rail.hidden = open;
}
function filter() {
  const query = panel.querySelector('input').value.trim().toLocaleLowerCase();
  for (const [index, section] of [...panel.querySelectorAll('[data-ceobe-source-section]')].entries()) {
    const rows = [...section.querySelectorAll('li')];
    rows.forEach((row, i) => { row.hidden = !row.textContent.toLocaleLowerCase().includes(query) || (!index && !query && !expanded && i >= 6); });
    const more = section.querySelector('[data-ceobe-source-more]');
    if (more) { more.hidden = Boolean(query) || rows.length <= 6; more.textContent = expanded ? '收起' : `再显示 ${rows.length - 6} 个`; }
  }
}
for (const control of toggles) control.addEventListener('click', () => setOpen(panel.hidden));
panel.querySelector('input').addEventListener('input', filter);
document.addEventListener('click', event => {
  const collapse = event.target.closest('[data-ceobe-source-collapse]');
  if (collapse) {
    const body = collapse.closest('section').querySelector('[data-ceobe-source-body]');
    body.hidden = !body.hidden; collapse.setAttribute('aria-expanded', String(!body.hidden));
  }
  if (event.target.closest('[data-ceobe-source-more]')) { expanded = !expanded; filter(); }
  if (event.target.closest('[data-ceobe-open-preview]')) setOpen(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !panel.hidden) { setOpen(false); toggle.focus(); }
});
filter();
import './prompt-rail.js';
