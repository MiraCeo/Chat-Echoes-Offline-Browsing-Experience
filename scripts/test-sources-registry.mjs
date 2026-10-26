import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SOURCES, findSource, requireSource, sourceById, sourceList } from './sources/registry.mjs';

// 1. ChatGPT 分享链接能被识别，并给出归档目录与分享 id
const share = new URL('https://chatgpt.com/share/11111111-1111-4111-8111-111111111111');
const source = findSource(share);
assert.equal(source?.id, 'chatgpt-share');
assert.equal(source.archiveRoot, 'archive/chatgpt-share');
assert.equal(source.shareId(share), '11111111-1111-4111-8111-111111111111');
assert.match(source.importer, /import-chatgpt-share\.py$/);
assert.equal(sourceById('chatgpt-share'), source);
assert.equal(sourceById('claude'), null);

// 2. 反例：协议、域名、路径、端口、凭据、空 id 都不该匹配
for (const href of [
  'http://chatgpt.com/share/11111111-1111-4111-8111-111111111111',
  'https://example.com/share/11111111-1111-4111-8111-111111111111',
  'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111',
  'https://chatgpt.com/share/',
  'https://chatgpt.com/share/11111111-1111-4111-8111-111111111111/extra',
  'https://chatgpt.com:8443/share/11111111-1111-4111-8111-111111111111',
  'https://user:pass@chatgpt.com/share/11111111-1111-4111-8111-111111111111',
]) {
  assert.equal(findSource(new URL(href)), null, `must not match ${href}`);
}

// 3. 严格 id 校验（导入接口用它防止任意字符串变成任务文件名）
assert.equal(source.isValidId('11111111-1111-4111-8111-111111111111'), true);
assert.equal(source.isValidId('11111111111141118111111111111111'), false);
assert.equal(source.isValidId('../../etc/passwd'), false);
assert.equal(source.isValidId(''), false);

// 4. 不支持的来源给出明确错误（带 400），列表里只有已知站点
try {
  requireSource(new URL('https://claude.ai/share/abc'));
  assert.fail('unsupported sources must be rejected');
} catch (error) {
  assert.equal(error.status, 400);
  assert.match(error.message, /暂不支持/);
}
assert.deepEqual(sourceList(), [{ id: 'chatgpt-share', label: 'ChatGPT 公开分享', archiveRoot: 'archive/chatgpt-share' }]);
assert.ok(Object.isFrozen(SOURCES), 'the registry should not be mutated at runtime');

// 5. 两个调用方确实通过注册表分派，而不是各写一套 host 判断
for (const file of ['scripts/archive-share.mjs', 'scripts/local-import-api.mjs']) {
  const text = await readFile(file, 'utf8');
  assert.match(text, /from '\.\/sources\/registry\.mjs'/, `${file} must use the source registry`);
  assert.doesNotMatch(text, /hostname\s*!==\s*'chatgpt\.com'/, `${file} must not hardcode the ChatGPT host check`);
}

console.log('PASS sources registry: ChatGPT share matching, rejections (protocol/host/path/port/credentials), strict id shape, unsupported-source error, callers dispatch through the registry.');
