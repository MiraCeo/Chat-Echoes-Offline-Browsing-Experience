/**
 * Official DOM snapshot and diff — an explicit, opt-in maintenance tool.
 *
 * It answers "did the official page change under our frozen template package?" without becoming part
 * of the build: nothing here runs during `npm run library`, `npm run build` or `npm test`.
 *
 * Hard rules (see docs/development.md):
 *   - only an anonymous browser context is used; a signed-in session would cross the project's line;
 *   - every artifact lands inside data/private/ (including the rendered DOM and screenshots);
 *   - archive/ is never read from or written to by this tool.
 *
 * Usage:
 *   node scripts/capture-official-dom.mjs --url <https://chatgpt.com/share/…> [--label <name>]
 *   node scripts/capture-official-dom.mjs --saved <dir-with-saved-page> [--label <name>]
 *   node scripts/capture-official-dom.mjs --compare-only <snapshot-dir>
 */
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parseHTML } from 'linkedom';

const projectRoot = resolve(import.meta.dirname, '..');
const privateRoot = join(projectRoot, 'data', 'private', 'official-dom');
const frozenRoot = join(projectRoot, 'official-templates');
const frozenAssetRoot = join(frozenRoot, 'assets');
const ARCHIVE_ROOT = join(projectRoot, 'archive');

// Component families the reader cares about. Their presence/absence in the live page is the signal
// that something we froze is no longer what the official page renders.
const KNOWN_MARKERS = {
  'generative UI (DIL)': /puik-root|DilRenderer|DilResponseRoot|not-markdown/,
  'chain of thought v5': /cot-v5|CotV5|cot-message/,
  'user bubble': /user-message-bubble-color|corner-superellipse/,
  'turn action rows': /copy-turn-action-button|data-testid="conversation-turn-/,
  'expand control': /A_HxFq_|showMoreLabel/,
  'writing block': /data-writing-block|writing-block/,
  'markdown body (reader baseline)': /markdown-new-styling|fbskMG_root/,
  'table wrapper (reader baseline)': /TyagGW_tableContainer/,
};

