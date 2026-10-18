import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import {
  classesUsedByFrozenTemplates,
  compareInventories,
  pairStylesheets,
  probeMarkers,
  reportToMarkdown,
  resolveSnapshotDir,
  staleTemplateClasses,
  structuralSignature,
  stylesheetFamily,
  stylesheetInventory,
} from './capture-official-dom.mjs';

// The snapshot tool is a maintenance instrument: it must stay explicit, local-only, and must never
// be able to point its output at the archive or at anything publishable.
assert.throws(() => resolveSnapshotDir({ out: resolve('archive/chatgpt-share/whatever') }),
  /archive/, 'writing into archive/ must be refused');
assert.throws(() => resolveSnapshotDir({ out: resolve('docs/official-dom') }),
  /data\/private/, 'snapshots outside data/private must be refused');
const defaultDir = resolveSnapshotDir({ label: 'unit-test' });
assert.ok(defaultDir.includes(join('data', 'private', 'official-dom')), 'default target stays inside data/private');
assert.ok(resolveSnapshotDir({ out: 'data/private/official-dom/custom' }).endsWith(join('official-dom', 'custom')));

// Structure signatures carry tag/class/attribute shape only — never message text.
const { document } = parseHTML('<html><body><section class="turn a" data-turn="user"><h4 class="sr-only">你说：</h4><p>secret message</p></section></body></html>');
const signature = structuralSignature(document.querySelector('section'));
assert.equal(signature.tag, 'section');
assert.deepEqual(signature.class, ['turn', 'a']);
assert.deepEqual(signature.attrs, { 'data-turn': 'user' });
assert.equal(JSON.stringify(signature).includes('secret message'), false, 'signatures must not contain message text');

// Stylesheet inventories and their comparison.
const frozenCss = '.alpha{color:red}.beta{color:blue}--token-x:1px;@media (min-width:1px){.gamma{color:green}}';
const currentCss = '.alpha{color:red}.beta{color:purple}--token-x:2px;.delta{color:green}';
const frozen = stylesheetInventory(frozenCss);
const current = stylesheetInventory(currentCss);
assert.ok(frozen.selectors.has('.alpha') && frozen.selectors.has('.gamma'), 'selectors inside at-rules are kept');
assert.deepEqual([...frozen.classes].sort(), ['alpha', 'beta', 'gamma']);
const comparison = compareInventories(frozen, current);
assert.equal(comparison.sharedSelectors, 2);
assert.ok(comparison.sharedRatio > 0.6 && comparison.sharedRatio < 0.7);
assert.deepEqual(comparison.changedTokenSample, ['--token-x']);
assert.ok(comparison.frozenOnlySelectors.includes('.gamma'));

// Family pairing: the hash is one dash-free token, renamed builds match the closest frozen variant.
assert.equal(stylesheetFamily('conversation-small-iha453gv.css'), 'conversation-small');
assert.equal(stylesheetFamily('chart-widget-container-loaded-nly310r8.css'), 'chart-widget-container-loaded');
assert.equal(stylesheetFamily('zh-hans-gdo938le.css'), 'zh-hans');
const pairing = pairStylesheets(
  ['conversation-small-iha453gv.css', 'root-ofxdojc1.css', 'BrandNew-abc123.css', 'root-e89rmz1m.css'],
  ['conversation-small-d87j24cm.css', 'conversation-small-je15b35p.css', 'root-bf3xaoxt.css', 'ansi-1f6vhsjh.css'],
);
assert.deepEqual(pairing.pairs.map(pair => pair.family).sort(), ['conversation-small', 'root', 'root']);
assert.equal(pairing.pairs.find(pair => pair.family === 'conversation-small').candidates.length, 2, 'every frozen variant is a candidate');
assert.deepEqual(pairing.unmatched, [{ current: 'BrandNew-abc123.css', family: 'BrandNew' }]);

