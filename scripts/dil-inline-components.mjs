// DIL-era inline components.
//
// Current official assistant text embeds component markup inline, for example
//   <Cite refs={["turn131558view0","turn131558view1"]}/>
//   <FileCite ref="turn0file0" line_range_start={49} line_range_end={50}/>
//   <Link url="https://opencode.ai/go/" title="官方套餐介绍"/>
// Older captures encoded the same things as private-use markers; those keep their own path.
//
// The markup is parsed as data and never executed, and every component is resolved against the
// capture's own tables (metadata.genui_components, search_result_groups, attachments) so rendering
// stays offline and does not invent sources.

const TAG_NAMES = ['Cite', 'FileCite', 'MemoryCite', 'Link', 'Entity', 'Chart', 'WritingBlock', 'Image'];

const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const unquote = value => {
  const text = String(value).trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).replace(/\\(["'\\])/g, '$1');
  }
  return text;
};

const parseValue = raw => {
  const text = String(raw).trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return unquote(text);
  const inner = text.slice(1, -1).trim();
  // `{{…}}` wraps an object literal, `{…}` wraps a JSX expression such as `{49}` or `{["a"]}`.
  for (const candidate of [inner, text]) {
    try { return JSON.parse(candidate); } catch { /* try the next shape */ }
  }
  if (inner === 'true') return true;
  if (inner === 'false') return false;
  if (inner === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(inner)) return Number(inner);
  return inner.replace(/^["']|["']$/g, '');
};

/** Read one attribute value: a quoted string, a brace-balanced expression, or a bare token. */
const readAttributeValue = (text, start) => {
  const first = text[start];
  if (first === '"' || first === "'") {
    let index = start + 1;
    let value = '';
    while (index < text.length && text[index] !== first) {
      if (text[index] === '\\' && index + 1 < text.length) { value += text[index + 1]; index += 2; continue; }
      value += text[index];
      index += 1;
    }
    return { value, next: index + 1 };
  }
  if (first === '{') {
    let depth = 0;
    let index = start;
    let inString = null;
    for (; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (character === '\\') index += 1;
        else if (character === inString) inString = null;
        continue;
      }
      if (character === '"' || character === "'") { inString = character; continue; }
      if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) { index += 1; break; }
      }
    }
    return { value: parseValue(text.slice(start, index)), next: index };
  }
  let index = start;
  while (index < text.length && !/\s/.test(text[index])) index += 1;
  return { value: parseValue(text.slice(start, index)), next: index };
};

/** Parse a single `<Tag …/>` or `<Tag …>children</Tag>` occurrence into data. */
export function parseInlineComponent(markup) {
  const text = String(markup);
  const open = /^<([A-Za-z][\w]*)((?:\s[^<>]*?)?)\s*(\/?)>/.exec(text);
  if (!open) return null;
  const tag = open[1];
  if (!TAG_NAMES.includes(tag)) return null;
  const selfClosing = open[3] === '/' || !text.trimEnd().endsWith(`</${tag}>`);
  const children = selfClosing ? '' : text.slice(open[0].length, text.lastIndexOf(`</${tag}>`));
  const attributeText = open[2];
  const props = {};
  let index = 0;
  while (index < attributeText.length) {
    while (index < attributeText.length && /\s/.test(attributeText[index])) index += 1;
    const name = /^[\w-]+/.exec(attributeText.slice(index));
    if (!name) break;
    index += name[0].length;
    let cursor = index;
    while (cursor < attributeText.length && /\s/.test(attributeText[cursor])) cursor += 1;
    if (attributeText[cursor] !== '=') { props[name[0]] = true; index = cursor; continue; }
    cursor += 1;
    while (cursor < attributeText.length && /\s/.test(attributeText[cursor])) cursor += 1;
    const { value, next } = readAttributeValue(attributeText, cursor);
    props[name[0]] = value;
    index = next;
  }
  return { tag, props, selfClosing, children };
}

/** Normalized per-message component list, with ranges relative to that message's own text. */
export function messageComponents(message) {
  const list = message?.metadata?.genui_components;
  if (!Array.isArray(list)) return [];
  return list
    .filter(component => Number.isInteger(component?.start_index) && Number.isInteger(component?.end_index))
    .map(component => ({
      start: component.start_index,
      end: component.end_index,
      safeUrls: (component.safe_urls || []).map(item => item?.url).filter(Boolean),
      entities: component.entities || [],
      type: component.type,
      message,
    }));
}

const overlap = (ranges, start, end) => ranges.some(range => start < range.end && end > range.start);

/**
 * Components present in `source`, either from the capture's own metadata or (for captures that ship
 * the markup without resolutions) from a conservative scan of the known tags.
 */