const isInside = (parent, child) => {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

/** Every snapshot target must stay inside data/private; archive/ is off limits by construction. */
export function resolveSnapshotDir({ label, out } = {}) {
  const fallback = label || `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const target = out ? resolve(out) : join(privateRoot, fallback);
  if (isInside(ARCHIVE_ROOT, target)) throw new Error('Refusing to write inside archive/: it is an append-only source of truth');
  if (!isInside(join(projectRoot, 'data', 'private'), target)) {
    throw new Error('Snapshot output must stay inside data/private/ so captures and screenshots are never published');
  }
  return target;
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

/** Depth-limited tag/class signature of a subtree; structure only, never message text. */
export function structuralSignature(node, depth = 0, maxDepth = 4) {
  if (!node || depth > maxDepth) return null;
  const classes = (node.getAttribute?.('class') || '').split(/\s+/).filter(Boolean);
  return {
    tag: node.tagName?.toLowerCase(),
    class: classes,
    attrs: Object.fromEntries([...node.attributes || []]
      .filter(attribute => !['class', 'style'].includes(attribute.name))
      .map(attribute => [attribute.name, String(attribute.value).slice(0, 80)])),
    children: [...node.children || []].slice(0, 12).map(child => structuralSignature(child, depth + 1, maxDepth)).filter(Boolean),
  };
}

/** Selector preludes, including rules nested inside at-rules (`@media`, `@container`, `@layer`). */
export function selectorsOf(text) {
  const selectors = new Set();
  const source = String(text);
  let buffer = '';
  let inString = null;
  let inComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inComment) {
      if (character === '*' && source[index + 1] === '/') { inComment = false; index += 1; }
      continue;
    }
    if (inString) {
      if (character === '\\') index += 1;
      else if (character === inString) inString = null;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') { inComment = true; index += 1; continue; }
    if (character === '"' || character === "'") { inString = character; continue; }
    if (character === '{') {
      const prelude = buffer.trim();
      buffer = '';
      // At-rule preludes are not selectors; the rules they contain are picked up on their own braces.
      if (prelude && !prelude.startsWith('@')) {
        for (const part of prelude.split(',')) {
          const selector = part.trim();
          if (selector) selectors.add(selector);
        }
      }
      continue;
    }
    if (character === '}' || character === ';') { buffer = ''; continue; }
    buffer += character;
  }
  return selectors;
}

/** Normalized selector, rule, class and design-token inventories, used to measure drift. */
export function stylesheetInventory(text) {
  const rules = new Set();
  for (const chunk of String(text).split('}')) {
    const rule = chunk.trim().replace(/\s+/g, ' ');
    if (rule) rules.add(rule);
  }
  const selectors = selectorsOf(text);
  const classes = new Set([...String(text).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(match => match[1]));
  const tokens = new Map();
  for (const match of String(text).matchAll(/(--[\w-]+)\s*:\s*([^;}]+)[;}]/g)) {
    if (!tokens.has(match[1])) tokens.set(match[1], new Set());
    tokens.get(match[1]).add(match[2].trim().replace(/\s+/g, ' '));
  }
  return { rules, selectors, classes, tokens };
}

export function compareInventories(frozen, current) {
  const sharedSelectors = [...frozen.selectors].filter(selector => current.selectors.has(selector));
  const changedTokens = [];
  for (const [token, values] of frozen.tokens) {
    if (!current.tokens.has(token)) continue;
    const before = [...values].sort().join(' | ');
    const after = [...current.tokens.get(token)].sort().join(' | ');
    if (before !== after) changedTokens.push(token);
  }
  return {
    frozenSelectors: frozen.selectors.size,
    currentSelectors: current.selectors.size,
    sharedSelectors: sharedSelectors.length,
    sharedRatio: Number((sharedSelectors.length / Math.max(1, frozen.selectors.size)).toFixed(3)),
    frozenOnlySelectors: [...frozen.selectors].filter(selector => !current.selectors.has(selector)).slice(0, 60),
    changedTokenCount: changedTokens.length,
    changedTokenSample: changedTokens.slice(0, 30),
  };
}

/** Classes the frozen templates rely on that the current stylesheets do not define at all. */
export function staleTemplateClasses(frozenMarkupClasses, currentClasses) {
  const stale = [];
  for (const name of frozenMarkupClasses) {
    if (!currentClasses.has(name)) stale.push(name);
  }
  return stale;
}

export function classesUsedByFrozenTemplates(shellHtml, templates) {
  const classes = new Set();
  const collect = text => {
    for (const match of String(text).matchAll(/class="([^"]*)"/g)) {
      for (const name of match[1].split(/\s+/)) {
        // Skip utility syntax; only plain component classes are meaningful here.
        if (!name || /[:[\]@()/!%.,#'"&*+~=<>]/.test(name) || name.includes('--')) continue;
        classes.add(name);
      }
    }
  };
  collect(shellHtml);
  for (const value of Object.values(templates)) collect(typeof value === 'string' ? value : JSON.stringify(value));
  return classes;
}

export function probeMarkers(html) {
  const text = String(html);
  return Object.fromEntries(Object.entries(KNOWN_MARKERS).map(([name, pattern]) => [name, pattern.test(text)]));
}

const readIfExists = async path => {
  try { return await readFile(path, 'utf8'); } catch { return null; }
};

async function frozenPackage() {
  const shellHtml = (await readIfExists(join(frozenRoot, 'shell.html'))) || '';
  const templatesRaw = (await readIfExists(join(frozenRoot, 'templates.json'))) || '{}';
  const templates = JSON.parse(templatesRaw);
  const assets = await readdir(frozenAssetRoot);
  const css = [];
  for (const name of assets) {
    if (!name.endsWith('.css')) continue;
    css.push({ name, text: await readFile(join(frozenAssetRoot, name), 'utf8') });
  }
  return { shellHtml, templates, css, classes: classesUsedByFrozenTemplates(shellHtml, templates) };
}

/** Static HTML as served, plus the stylesheets it references by relative path. */
async function fetchStatic(url, outDir) {
  const response = await fetch(url, {
    redirect: 'error',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(60000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(join(outDir, 'raw'), { recursive: true });
  await writeFile(join(outDir, 'raw', 'share.html'), bytes);
  await writeFile(join(outDir, 'raw', 'capture.json'), `${JSON.stringify({
    source_url: url,
    captured_at: new Date().toISOString(),
    status: response.status,
    content_type: response.headers.get('content-type'),
    bytes: bytes.length,
    sha256: sha256(bytes),
    scope: 'Static HTTP response only. The rendered DOM below comes from a separate anonymous browser pass.',
  }, null, 2)}\n`);
  return { status: response.status, bytes: bytes.length, html: bytes.toString('utf8') };
}

/** Walk the virtualized thread so every turn that can be mounted is seen exactly once. */
async function browserPass({ url, outDir, viewport, deviceScaleFactor }) {
  const { chromium } = await import('playwright');
  const channel = process.env.CEOBE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
  // Fresh anonymous context: never a persistent profile, never the user's cookies.
  const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`.slice(0, 300)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 300)); });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('section[data-testid^="conversation-turn-"]', { timeout: 60000 });
    // Answers hydrate (and stream) after the first turn appears; a fixed sleep captured empty replies.
    // Wait until the thread's text stops growing for several consecutive reads.
    const settle = async () => {
      let previous = -1;
      let stable = 0;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const length = await page.evaluate(() => [...document.querySelectorAll('section[data-testid^="conversation-turn-"]')]
          .reduce((sum, node) => sum + (node.textContent || '').length, 0));
        if (length > 0 && length === previous) {
          stable += 1;
          if (stable >= 3) return length;
        } else {
          stable = 0;
        }
        previous = length;
        await page.waitForTimeout(500);
      }
      return previous;
    };
    const settledChars = await settle();
    await page.waitForTimeout(1000);
    const collected = await page.evaluate(async () => {
      const seen = new Map();
      const sleep = ms => new Promise(done => setTimeout(done, ms));
      const scrollerOf = () => {
        let best = document.scrollingElement || document.documentElement;
        let range = best.scrollHeight - best.clientHeight;
        for (const element of document.querySelectorAll('div, main, section')) {
          const style = getComputedStyle(element);
          if (!/auto|scroll/.test(style.overflowY)) continue;
          const candidate = element.scrollHeight - element.clientHeight;
          if (candidate > range + 200) { best = element; range = candidate; }
        }
        return best;
      };
      const grab = () => {
        for (const turn of document.querySelectorAll('section[data-testid^="conversation-turn-"]')) {
          const id = turn.getAttribute('data-turn-id');
          if (!id || seen.has(id)) continue;
          const answerClasses = [...turn.querySelectorAll('div')]
            .flatMap(node => (node.getAttribute('class') || '').split(/\s+/))
            .filter(name => /^(puik|fv0XaG|J4E5kq|TzNmiG|fbskMG|TyagGW|A_HxFq|cot-|cot_)/.test(name));
          seen.set(id, {
            id,
            testid: turn.getAttribute('data-testid'),
            turn: turn.getAttribute('data-turn'),
            // Structure only: no message text leaves the page.
            textLength: (turn.textContent || '').length,
            hasGenerativeUi: Boolean(turn.querySelector('.puik-root, [class*="DilRenderer"]')),
            hasMarkdownBody: Boolean(turn.querySelector('.markdown, [class*="markdown-new-styling"]')),
            hasPreWrap: Boolean(turn.querySelector('.whitespace-pre-wrap')),
            answerClasses: [...new Set(answerClasses)].slice(0, 20),
          });
        }
      };
      const scroller = scrollerOf();
      scroller.setAttribute('data-ceobe-snapshot-scroller', '');
      for (let pass = 0; pass < 2; pass += 1) {
        scroller.scrollTop = 0;
        await sleep(700);
        grab();
        for (let step = 0; step < 400; step += 1) {
          const before = scroller.scrollTop;
          scroller.scrollTop = before + Math.round(scroller.clientHeight * 0.8);
          await sleep(280);
          grab();
          if (scroller.scrollTop === before
            || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8) break;
        }
      }
      // Gap sweep: the virtualizer keeps only a window, so jumping to the estimated offset of a turn
      // index we never saw usually mounts it. The report records coverage so a partial capture is visible.
      const maxIndex = Math.max(0, ...[...seen.values()].map(turn => Number((turn.testid || '').split('-').pop()) || 0));
      const hasTurn = index => [...seen.values()].some(turn => turn.testid === `conversation-turn-${index}`);
      const scrollRange = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      let sweeps = 0;
      for (let index = 1; index <= maxIndex && sweeps < 240; index += 1) {
        if (hasTurn(index)) continue;
        const target = Math.round(((index - 1) / Math.max(1, maxIndex - 1)) * scrollRange);
        for (const delta of [-1, 0, 1]) {
          scroller.scrollTop = Math.max(0, Math.min(scrollRange, target + delta * Math.round(scroller.clientHeight * 0.7)));
          await sleep(180);
          grab();
          sweeps += 1;
          if (hasTurn(index)) break;
        }
      }
      const missingTurnIndexes = [];
      for (let index = 1; index <= maxIndex; index += 1) if (!hasTurn(index)) missingTurnIndexes.push(index);
      return {
        turns: [...seen.values()],
        scrollHeight: scroller.scrollHeight,
        maxIndex,
        coverage: Number((seen.size / Math.max(1, maxIndex)).toFixed(3)),
        missingTurnIndexes,
        stylesheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => link.getAttribute('href')).filter(Boolean),
        html: document.body.outerHTML,
      };
    });
    await mkdir(join(outDir, 'screenshots'), { recursive: true });
    await page.screenshot({ path: join(outDir, 'screenshots', 'thread-bottom.png') });
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-ceobe-snapshot-scroller]');
      if (scroller) scroller.scrollTop = 0;
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(outDir, 'screenshots', 'thread-top.png') });
    return { ...collected, errors, settledChars };
  } finally {
    await context.close();
    await browser.close();
  }
}

