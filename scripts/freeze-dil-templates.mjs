/**
 * Freeze DIL component shells from an official DOM snapshot into the template package.
 *
 * This is migration step 3 of docs/development.md: the official page is captured (never a signed-in
 * session), the shells are sanitized down to tags, classes and enum attributes, and the stylesheets
 * that define their classes are copied next to the rest of the frozen assets. Text, ids, inline styles
 * and resource URLs are dropped, so nothing personal or temporary enters the package.
 *
 * Usage:
 *   node scripts/freeze-dil-templates.mjs --snapshot <dir-from-capture-official-dom> [--label <name>]
 *   node scripts/freeze-dil-templates.mjs --report <dir>      # inspect without writing
 */
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseHTML } from 'linkedom';

const projectRoot = resolve(import.meta.dirname, '..');
const packageRoot = join(projectRoot, 'official-templates');
const assetRoot = join(packageRoot, 'assets');
const outputPath = join(packageRoot, 'dil.json');

// Attributes that carry structure or styling intent. Everything else (href, src, id, style, aria-*)
// is either personal, temporary, or filled in later from the parsed tree.
const KEPT_ATTRIBUTES = [
  'data-d-component', 'data-d-direction', 'data-d-inline', 'data-d-inline-text', 'data-d-text-flow',
  'data-d-marker', 'data-d-marker-layout', 'data-d-size', 'data-d-weight', 'data-d-variant',
  'data-d-auto-spacing', 'data-d-has-border', 'data-d-has-width', 'data-d-has-height',
  'data-color', 'data-size', 'data-pill', 'data-variant', 'role', 'type', 'dir',
];
// Fixed SVG geometry that is part of the icon shell rather than of one icon.
const KEPT_SVG_ATTRIBUTES = ['width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width', 'data-rtl-flip', 'aria-hidden'];

/**
 * Shell of one component: tag, classes, kept attributes, plus its fixed inner wrappers. Wrapper
 * children are kept structurally (`table` sits inside a frame `div`, a list item inside a content
 * `div`), while anything that carries text or is itself a component becomes a `{ slot: true }` marker
 * the renderer fills from the parsed tree.
 */
export function shellOf(element, { slots = true, depth = 0 } = {}) {
  const attributes = {};
  for (const attribute of element.attributes) {
    const isSvg = element.tagName.toLowerCase() === 'svg';
    if (!KEPT_ATTRIBUTES.includes(attribute.name) && !(isSvg && KEPT_SVG_ATTRIBUTES.includes(attribute.name))) continue;
    attributes[attribute.name] = String(attribute.value);
  }
  const shell = {
    tag: element.tagName.toLowerCase(),
    class: (element.getAttribute('class') || '').split(/\s+/).filter(Boolean),
    attributes,
  };
  if (!slots || depth >= 4) return shell;
  const hasOwnText = node => [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim());
  const children = [];
  for (const child of element.children) {
    if (child.hasAttribute('data-d-component') || hasOwnText(child)) children.push({ slot: true });
    else children.push(shellOf(child, { slots: true, depth: depth + 1 }));
  }
  if (children.length) shell.children = children;
  return shell;
}

/** Which frozen stylesheet defines each class? Classes without an owner are reported as gaps. */
export async function classOwners(classes, stylesheetDir) {
  const owners = new Map();
  const files = (await readdir(stylesheetDir).catch(() => [])).filter(name => name.endsWith('.css'));
  const contents = new Map();
  for (const name of files) contents.set(name, await readFile(join(stylesheetDir, name), 'utf8'));
  for (const name of classes) {
    const found = [];
    for (const [file, text] of contents) if (text.includes(`.${name}`)) found.push(file);
    owners.set(name, found);
  }
  return owners;
}

/**
 * Distinct shells per component. A component's tag depends on its props (a `title` renders as `h2` or
 * `h3`, a `table-cell` as `th` or `td`), so the package keeps the variants it has seen instead of
 * pretending there is one canonical shape.
 */
export function componentsFromSnapshot(html, { maxVariants = 6 } = {}) {
  const { document } = parseHTML(html);
  for (const node of document.querySelectorAll('script, style')) node.remove();
  const components = new Map();
  for (const node of document.querySelectorAll('[data-d-component]')) {
    const name = node.getAttribute('data-d-component');
    const shell = shellOf(node);
    const signature = `${shell.tag}|${shell.class.join('.')}|${JSON.stringify(shell.attributes)}`;
    if (!components.has(name)) components.set(name, new Map());
    const variants = components.get(name);
    if (!variants.has(signature) && variants.size < maxVariants) variants.set(signature, shell);
  }
  return new Map([...components.entries()].map(([name, variants]) => [name, [...variants.values()]]));
}

async function freeze({ snapshot, label, dryRun = false }) {
  const htmlPath = join(snapshot, 'rendered.html');
  if (!existsSync(htmlPath)) throw new Error(`No rendered.html in ${snapshot}; run capture-official-dom.mjs first`);
  const components = componentsFromSnapshot(await readFile(htmlPath, 'utf8'));
  if (!components.size) throw new Error('The snapshot renders no DIL components (data-d-component)');

  const classes = new Set([...components.values()].flat().flatMap(shell => shell.class));
  const owners = await classOwners(classes, join(snapshot, 'css'));
  const stylesheets = [...new Set([...owners.values()].flat())].sort();
  const gaps = [...classes].filter(name => (owners.get(name) || []).length === 0).sort();

  const existing = existsSync(outputPath) ? JSON.parse(await readFile(outputPath, 'utf8')) : null;
  const manifest = {
    version: 1,
    format: 'ceobe-dil-component-shells',
    source: {
      label: label || basename(snapshot),
      captured_at: new Date().toISOString(),
      note: 'Anonymous share-page snapshot; shells carry no text, ids, inline styles or resource URLs.',
    },
    components: Object.fromEntries([...components.entries()].sort()),
    stylesheets,
    classlessOrUnownedClasses: gaps,
  };
  const previous = existing ? Object.keys(existing.components || {}).length : 0;
  if (dryRun) return { manifest, copied: [], gaps, previous };

  await mkdir(assetRoot, { recursive: true });
  const copied = [];
  for (const name of stylesheets) {
    const target = join(assetRoot, name);
    if (!existsSync(target)) { await cp(join(snapshot, 'css', name), target); copied.push(name); }
  }
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, copied, gaps, previous };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { values } = parseArgs({ options: {
    snapshot: { type: 'string' },
    label: { type: 'string' },
    report: { type: 'string' },
  } });
  const target = values.snapshot || values.report;
  if (!target) {
    console.error([
      '从官方 DOM 快照冻结 DIL 组件外壳；显式调用，不参与构建。',
      '用法：',
      '  node scripts/freeze-dil-templates.mjs --snapshot data/private/official-dom/<label> [--label <名称>]',
      '  node scripts/freeze-dil-templates.mjs --report data/private/official-dom/<label>',
    ].join('\n'));
    process.exitCode = 2;
  } else {
    const { manifest, copied, gaps, previous } = await freeze({
      snapshot: resolve(target),
      label: values.label,
      dryRun: Boolean(values.report),
    });
    console.log(`${values.report ? '（只读检查，未写入）' : ''}组件外壳：${Object.keys(manifest.components).length} 个（此前 ${previous} 个）`);
    console.log(`样式表：${manifest.stylesheets.length} 个（新复制 ${copied.length} 个）`);
    if (gaps.length) console.log(`没有对应样式表的类（${gaps.length}）：${gaps.join(' ')}`);
    if (!values.report) console.log(`写入：${outputPath}`);
  }
}
