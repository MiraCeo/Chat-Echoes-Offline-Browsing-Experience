import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseHTML } from 'linkedom';
import { classOwners, componentsFromSnapshot, shellOf } from './freeze-dil-templates.mjs';

// Frozen DIL shells must carry structure only: no text, no personal or temporary attributes.
const { document } = parseHTML(`<html><body>
  <p class="w6asjq_TextBase _85PZeG_Text" data-d-component="text" data-d-text-flow="" style="color:red" id="x">私有正文</p>
  <h1 class="w6asjq_TextBase GgxHUa_Title" data-d-component="title" data-d-size="2xl" aria-label="私有标题">私有标题</h1>
  <a class="Uwo0ZW_Link" data-d-component="link" href="https://private.example/secret" rel="noopener">私有链接</a>
  <svg class="AVG6na_InlineIcon" width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" data-d-component="icon" aria-hidden="true"><path d="M0 0h24v24H0z"></path></svg>
</body></html>`);
const shell = element => shellOf(element);
const text = shell(document.querySelector('[data-d-component="text"]'));
assert.deepEqual(text, { tag: 'p', class: ['w6asjq_TextBase', '_85PZeG_Text'], attributes: { 'data-d-component': 'text', 'data-d-text-flow': '' } },
  'text shell keeps classes and enum attributes, drops style/id');
const title = shell(document.querySelector('[data-d-component="title"]'));
assert.deepEqual(title.attributes, { 'data-d-component': 'title', 'data-d-size': '2xl' }, 'aria labels are personal and dropped');
const link = shell(document.querySelector('[data-d-component="link"]'));
assert.equal('href' in link.attributes, false, 'resource URLs are dropped; the renderer fills them from the parsed tree');
assert.equal('rel' in link.attributes, false, 'link rel/target are re-applied by the renderer, not frozen per capture');
const icon = shell(document.querySelector('[data-d-component="icon"]'));
assert.equal(icon.attributes.viewBox, '0 0 24 24', 'svg geometry stays so the icon shell is usable');
assert.equal(JSON.stringify([text, title, link, icon]).includes('私有'), false, 'no text reaches the package');

// Variants: the same component renders with different tags depending on its props.
const variants = componentsFromSnapshot(await readFile(resolve('data/private/official-dom/6ad4e7d4/rendered.html'), 'utf8').catch(() => ''));
if (variants.size) {
  assert.ok(variants.get('title').length >= 1 && variants.get('title').every(item => item.attributes['data-d-component'] === 'title'));
  assert.ok([...variants.values()].every(list => Array.isArray(list) && list.length > 0 && list.length <= 6));
}
const synthetic = componentsFromSnapshot('<i data-d-component="thing" class="a"></i><i data-d-component="thing" class="a"></i><i data-d-component="thing" class="b"></i>');
assert.equal(synthetic.get('thing').length, 2, 'identical shells collapse, distinct ones are kept as variants');

// Stylesheet ownership: which frozen file defines a class.
const workspace = await mkdtemp(join(tmpdir(), 'ceobe-dil-'));
try {
  const cssDir = join(workspace, 'css');
  await mkdir(cssDir, { recursive: true });
  await writeFile(join(cssDir, 'one.css'), '.w6asjq_TextBase{color:red}.shared{}', 'utf8');
  await writeFile(join(cssDir, 'two.css'), '.GgxHUa_Title{font-weight:600}.shared{}', 'utf8');
  const owners = await classOwners(new Set(['w6asjq_TextBase', 'GgxHUa_Title', 'missing']), cssDir);
  assert.deepEqual(owners.get('w6asjq_TextBase'), ['one.css']);
  assert.deepEqual(owners.get('GgxHUa_Title'), ['two.css']);
  assert.deepEqual(owners.get('missing'), []);

  await writeFile(join(workspace, 'rendered.html'), '<html><body><p class="w6asjq_TextBase" data-d-component="text">x</p></body></html>', 'utf8');
  const before = await readFile(resolve('official-templates/dil.json'), 'utf8');
  const run = spawnSync(process.execPath, [resolve('scripts/freeze-dil-templates.mjs'), '--report', workspace], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes('只读检查'), `report mode announces that it does not write: ${run.stdout}`);
  assert.equal(await readFile(resolve('official-templates/dil.json'), 'utf8'), before, 'report mode must not rewrite the package');
  const empty = spawnSync(process.execPath, [resolve('scripts/freeze-dil-templates.mjs')], { encoding: 'utf8' });
  assert.equal(empty.status, 2, 'the tool refuses to guess a snapshot');
  assert.equal(componentsFromSnapshot('<html></html>').size, 0, 'a snapshot without DIL components yields nothing');
} finally {
  await rm(workspace, { recursive: true, force: true });
}

// The frozen package itself stays consistent and text-free.
const manifest = JSON.parse(await readFile(resolve('official-templates/dil.json'), 'utf8'));
assert.equal(manifest.format, 'ceobe-dil-component-shells');
assert.ok(Object.keys(manifest.components).length >= 20, 'the frozen package covers the components seen in snapshots');
for (const [name, list] of Object.entries(manifest.components)) {
  assert.ok(Array.isArray(list) && list.length, `${name} needs at least one shell`);
  for (const item of list) {
    assert.equal(typeof item.tag, 'string');
    assert.ok(Array.isArray(item.class));
    assert.equal(item.attributes['data-d-component'], name, 'shells keep their own component marker');
    assert.equal(JSON.stringify(item).includes('http'), false, `${name} shells must not embed resource URLs`);
  }
}
for (const name of manifest.stylesheets) await stat(resolve('official-templates/assets', name));
console.log(`DIL shells frozen from official DOM: ${Object.keys(manifest.components).length} components, ${manifest.stylesheets.length} stylesheets, no text or URLs.`);
