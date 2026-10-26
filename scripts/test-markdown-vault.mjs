import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildFrontmatter, buildSourcesSection, collectSources, convertMath, isoLocal, yamlScalar } from './markdown-vault.mjs';

// 1. 时间
assert.match(isoLocal(1788365302), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
assert.equal(isoLocal(undefined), '');
assert.equal(isoLocal('nope'), '');
assert.equal(isoLocal(0), '');

// 2. YAML 标量
assert.equal(yamlScalar('普通标题'), '普通标题');
assert.equal(yamlScalar('带: 冒号'), '"带: 冒号"');
assert.equal(yamlScalar('他说 "你好"'), '"他说 \\"你好\\""');
assert.equal(yamlScalar(''), "''");
assert.equal(yamlScalar('true'), '"true"');
assert.equal(yamlScalar('123'), '"123"');
assert.equal(yamlScalar('第一行\n第二行'), '第一行 第二行');

// 3. frontmatter：只写已知字段
const front = buildFrontmatter({
  title: '分支 · 测试消息', chatId: 'abc-123', url: 'https://chatgpt.com/share/abc-123',
  created: '2026-09-03T00:08:23+08:00', model: 'gpt-5-6-thinking', tags: ['测试', '导出'],
});
assert.ok(front.startsWith('---\n'));
assert.ok(front.endsWith('---\n'));
assert.match(front, /^title: 分支 · 测试消息$/m);
assert.match(front, /^chat_id: abc-123$/m);
assert.match(front, /^url: https:\/\/chatgpt\.com\/share\/abc-123$/m);
assert.match(front, /^model: gpt-5-6-thinking$/m);
assert.match(front, /^tags:\n {2}- 测试\n {2}- 导出$/m);
assert.ok(!front.includes('project:'), 'unknown fields must be omitted');
assert.equal(buildFrontmatter({}), '');
assert.equal(buildFrontmatter({ title: '   ' }), '');

// 4. 数学定界符
assert.equal(convertMath('求 \\(a^2+b^2\\) 的值'), '求 $a^2+b^2$ 的值');
assert.equal(convertMath('显示公式：\\[x = \\frac{1}{2}\\]，完毕'), '显示公式：\n$$\nx = \\frac{1}{2}\n$$\n，完毕');
assert.equal(convertMath('多行：\\[\\begin{aligned}a&=1\\\\b&=2\\end{aligned}\\]'), '多行：\n$$\n\\begin{aligned}a&=1\\\\b&=2\\end{aligned}\n$$\n');
assert.equal(convertMath('价格 $5 和 \\(x\\)'), '价格 \\$5 和 $x$');
assert.equal(convertMath('已经转义 \\$5 不变'), '已经转义 \\$5 不变');
assert.equal(convertMath('行内 `\\(a\\)` 不动'), '行内 `\\(a\\)` 不动');
const fenced = '```tex\n\\(a+b\\)\n\\[c\\]\n```\n外面 \\(d\\)';
assert.equal(convertMath(fenced), '```tex\n\\(a+b\\)\n\\[c\\]\n```\n外面 $d$');
const tildes = '~~~\n\\(a\\)\n~~~\n\\(b\\)';
assert.equal(convertMath(tildes), '~~~\n\\(a\\)\n~~~\n$b$');

// 5. 来源：用真实夹具里的引用
const conversation = JSON.parse(await readFile(
  'fixtures/chatgpt-share/11111111-1111-4111-8111-111111111111/conversation.ceobe.json', 'utf8'));
const sources = collectSources(conversation);
assert.ok(sources.length > 0, 'the fixture has web citations');
assert.ok(sources.every(source => /^https?:\/\//.test(source.url)));
const urls = sources.map(source => source.url);
assert.equal(new Set(urls).size, urls.length, 'sources must be deduplicated by url');
assert.ok(urls.some(url => url.includes('help.openai.com')));
const section = buildSourcesSection(sources);
assert.match(section, /^## Sources$/m);
assert.match(section, /^1\. \[.+\]\(https:\/\//m);
assert.equal(buildSourcesSection([]), '');
assert.equal(collectSources({}).length, 0);
assert.equal(collectSources({ messages: { a: { content_references: [{ type: 'grouped_webpages', items: [{ title: 'x', url: 'ftp://nope' }] }] } } }).length, 0);
// 同一篇文章的 utm_* 变体只算一条，并输出去掉追踪参数的链接
const tracking = collectSources({ messages: { a: { content_references: [{ type: 'grouped_webpages', items: [
  { title: '数据手册', url: 'https://example.com/doc.pdf?hkey=abc&utm_source=chatgpt.com', attribution: 'example.com' },
  { title: '数据手册（重复）', url: 'https://example.com/doc.pdf?hkey=abc', attribution: 'example.com' },
] }] } } });
assert.equal(tracking.length, 1);
assert.equal(tracking[0].title, '数据手册');
assert.equal(tracking[0].url, 'https://example.com/doc.pdf?hkey=abc');

console.log(`PASS markdown vault: frontmatter, math delimiters (code-safe), ${sources.length} deduped sources, section rendering.`);
