// CEOBE 采集器（扩展版，MAIN world）——0.1 探针
// 页面上下文运行，因此可以读到 React fiber 上的 props；userscript 做不到这一点。
(() => {
  'use strict';

  const TOAST_MS = 9000;
  const toast = (message, tone = 'info') => {
    const node = document.createElement('div');
    node.textContent = message;
    Object.assign(node.style, {
      position: 'fixed', left: '16px', bottom: '64px', zIndex: 2147483647,
      padding: '10px 14px', borderRadius: '10px', font: '13px/1.5 system-ui, sans-serif',
      color: '#fff', background: tone === 'error' ? '#b42318' : '#1f2937',
      boxShadow: '0 6px 24px rgba(0,0,0,.25)', maxWidth: '420px', whiteSpace: 'pre-wrap',
    });
    document.body.append(node);
    setTimeout(() => node.remove(), TOAST_MS);
  };

  const fiberKeyOf = node => Object.keys(node).find(key => key.startsWith('__reactFiber$'));

  const safeJson = value => {
    try { return JSON.stringify(value); } catch { return ''; }
  };

  // 从任意 DOM 节点沿 fiber 向上找，收集携带会话或 DIL 载荷的 props 对象。
  const scanProps = () => {
    const found = [];
    const seen = new Set();
    const nodes = document.querySelectorAll('[data-turn-key], [data-user-message-bubble], [data-d-component], main div');
    let examined = 0;
    for (const node of nodes) {
      const key = fiberKeyOf(node);
      if (!key) continue;
      let fiber = node[key];
      for (let depth = 0; fiber && depth < 60; depth += 1) {
        const props = fiber.memoizedProps;
        if (props && typeof props === 'object' && !seen.has(props)) {
          seen.add(props);
          examined += 1;
          const json = safeJson(props);
          if (json.includes('"mapping"') || json.includes('model_dil_v2') || json.includes('"current_node"')) {
            found.push({
              depth,
              keys: Object.keys(props).slice(0, 14),
              kb: Math.round(json.length / 1024),
              hasMapping: json.includes('"mapping"'),
              hasDil: json.includes('model_dil_v2'),
              hasCurrentNode: json.includes('"current_node"'),
              props,
            });
          }
        }
        fiber = fiber.return;
      }
      if (found.length >= 20) break;
    }
    return { found, examined, seen: seen.size };
  };

  const report = () => {
    const { found, examined, seen } = scanProps();
    console.log('[CEOBE] probe', { examined, seen, found: found.map(item => ({ ...item, props: undefined })) });
    if (!found.length) {
      toast('探针：没有在 React props 里找到会话数据（检查了 ' + examined + ' 个 props）', 'error');
      return;
    }
    const best = found.slice().sort((left, right) => right.kb - left.kb)[0];
    toast('探针：命中 ' + found.length + ' 个，最大 ' + best.kb + ' KB\nkeys: ' + best.keys.join(', '));
  };

  const collect = () => {
    const { found } = scanProps();
    if (!found.length) { toast('没有可导出的会话数据，先点「探针」看看', 'error'); return; }
    const best = found.slice().sort((left, right) => right.kb - left.kb)[0];
    const text = JSON.stringify({
      kind: 'ceobe.props-capture',
      schema_version: '0.1.0',
      captured_at: new Date().toISOString(),
      source: { type: 'chatgpt_web_extension', url: location.href, method: 'react-fiber-probe' },
      probe: found.map(item => ({ depth: item.depth, kb: item.kb, keys: item.keys, hasMapping: item.hasMapping, hasDil: item.hasDil })),
      payload: best.props,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ceobe-props-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('已导出最大的一份 props（' + best.kb + ' KB）');
  };

  const mount = () => {
    if (document.getElementById('ceobe-extension-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'ceobe-extension-bar';
    Object.assign(bar.style, { position: 'fixed', left: '12px', bottom: '12px', zIndex: 2147483647, display: 'flex', gap: '6px' });
    const make = (label, handler) => {
      const button = document.createElement('button');
      button.textContent = label;
      Object.assign(button.style, {
        padding: '6px 10px', borderRadius: '8px', border: '1px solid #d0d5dd', background: '#fff',
        font: '12px/1.2 system-ui, sans-serif', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.12)',
      });
      button.addEventListener('click', handler);
      return button;
    };
    bar.append(make('CEOBE 探针', report), make('CEOBE 导出', collect));
    document.body.append(bar);
  };

  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
  console.info('[CEOBE] 扩展版 0.1 就绪（MAIN world）');
})();