export function collectInlineComponents(source, { components = [], message } = {}) {
  const found = [];
  for (const component of components) {
    const start = component?.start;
    const end = component?.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start || end > source.length) continue;
    const raw = source.slice(start, end);
    const parsed = parseInlineComponent(raw);
    if (!parsed) continue;
    found.push({ start, end, raw, ...parsed, resolution: component, message: component.message || message });
  }
  const pattern = new RegExp(`<(${TAG_NAMES.join('|')})\\b[^<>]*?(?:/>|>[\\s\\S]*?</\\1>)`, 'g');
  for (const match of source.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlap(found, start, end)) continue;
    const parsed = parseInlineComponent(match[0]);
    if (!parsed) continue;
    // Only the shapes the official app emits inline; ordinary prose and code keep their text.
    const props = parsed.props;
    const looksOfficial = parsed.tag === 'MemoryCite'
      || parsed.tag === 'WritingBlock' && (props.id !== undefined || props.variant !== undefined)
      || typeof props.ref === 'string' && /^turn\w+$/.test(props.ref)
      || Array.isArray(props.refs)
      || typeof props.url === 'string' && /^https?:/i.test(props.url)
      || typeof props.category === 'string' && typeof props.value === 'string'
      || props.content !== undefined;
    if (!looksOfficial) continue;
    found.push({ start, end, raw: match[0], ...parsed, resolution: null, message });
  }
  return found.sort((a, b) => a.start - b.start);
}

const hostLabel = url => {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '');
  } catch { return null; }
};

/** Search-result index for the ref ids the inline components point at (`turn785607search0`). */
const searchIndex = message => {
  const index = new Map();
  const groups = [
    ...(message?.metadata?.search_result_groups || []),
    ...(message?.metadata?.inline_cot_expandable_content?.search_result_groups || []),
  ];
  for (const group of groups) {
    for (const entry of group?.entries || []) {
      const ref = entry?.ref_id;
      if (!ref || typeof ref.turn_index !== 'number') continue;
      index.set(`turn${ref.turn_index}${ref.ref_type}${ref.ref_index}`, { ...entry, domain: group.domain });
    }
  }
  return index;
};

const refsOf = component => {
  const { props, resolution } = component;
  const refs = [];
  if (Array.isArray(props.refs)) refs.push(...props.refs.map(String));
  else if (typeof props.refs === 'string') refs.push(props.refs);
  if (typeof props.ref === 'string') refs.push(props.ref);
  for (const entity of resolution?.entities || []) if (entity?.ref) refs.push(String(entity.ref));
  return [...new Set(refs)];
};

const urlsOf = component => {
  const { props, resolution } = component;
  const urls = [];
  if (typeof props.url === 'string') urls.push(props.url);
  for (const item of resolution?.safeUrls || []) if (typeof item === 'string') urls.push(item);
  return [...new Set(urls)];
};

const attachmentName = (component, message) => {
  const ref = typeof component.props.ref === 'string' ? component.props.ref : '';
  for (const attachment of message?.attachments || []) {
    const keys = [attachment?.id, attachment?.key, attachment?.file_id, attachment?.name].filter(Boolean).map(String);
    if (ref && keys.includes(ref)) return attachment.name || attachment.id || null;
  }
  const names = [...new Set((message?.attachments || []).map(attachment => attachment?.name).filter(Boolean))];
  if (names.length === 1) return names[0];
  if (ref) {
    const match = /turn\d+file(\d+)/.exec(ref);
    if (match && names[Number(match[1])]) return names[Number(match[1])];
  }
  return null;
};

/**
 * Render one inline component with the frozen official templates. Returns HTML, or `null` when the
 * component has no faithful representation yet — callers must still not leave the raw markup in the
 * reader.
 */
export function renderInlineComponent(component, { officialCitations, officialChartTemplates = {}, message, renderChart } = {}) {
  const { tag, props, resolution } = component;
  message = component.message || message;
  const urls = urlsOf(component);
  const index = searchIndex(message);
  const refs = refsOf(component);
  const resolved = refs.map(ref => index.get(ref)).filter(Boolean);
  const label = resolved[0]?.domain || hostLabel(urls[0] || '') || (props.value ? String(props.value) : null);
  const reference = {
    items: urls.map((url, position) => ({
      url,
      title: resolved[position]?.title || resolved[0]?.title || null,
      attribution: resolved[position]?.domain || resolved[0]?.domain || null,
    })),
    safe_urls: urls,
    refs,
  };
  switch (tag) {
    case 'Cite':
      if (!officialCitations || !urls.length) return null;
      return officialCitations.web(reference);
    case 'FileCite': {
      if (!officialCitations) return null;
      const name = attachmentName(component, message);
      const reference_ = { id: props.ref || '', name: name || '附件', source: 'file_cite' };
      if (Number.isInteger(props.line_range_start)) reference_.line_range_start = props.line_range_start;
      if (Number.isInteger(props.line_range_end)) reference_.line_range_end = props.line_range_end;
      return officialCitations.file(reference_, [reference_]);
    }
    case 'Link':
      if (!officialCitations?.url || typeof props.url !== 'string') return null;
      return officialCitations.url(props.title || label || props.url, props.url);
    case 'Chart': {
      if (typeof renderChart !== 'function' || props.content === undefined) return null;
      return renderChart(typeof props.content === 'string' ? props.content : JSON.stringify(props.content), officialChartTemplates);
    }
    case 'Entity':
      return props.value ? `<span class="text-token-text-secondary">${escapeHtml(props.value)}</span>` : null;
    case 'MemoryCite':
      // The official memory chip DOM is not frozen yet; keep a plain, non-decorative marker.
      return '<span class="text-token-text-secondary">记忆</span>';
    case 'WritingBlock':
      // The writing block body is ordinary text; drop only the wrapper element.
      return null;
    default:
      return null;
  }
}