// Which template classes are stale, and which of those are in a surface this page actually loads.
// Plain utilities are kept: when official stops using one, that is itself a signal. Variant-prefixed
// utilities (`hover:…`) are not class names a selector can be measured against.
const markupClasses = classesUsedByFrozenTemplates(
  '<div class="shell-root px-4"><span class="tab-token hover:bg-x"></span></div>',
  { 'message:user': '<div class="bubble user-color">x</div>', 'preview:txt': '<div class="cm-editor">x</div>' },
);
assert.deepEqual([...markupClasses].sort(), ['bubble', 'cm-editor', 'px-4', 'shell-root', 'tab-token', 'user-color']);
assert.deepEqual(staleTemplateClasses(markupClasses, new Set(['shell-root', 'bubble', 'px-4'])).sort(),
  ['cm-editor', 'tab-token', 'user-color']);

// Component marker probes describe what the live page renders.
const markers = probeMarkers('<div class="puik-root not-markdown"><div class="fv0XaG_DilRenderer"></div></div><div class="A_HxFq_toggleControl"></div>');
assert.equal(markers['generative UI (DIL)'], true);
assert.equal(markers['expand control'], true);
assert.equal(markers['chain of thought v5'], false);

// The Markdown report stays structural: no conversation text, no raw payload.
const markdown = reportToMarkdown({
  generated_at: '2026-10-19T00:00:00.000Z',
  frozen: { templates: 32, stylesheets: 60, templateComponentClasses: 456 },
  current: { stylesheetsCompared: 4, classesSeen: 4000, familiesWithoutFrozenCounterpart: ['FormattedText'] },
  templateClassesNoLongerDefined: { inComparedFamilies: { count: 0, sample: [] }, outsideComparedFamilies: { count: 39, sample: ['cm-editor'] } },
  templateClassesStillDefined: 417,
  stylesheetComparisons: [{ family: 'root', frozen: 'root-bf3xaoxt.css', current: 'root-ofxdojc1.css', comparable: true, matched: true, sharedRatio: 0.964, changedTokenCount: 57 }],
  unmatchedStylesheets: [],
  markers: { 'generative UI (DIL)': true },
  verdicts: ['示例结论'],
  turns: { collected: 42, generativeUi: 9, markdownBody: 0 },
}, { source: 'https://chatgpt.com/share/example', outDir: 'data/private/official-dom/example' });
assert.ok(markdown.includes('示例结论') && markdown.includes('| root |') && markdown.includes('96.4%'));
assert.ok(markdown.includes('data/private/'), 'the report states where artifacts live');
assert.ok(!markdown.includes('<div') && !markdown.includes('secret'), 'the report carries no DOM or message text');

// compare-only mode works fully offline, over an existing snapshot directory.
const workspace = await mkdtemp(join(tmpdir(), 'ceobe-dom-'));
try {
  await mkdir(join(workspace, 'css'), { recursive: true });
  await writeFile(join(workspace, 'rendered.html'), '<html><body><div class="puik-root"></div></body></html>', 'utf8');
  await writeFile(join(workspace, 'css', 'root-ofxdojc1.css'), '--token:1px;.a{color:red}', 'utf8');
  const { spawnSync } = await import('node:child_process');
  const run = spawnSync(process.execPath, [resolve('scripts/capture-official-dom.mjs'), '--compare-only', workspace], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(await readFile(join(workspace, 'report.json'), 'utf8'));
  assert.equal(report.markers['generative UI (DIL)'], true);
  assert.ok(Array.isArray(report.verdicts) && report.verdicts.length > 0);
  const empty = spawnSync(process.execPath, [resolve('scripts/capture-official-dom.mjs')], { encoding: 'utf8' });
  assert.equal(empty.status, 2, 'running without arguments must fail instead of guessing a target');
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log('Official DOM snapshot tool: output containment, structural signatures, stylesheet pairing, class drift and offline compare-only mode verified.');
