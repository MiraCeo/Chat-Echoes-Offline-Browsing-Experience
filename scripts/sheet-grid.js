// 只读表格的“顺手阅读”增强：点单元格高亮所在行列、右下角缩放。不改内容、不拦截复制；
// 表格本身仍是构建期生成的静态 <table>。

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const STEP = 0.1;
const supportsZoom = typeof document !== 'undefined' && 'zoom' in document.documentElement.style;

const clear = grid => {
  for (const cell of grid.querySelectorAll('[data-sheet-picked]')) {
    cell.removeAttribute('data-sheet-picked');
    cell.setAttribute('aria-selected', 'false');
  }
  for (const head of grid.querySelectorAll('[data-sheet-band]')) head.removeAttribute('data-sheet-band');
};

const paintZoom = (scope, toolbar, value) => {
  const percent = Math.round(value * 100);
  for (const grid of scope.querySelectorAll('table.ceobe-sheet-grid')) grid.style.zoom = String(value);
  const label = toolbar.querySelector('[data-sheet-zoom-label]');
  if (label) label.textContent = `${percent}%`;
  toolbar.dataset.sheetZoomValue = String(value);
};

const ensureToolbar = (scope, grids) => {
  if (!supportsZoom || !grids.length) return;
  const parent = grids[0].parentElement;
  if (!parent || parent.querySelector('[data-sheet-zoom]')) return;
  const toolbar = document.createElement('div');
  toolbar.dataset.sheetZoom = '';
  toolbar.className = 'ceobe-sheet-zoom';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', '表格缩放');
  toolbar.innerHTML = ''
    + '<button type="button" data-sheet-zoom-action="out" aria-label="缩小表格">−</button>'
    + '<span data-sheet-zoom-label aria-live="polite">100%</span>'
    + '<button type="button" data-sheet-zoom-action="in" aria-label="放大表格">+</button>'
    + '<button type="button" data-sheet-zoom-action="reset">重置</button>';
  toolbar.addEventListener('click', event => {
    const button = event.target.closest('[data-sheet-zoom-action]');
    if (!button) return;
    const current = Number(toolbar.dataset.sheetZoomValue || 1);
    const action = button.dataset.sheetZoomAction;
    const next = action === 'reset' ? 1
      : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((current + (action === 'in' ? STEP : -STEP)) * 10) / 10));
    paintZoom(scope, toolbar, next);
    button.focus({ preventScroll: true });
  });
  parent.insertBefore(toolbar, grids[0]);
  paintZoom(scope, toolbar, 1);
};

export function enhanceSheetGrids(scope) {
  const root = scope && typeof scope.querySelectorAll === 'function' ? scope : document;
  const grids = [...root.querySelectorAll('table.ceobe-sheet-grid')];
  if (!grids.length) return;
  ensureToolbar(root, grids);
  for (const grid of grids) {
    if (grid.dataset.sheetEnhanced === '1') continue;
    grid.dataset.sheetEnhanced = '1';
    grid.addEventListener('click', event => {
      const cell = event.target.closest?.('td');
      if (!cell || !grid.contains(cell)) return;
      const alreadyPicked = cell.hasAttribute('data-sheet-picked');
      clear(grid);
      if (alreadyPicked) return;
      cell.setAttribute('data-sheet-picked', '');
      cell.setAttribute('aria-selected', 'true');
      // 表头带 data-col（真实列序号），合并单元格因此也能对上；行头用当前行的 <th scope="row">。
      grid.querySelector(`thead th[data-col="${cell.dataset.col}"]`)?.setAttribute('data-sheet-band', '');
      cell.closest('tr')?.querySelector('th[scope="row"]')?.setAttribute('data-sheet-band', '');
    });
  }
}
