import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { buildSourcesPanel } from './build-sources-panel.mjs';
import { loadOfficialTemplatePackage } from './official-template-package.mjs';
import { assertHtmlSerializable, findDisallowedHtmlCharacters } from './serialize-html.mjs';

// Regression: a web source whose URL legitimately contains %01 (seen in a real
// share) was written to the page as a raw U+0001 control character because
// linkedom's `anchor.href` setter runs decodeURI. Vite/parse5 then rejected the
// whole conversation page with HTTP 500.
const escapedUrl = 'https://example.com/video/%E3%82%A2_BGM/Wlfmster%01Il_Siracusano?utm_source=chatgpt.com';
const plainUrl = 'https://example.org/a%20b/c?d=%E4%B8%AD';
const conversation = {
  title: '来源面板测试',
  linear_message_ids: ['q', 'a'],
  messages: {
    q: { id: 'q', role: 'user', visible: true, content: { type: 'text', blocks: [{ type: 'text', text: '问题' }] } },
    a: {
      id: 'a', role: 'assistant', visible: true, recipient: 'all', channel: 'final',
      content: { type: 'text', blocks: [{ type: 'text', text: '回答' }] },
      content_references: [
        { type: 'grouped_webpages', items: [{ url: escapedUrl, title: 'Escaped source' }, { url: plainUrl, title: 'Plain source' }] },
        { type: 'webpage', url: 'javascript:alert(1)', title: 'unsafe' },
      ],
    },
  },
  resources: [],
};

const templates = await loadOfficialTemplatePackage(process.cwd());
const { document } = parseHTML(templates.document.documentElement.outerHTML);
// buildSourcesPanel reads the rendered user turns for the prompt rail.
const turn = document.createElement('section');
turn.setAttribute('data-turn', 'user'); turn.setAttribute('data-testid', 'conversation-turn-1');
document.body.append(turn);
const output = await mkdtemp(join(tmpdir(), 'ceobe-sources-panel-'));
try {
  await buildSourcesPanel(document, process.cwd(), output, conversation, templates);
} finally { await rm(output, { recursive: true, force: true }); }

const links = [...document.querySelectorAll('#ceobe-sources-panel section')].at(1).querySelectorAll('a[href]');
const hrefs = [...links].map(link => link.getAttribute('href'));
assert.deepEqual(hrefs, [escapedUrl, plainUrl], 'source URLs must be written exactly as archived');
assert.equal(document.querySelector('a[href^="javascript:"]'), null);
const html = document.documentElement.outerHTML;
assert.equal(findDisallowedHtmlCharacters(html).length, 0, 'panel markup must not contain control characters');
assert.ok(html.includes('Wlfmster%01Il_Siracusano'));

// The serializer guard is what keeps a future regression from reaching the dev server.
assert.equal(assertHtmlSerializable('<a href="x%01y">ok\t\r\n\f</a>'), '<a href="x%01y">ok\t\r\n\f</a>');
assert.throws(() => assertHtmlSerializable('<p>line1\n<a href="x\u0001y">bad</a></p>', 'Test page'), /Test page contains 1 character\(s\).*U\+0001 at 2:11/);
assert.throws(() => assertHtmlSerializable('lone surrogate \uD83D here'), /U\+D83D/);
assert.throws(() => assertHtmlSerializable('noncharacter \uFFFE'), /U\+FFFE/);
assert.equal(findDisallowedHtmlCharacters('中文 😀 \u00A0').length, 0, 'ordinary text, emoji and NBSP are allowed');

console.log('PASS sources panel: percent-escaped source URLs preserved, no control characters, serializer guard rejects U+0001 / lone surrogate / noncharacter.');