/** Download (or copy) the stylesheets the page actually uses, so drift can be measured offline. */
async function collectStylesheets({ outDir, hrefs, savedDir }) {
  const directory = join(outDir, 'css');
  await mkdir(directory, { recursive: true });
  const saved = [];
  for (const href of [...new Set(hrefs)].slice(0, 80)) {
    const name = basename(href.split('#')[0].split('?')[0]) || 'stylesheet.css';
    try {
      if (savedDir) {
        const local = join(savedDir, decodeURIComponent(href.replace(/^\.\//, '')));
        const info = await stat(local).catch(() => null);
        if (!info?.isFile()) continue;
        await cp(local, join(directory, name));
        saved.push({ href, name, bytes: info.size, origin: 'saved' });
        continue;
      }
      if (!/^https?:|^\//.test(href)) continue;
      const absolute = href.startsWith('/') ? `https://chatgpt.com${href}` : href;
      if (!/^https:\/\/(chatgpt\.com|cdn\.oaistatic\.com)\//.test(absolute)) continue;
      const response = await fetch(absolute, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) continue;
      const text = await response.text();
      await writeFile(join(directory, name), text, 'utf8');
      saved.push({ href: absolute, name, bytes: text.length, origin: 'network' });
    } catch {
      // A failed stylesheet keeps the snapshot useful; the report lists what was actually compared.
    }
  }
  return saved;
}

/** `conversation-small-iha453gv.css` → `conversation-small`; the hash is a single dash-free token. */
export const stylesheetFamily = name => String(name).replace(/-[A-Za-z0-9]+\.css$/, '').replace(/\.css$/, '');

/**
 * Candidates for pairing a current stylesheet with frozen ones. Exact names win; a renamed build of the
 * same family is compared against every frozen variant and the closest one is reported, so alternatives
 * from earlier captures never masquerade as drift.
 */
export function pairStylesheets(currentNames, frozenNames) {
  const frozenFamilies = new Map();
  for (const name of frozenNames) {
    const family = stylesheetFamily(name);
    if (!frozenFamilies.has(family)) frozenFamilies.set(family, []);
    frozenFamilies.get(family).push(name);
  }
  const pairs = [];
  const unmatched = [];
  for (const name of [...new Set(currentNames)].sort()) {
    if (frozenNames.includes(name)) {
      pairs.push({ family: stylesheetFamily(name), current: name, candidates: [name], exact: true });
      continue;
    }
    const candidates = frozenFamilies.get(stylesheetFamily(name)) || [];
    if (candidates.length) pairs.push({ family: stylesheetFamily(name), current: name, candidates: candidates.slice(0, 4), exact: false });
    else unmatched.push({ current: name, family: stylesheetFamily(name) });
  }
  return { pairs, unmatched };
}

/** Compare a snapshot against the frozen package; returns the report object. */
export async function compareWithFrozenPackage({ outDir, renderedHtml, stylesheetNames }) {
  const frozen = await frozenPackage();
  const frozenNames = frozen.css.map(file => file.name);
  const currentCss = [];
  for (const name of [...new Set(stylesheetNames)]) {
    const text = await readIfExists(join(outDir, 'css', name));
    if (text) currentCss.push({ name, text });
  }
  const currentClasses = new Set();
  const currentFamilies = new Set();
  for (const file of currentCss) {
    currentFamilies.add(stylesheetFamily(file.name));
    for (const name of stylesheetInventory(file.text).classes) currentClasses.add(name);
  }

  const { pairs, unmatched } = pairStylesheets(currentCss.map(file => file.name), frozenNames);
  const stylesheetComparisons = [];
  for (const pair of pairs) {
    const currentText = await readIfExists(join(outDir, 'css', pair.current));
    if (!currentText) continue;
    const currentInventory = stylesheetInventory(currentText);
    const evaluated = [];
    for (const candidate of pair.candidates) {
      const frozenText = await readIfExists(join(frozenAssetRoot, candidate));
      if (!frozenText) continue;
      const frozenInventory = stylesheetInventory(frozenText);
      evaluated.push({
        frozen: candidate,
        ...compareInventories(frozenInventory, currentInventory),
        comparable: frozenInventory.selectors.size > 0 && currentInventory.selectors.size > 0,
      });
    }
    if (!evaluated.length) continue;
    const best = evaluated.sort((left, right) => right.sharedSelectors - left.sharedSelectors)[0];
    stylesheetComparisons.push({
      family: pair.family,
      current: pair.current,
      exact: pair.exact,
      alternatives: evaluated.length,
      // A weak best match means the pair is doubtful rather than drifting.
      matched: pair.exact || best.sharedRatio >= 0.5,
      ...best,
    });
  }

  // Which frozen stylesheet defines each component class decides whether a missing class is real drift
  // (its family is present in this page) or simply a surface this page never loads.
  const owners = new Map();
  for (const file of frozen.css) {
    const family = stylesheetFamily(file.name);
    for (const name of stylesheetInventory(file.text).classes) {
      if (!owners.has(name)) owners.set(name, new Set());
      owners.get(name).add(family);
    }
  }
  const comparedFamilies = new Set(stylesheetComparisons.filter(item => item.comparable && item.matched).map(item => item.family));
  const stale = staleTemplateClasses(frozen.classes, currentClasses);
  const staleInScope = stale.filter(name => [...(owners.get(name) || [])].some(family => comparedFamilies.has(family)));
  const staleOutOfScope = stale.filter(name => !staleInScope.includes(name));

  const markers = probeMarkers(renderedHtml);
  const report = {
    generated_at: new Date().toISOString(),
    frozen: {
      templates: Object.keys(frozen.templates).length,
      stylesheets: frozen.css.length,
      templateComponentClasses: frozen.classes.size,
    },
    current: {
      stylesheetsCompared: currentCss.length,
      classesSeen: currentClasses.size,
      familiesWithoutFrozenCounterpart: [...currentFamilies]
        .filter(family => !frozenNames.some(name => stylesheetFamily(name) === family)),
    },
    templateClassesNoLongerDefined: {
      // In scope: a stylesheet family this page does load no longer defines the class.
      inComparedFamilies: { count: staleInScope.length, sample: staleInScope.slice(0, 60) },
      // Out of scope: the page never loads that surface (previews, library, artifacts…).
      outsideComparedFamilies: { count: staleOutOfScope.length, sample: staleOutOfScope.slice(0, 40) },
    },
    templateClassesStillDefined: frozen.classes.size - stale.length,
    stylesheetComparisons,
    unmatchedStylesheets: unmatched,
    markers,
  };
  report.verdicts = verdictsOf(report);
  return report;
}

function verdictsOf(report) {
  const verdicts = [];
  const inScope = report.templateClassesNoLongerDefined.inComparedFamilies.count;
  const outside = report.templateClassesNoLongerDefined.outsideComparedFamilies.count;
  const matchedComparisons = report.stylesheetComparisons.filter(item => item.comparable && item.matched);
  if (!matchedComparisons.length) {
    verdicts.push('没有可比较的样式表：保存页目录未提供 CSS，或页面未加载冻结包对应的样式族。本次只记录结构与标记探针，不作漂移判定。');
  } else if (inScope === 0) {
    verdicts.push(`本页加载的样式族仍定义其全部冻结组件类（另有 ${outside} 个类属于本页未加载的界面，仅记录）：不是整体改版。`);
  } else {
    verdicts.push(`本页加载的样式族有 ${inScope} 个冻结组件类已不再定义，需逐项核对；另有 ${outside} 个类属于本页未加载的界面，仅供记录。`);
  }
  const drifted = report.stylesheetComparisons
    .filter(item => item.comparable && item.matched && (item.sharedRatio < 0.95 || item.changedTokenCount > 0))
    .sort((left, right) => left.sharedRatio - right.sharedRatio);
  for (const item of drifted.slice(0, 6)) {
    verdicts.push(`${item.family}（${item.frozen} → ${item.current}）：选择器重合 ${(item.sharedRatio * 100).toFixed(1)}%，变化 token ${item.changedTokenCount} 项。`);
  }
  if (drifted.length > 6) verdicts.push(`其余 ${drifted.length - 6} 个样式族也有差异，详见 report.json。`);
  const quiet = report.stylesheetComparisons.filter(item => item.comparable && item.matched).length - drifted.length;
  if (quiet > 0) verdicts.push(`${quiet} 个样式族无显著差异（重合 ≥95% 且 token 未变）。`);
  const doubtful = report.stylesheetComparisons.filter(item => !item.matched);
  if (doubtful.length) verdicts.push(`${doubtful.length} 个当前样式表与冻结变体的最差匹配都不足 50%，已按“新增组件”处理，不做漂移判定。`);
  if (report.unmatchedStylesheets.length) {
    verdicts.push(`${report.unmatchedStylesheets.length} 个当前样式表在冻结包中没有同族文件（多为新增组件），已跳过比较。`);
  }
  if (report.markers['generative UI (DIL)']) verdicts.push('官方正文使用生成式 UI 渲染器（DIL）：核对 model_dil_v2 覆盖情况。');
  if (report.markers['expand control']) verdicts.push('官方回合含“展开”控件（A_HxFq）：冻结模板可能缺少该状态。');
  if (!report.markers['markdown body (reader baseline)']) verdicts.push('官方正文不再使用冻结包里的 markdown-new-styling 类：正文容器结构已变。');
  return verdicts;
}

export function reportToMarkdown(report, meta) {
  const lines = [
    `# 官方 DOM 快照报告`,
    '',
    `- 来源：${meta.source}`,
    `- 快照目录：\`${meta.outDir}\``,
    `- 生成时间：${report.generated_at}`,
    report.turns ? `- 采集到的回合：${report.turns.collected}（其中生成式 UI ${report.turns.generativeUi}，Markdown 正文 ${report.turns.markdownBody}）` : '',
    '',
    '## 结论',
    '',
    ...report.verdicts.map(verdict => `- ${verdict}`),
    '',
    '## 冻结模板 vs 当前样式',
    '',
    `- 冻结模板组件类：${report.frozen.templateComponentClasses}；当前仍定义：${report.templateClassesStillDefined}`,
    `- 本页加载样式族中已消失：${report.templateClassesNoLongerDefined.inComparedFamilies.count}`,
    `- 本页未加载界面中的类（仅记录）：${report.templateClassesNoLongerDefined.outsideComparedFamilies.count}`,
    '',
  ];
  if (report.templateClassesNoLongerDefined.inComparedFamilies.count) {
    lines.push('已消失的类（前 60）：', '', '```text',
      report.templateClassesNoLongerDefined.inComparedFamilies.sample.join(' '), '```', '');
  }
  lines.push('| 样式族 | 冻结文件 | 当前文件 | 选择器重合 | 变化 token |', '|---|---|---|---|---|');
  for (const comparison of report.stylesheetComparisons) {
    const ratio = comparison.comparable ? `${(comparison.sharedRatio * 100).toFixed(1)}%` : '不可比';
    lines.push(`| ${comparison.family} | ${comparison.frozen} | ${comparison.current} | ${ratio} | ${comparison.changedTokenCount} |`);
  }
  if (report.unmatchedStylesheets.length) {
    lines.push('', '没有唯一冻结对应的当前样式表：', '');
    for (const item of report.unmatchedStylesheets.slice(0, 20)) lines.push(`- ${item.current}（族 ${item.family}）`);
  }
  lines.push('', '## 组件标记探针', '');
  for (const [name, present] of Object.entries(report.markers)) lines.push(`- ${present ? '✅' : '❌'} ${name}`);
  lines.push('', '> 本报告只含结构与样式统计，不含聊天正文；快照目录与截图仅保存在 data/private/。', '');
  return lines.filter(line => line !== undefined).join('\n');
}

export async function snapshot({ url, savedDir, outDir, label }) {
  const target = resolveSnapshotDir({ label, out: outDir });
  await mkdir(target, { recursive: true });
  const meta = { source: url || savedDir, outDir: target, visits: [] };

  let staticHtml = null;
  if (url) {
    console.log(`将访问：${url}`);
    meta.visits.push(url);
    const fetched = await fetchStatic(url, target);
    staticHtml = fetched.html;
    console.log(`静态响应：HTTP ${fetched.status}，${(fetched.bytes / 1024).toFixed(0)} KB`);
  }

  let renderedHtml = '';
  let turns = null;
  let pageStylesheets = [];
  let browserErrors = [];
  const canBrowse = Boolean(url) || Boolean(savedDir);
  if (canBrowse) {
    const viewport = { width: 1092, height: 935 };
    const deviceScaleFactor = 1.5;
    if (url) {
      const result = await browserPass({ url, outDir: target, viewport, deviceScaleFactor });
      renderedHtml = result.html;
      pageStylesheets = result.stylesheets;
      browserErrors = result.errors;
      turns = {
        collected: result.turns.length,
        generativeUi: result.turns.filter(turn => turn.hasGenerativeUi).length,
        markdownBody: result.turns.filter(turn => turn.hasMarkdownBody).length,
        preWrap: result.turns.filter(turn => turn.hasPreWrap).length,
        scrollHeight: result.scrollHeight,
        settledChars: result.settledChars,
        maxTurnIndex: result.maxIndex,
        coverage: result.coverage,
        missingTurnIndexes: result.missingTurnIndexes.length,
      };
      await writeFile(join(target, 'turns.json'), `${JSON.stringify(result.turns, null, 2)}\n`);
    } else {
      const savedHtml = (await readIfExists(join(savedDir, 'page.html')))
        || (await readIfExists(join(savedDir, 'index.html')))
        || (await readdir(savedDir)).filter(name => name.endsWith('.html')).map(name => join(savedDir, name))[0];
      const savedText = typeof savedHtml === 'string' && savedHtml.includes('<')
        ? savedHtml
        : await readIfExists(savedHtml);
      renderedHtml = savedText || '';
    }
    await writeFile(join(target, 'rendered.html'), renderedHtml, 'utf8');
    pageStylesheets = pageStylesheets.length
      ? pageStylesheets
      : [...String(renderedHtml || staticHtml || '').matchAll(/href="([^"]+\.css[^"]*)"/g)].map(match => match[1]);
  }

  const saved = await collectStylesheets({ outDir: target, hrefs: pageStylesheets, savedDir });
  const stylesheetNames = saved.map(item => item.name);
  const report = await compareWithFrozenPackage({ outDir: target, renderedHtml: renderedHtml || String(staticHtml || ''), stylesheetNames });
  report.turns = turns;
  report.browserErrors = browserErrors;
  report.stylesheets = saved;
  await writeFile(join(target, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(target, 'report.md'), reportToMarkdown(report, meta), 'utf8');
  return { outDir: target, report };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { values } = parseArgs({ options: {
    url: { type: 'string' },
    saved: { type: 'string' },
    out: { type: 'string' },
    label: { type: 'string' },
    'compare-only': { type: 'string' },
  } });
  if (values['compare-only']) {
    const target = resolve(values['compare-only']);
    const renderedHtml = (await readIfExists(join(target, 'rendered.html'))) || '';
    const stylesheetNames = (await readdir(join(target, 'css')).catch(() => [])).filter(name => name.endsWith('.css'));
    const report = await compareWithFrozenPackage({ outDir: target, renderedHtml, stylesheetNames });
    await writeFile(join(target, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(join(target, 'report.md'), reportToMarkdown(report, { source: 'compare-only', outDir: target }), 'utf8');
    console.log(report.verdicts.join('\n'));
  } else if (values.url || values.saved) {
    const { outDir, report } = await snapshot({ url: values.url, savedDir: values.saved, outDir: values.out, label: values.label });
    console.log(`\n快照：${outDir}`);
    console.log(report.verdicts.map(verdict => `- ${verdict}`).join('\n'));
  } else {
    console.error([
      '显式调用工具，不参与构建与 npm test。',
      '用法：',
      '  node scripts/capture-official-dom.mjs --url <分享链接> [--label <名称>]',
      '  node scripts/capture-official-dom.mjs --saved <已保存页面目录> [--label <名称>]',
      '  node scripts/capture-official-dom.mjs --compare-only <快照目录>',
    ].join('\n'));
    process.exitCode = 2;
  }
}
