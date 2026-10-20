import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The print sheet is easy to break while editing page styles, and the damage only shows up
// in an exported PDF. These assertions pin the rules that fixed real problems.
const root = import.meta.dirname.replace(/[\\/]scripts$/, '');
const css = await readFile(join(root, 'official-templates/assets/print.css'), 'utf8');
const shell = await readFile(join(root, 'official-templates/shell.html'), 'utf8');

assert.match(css, /@media print/, 'print.css must scope its rules to print');
assert.match(css, /@page\s*\{[^}]*size:\s*A4/, 'A4 page box');
// 这条规则不在 print.css 里：构建时注入页面，避免屏幕上也隐藏懒加载占位。
const builder = await readFile(join(root, 'scripts/build-official-replay.mjs'), 'utf8');
assert.match(builder, /img:not\(\[src\]\)\{display:none\}/, 'lazy template images must not print as empty boxes');
assert.match(css, /min-width:\s*0\s*!important/, 'CodeMirror content must be releasable from min-content');
assert.match(css, /pre-wrap/, 'code lines must wrap on paper');
assert.match(css, /aria-label\*="分享"|share-button/, 'the share control must be hidden');
assert.match(css, /print-color-adjust/, 'backgrounds must survive printing');
assert.match(css, /Microsoft YaHei|PingFang|Noto Sans CJK/, 'CJK font stack must be explicit');
assert.match(shell, /print\.css/, 'shell must link the print sheet');
assert.match(shell, /media="print"/, 'the print sheet must be print-only');

// Guard against a rule that hides content by accident.
assert.doesNotMatch(css, /display:\s*none\s*!important;\s*\}\s*\/\*[^*]*\*\/\s*main/, 'no blanket rule hiding main');

console.log('Print styles: A4 page box, image placeholder hiding, CodeMirror min-width, code wrapping, share hiding, CJK stack and print-only linking verified.');