/** Plain-text form used by Markdown exports, where interactive chips have no meaning. */
export function inlineComponentText(component) {
  const { tag, props, resolution } = component;
  const urls = urlsOf(component);
  switch (tag) {
    case 'Cite':
      return '';
    case 'FileCite':
      return props.ref ? `（附件引用 ${props.ref}）` : '（附件引用）';
    case 'Link':
      return props.url ? `[${props.title || props.url}](${props.url})` : '';
    case 'Chart':
      return props.content?.meta?.title ? `（图表：${props.content.meta.title}）` : '（图表）';
    case 'Entity':
      return props.value ? String(props.value) : '';
    case 'MemoryCite':
      return '（记忆引用）';
    case 'WritingBlock':
      return component.children || '';
    default:
      return resolution ? '' : '';
  }
}

/**
 * Text with inline components reduced to what they mean in plain prose. Used wherever assistant text
 * is summarised (navigation previews, rail labels) rather than rendered.
 */
export function stripInlineComponents(source, { message, components = [] } = {}) {
  const found = collectInlineComponents(String(source), { components, message });
  let text = String(source);
  for (const component of [...found].sort((left, right) => right.start - left.start)) {
    text = text.slice(0, component.start) + inlineComponentText(component) + text.slice(component.end);
  }
  return text;
}

const safeCopyUrl = value => {
  try {
    const url = new URL(String(value));
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
};

/**
 * Markdown form for the copy buttons and text exports: citations become reference links, links stay
 * links, and nothing that only exists as UI chrome survives as raw markup.
 */
export function inlineComponentMarkdown(component, { definitions, referencePrefix = '' } = {}) {
  const { tag, props } = component;
  const urls = urlsOf(component);
  const index = searchIndex(component.message);
  const resolved = refsOf(component).map(ref => index.get(ref)).filter(Boolean);
  const label = resolved[0]?.domain || hostLabel(urls[0] || '') || null;
  switch (tag) {
    case 'Cite': {
      const links = urls.flatMap(url => {
        const safe = safeCopyUrl(url);
        if (!safe || !definitions) return [];
        if (!definitions.has(safe)) definitions.set(safe, { id: `${referencePrefix}${definitions.size + 1}`, title: resolved[0]?.title || '' });
        const name = (label || safe).replace(/[[\]]/g, '\\$&');
        return [`[${name}][${definitions.get(safe).id}]`];
      });
      return links.length ? `(${links.join(', ')})` : '';
    }
    case 'Link': {
      const safe = safeCopyUrl(props.url);
      return safe ? `[${String(props.title || safe).replace(/[[\]]/g, '\\$&')}](${safe.replaceAll('(', '%28').replaceAll(')', '%29')})` : '';
    }
    case 'FileCite': {
      const name = attachmentName(component, component.message);
      return name ? `（${name}）` : '';
    }
    case 'Entity':
      return props.value ? String(props.value) : '';
    case 'MemoryCite':
      return '（记忆引用）';
    case 'WritingBlock':
      return component.children || '';
    case 'Chart': {
      const content = props.content;
      if (!content?.series || !content?.data) return '';
      const series = content.series || [];
      const headings = [content.xKey || '', ...series.map(item => item.label || item.dataKey)];
      const rows = content.data.map(row => [row[content.xKey], ...series.map(item => row[item.dataKey])]);
      const cell = value => String(value ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
      return [content.meta?.title, content.meta?.description, '',
        '| ' + headings.map(cell).join(' | ') + ' |',
        '| ' + headings.map(() => '---').join(' | ') + ' |',
        ...rows.map(row => '| ' + row.map(cell).join(' | ') + ' |')].filter(value => value != null).join('\n');
    }
    default:
      return '';
  }
}

export const inlineTagNames = TAG_NAMES;
