/**
 * Render a parsed DIL document into the frozen official component shells.
 *
 * Layered by design (see TODO.md): structural components are rendered with the shells frozen from an
 * anonymous snapshot, inline formatting becomes the elements the official page emits, and anything the
 * reader cannot represent faithfully (`visualization`, unknown components) is reported as unsupported so
 * the caller can fall back to the Markdown text instead of inventing markup.
 */
import katex from 'katex';
import { htmlSafeSvg } from './serialize-html.mjs';
import { renderInlineComponent } from './dil-inline-components.mjs';

const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

// Components the reader renders with frozen shells; everything else is either inline formatting,
// an inline citation, decorative, or triggers the Markdown fallback.
const SHELL_COMPONENTS = new Set(['text', 'title', 'table', 'table-row', 'table-cell', 'list', 'list-item',
  'box', 'row', 'col', 'grid', 'grid-item', 'divider', 'blockquote', 'caption', 'badge', 'link', 'pressable',
  'popover-trigger', 'list-item']);
const INLINE_FORMATTING = { bold: 'strong', italic: 'em', code: 'code' };
// Decoration: rendered as nothing rather than as invented markup.
const DECORATION = new Set(['icon', 'favicon', 'svg', 'path', 'circle', 'rect', 'line', 'g']);
const INLINE_REFERENCES = new Set(['Cite', 'FileCite', 'CodeCite', 'MemoryCite', 'Link', 'Entity']);
const PASSTHROUGH = new Set(['fragment']);

const attributesFrom = (shell, overrides = {}) => {
  const attributes = { ...shell.attributes, ...overrides };
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([name, value]) => (value === '' ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`))
    .join('');
};

/** Pick the shell variant whose frozen attributes match the node's props. */
export function chooseShell(variants, props = {}) {
  if (!Array.isArray(variants) || !variants.length) return null;
  const score = shell => {
    let value = 0;
    if (props.header !== undefined) value += shell.tag === (props.header ? 'th' : 'td') ? 2 : 0;
    if (props.size && shell.attributes['data-d-size'] === props.size) value += 2;
    if (props.inline && shell.tag === 'span') value += 1;
    if (!props.inline && shell.tag === 'p') value += 1;
    if (props.direction && shell.attributes['data-d-direction'] === props.direction) value += 1;
    return value;
  };
  return [...variants].sort((left, right) => score(right) - score(left))[0];
}

const attributeOverrides = (type, props) => {
  const overrides = {};
  if (type === 'title' && props.size) overrides['data-d-size'] = props.size;
  if (type === 'list' && props.marker) overrides['data-d-marker'] = props.marker;
  if (type === 'badge') {
    for (const key of ['color', 'size', 'variant', 'pill', 'weight']) {
      if (props[key] !== undefined) overrides[`data-${key}`] = props[key] === true ? '' : props[key];
    }
  }
  if (['box', 'row', 'col', 'grid', 'grid-item', 'pressable'].includes(type)) {
    if (props.direction) overrides['data-d-direction'] = props.direction;
    if (props.inline) overrides['data-d-inline'] = '';
  }
  return overrides;
};

export function renderDilTree(tree, { templates, document, officialCitations, message, genuiComponents = [] } = {}) {
  const shells = templates?.components || {};
  const unsupported = new Set();
  const resolutions = new Map();
  for (const component of genuiComponents) {
    if (component.resolutionId) resolutions.set(component.resolutionId, component);
  }

  const render = node => {
    if (node === null || node === undefined) return '';
    if (typeof node === 'string') return escapeHtml(node);
    if (typeof node === 'number' || typeof node === 'boolean') return escapeHtml(String(node));
    if (Array.isArray(node)) return node.map(render).join('');
    const type = node.type;
    const children = () => (node.children || []).map(render).join('');

    if (PASSTHROUGH.has(type)) return children();
    if (INLINE_FORMATTING[type]) return `<${INLINE_FORMATTING[type]}>${children()}</${INLINE_FORMATTING[type]}>`;
    if (DECORATION.has(type)) return '';
    if (type === 'math') {
      if (typeof node.props?.value !== 'string') return '';
      return katex.renderToString(node.props.value, { output: 'html', strict: false, throwOnError: false });
    }
    if (INLINE_REFERENCES.has(type)) {
      const resolution = resolutions.get(node.props?.__resolutionId) || null;
      const rendered = renderInlineComponent(
        { tag: type, props: node.props || {}, resolution, message },
        { officialCitations },
      );
      if (rendered) return rendered;
      // Without a resolution the component degrades to its own text, never to raw markup.
      return children() || '';
    }
    if (SHELL_COMPONENTS.has(type)) {
      const shell = chooseShell(shells[type], node.props);
      if (!shell) { unsupported.add(type); return children(); }
      // Fixed wrappers come from the frozen shell; the parsed children fill its first slot.
      let slotUsed = false;
      const renderShell = (current, overrides) => {
        const attributes = attributesFrom(current, overrides);
        const inner = (current.children || []).length
          ? current.children.map(child => {
            if (!child.slot) return renderShell(child, {});
            if (slotUsed) return '';
            slotUsed = true;
            return children();
          }).join('')
          : (slotUsed ? '' : (slotUsed = true, children()));
        return `<${current.tag} class="${escapeHtml(current.class.join(' '))}"${attributes}>${inner}</${current.tag}>`;
      };
      return renderShell(shell, attributeOverrides(type, node.props));
    }
    // Unknown or non-representable: report it so the caller can prefer the Markdown fallback.
    unsupported.add(type);
    return children();
  };

  return { html: htmlSafeSvg(render(tree)), unsupported: [...unsupported] };
}
