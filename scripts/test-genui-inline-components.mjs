import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { loadOfficialTemplatePackage } from './official-template-package.mjs';
import { createOfficialCitations } from './official-citations.mjs';
import { renderAssistantMarkdown } from './render-markdown.mjs';
import { messageCopyContent } from './copy-controls.mjs';
import {
  collectInlineComponents,
  messageComponents,
  parseInlineComponent,
  stripInlineComponents,
} from './dil-inline-components.mjs';

// DIL-era captures embed components inline in assistant text and resolve them through the capture's
// own tables. Rendering must use those tables, must never leave raw markup, and must never execute
// anything from the payload.
const templates = await loadOfficialTemplatePackage(process.cwd());
const { document } = parseHTML('<html><body></body></html>');
const citations = createOfficialCitations([templates.templateDocument]);

const parsed = markup => parseInlineComponent(markup);

assert.deepEqual(parsed('<Cite refs={["turn131558view0","turn131558view1"]}/>'), {
  tag: 'Cite', props: { refs: ['turn131558view0', 'turn131558view1'] }, selfClosing: true, children: '',
});
assert.deepEqual(parsed('<Cite ref="turn716219view0"/>').props, { ref: 'turn716219view0' });
assert.deepEqual(parsed('<FileCite ref="turn0file0" line_range_start={49} line_range_end={50}/>').props, {
  ref: 'turn0file0', line_range_start: 49, line_range_end: 50,
});
assert.deepEqual(parsed('<Link url="https://opencode.ai/go/" title="官方套餐介绍"/>').props, {
  url: 'https://opencode.ai/go/', title: '官方套餐介绍',
});
assert.deepEqual(parsed('<MemoryCite />').props, {});
assert.deepEqual(parsed('<Entity category="software" value="DeepSeek Harness"/>').props, {
  category: 'software', value: 'DeepSeek Harness',
});
assert.equal(parsed('<Chart content={{"chartType":"bar"}}/>').props.content.chartType, 'bar');
assert.equal(parsed('<WritingBlock id="58321">正文内容</WritingBlock>').children, '正文内容');
assert.equal(parsed('<cite refs={["x"]}/>'), null, 'only the official tag names are treated as components');

const message = {
  id: 'message-1',
  metadata: {
    search_result_groups: [{ domain: 'ias.edu', entries: [{ ref_id: { turn_index: 785607, ref_type: 'search', ref_index: 0 }, title: 'GST' }] }],
  },
  attachments: [{ id: 'turn0file0', name: 'billion-context-full-log.txt' }],
};
const cite = '<Cite refs={["turn785607search0"]}/>';
const fileCite = '<FileCite ref="turn0file0" line_range_start={49} line_range_end={50}/>';
const source = `结论如下。${cite}\n\n详见${fileCite}\n\n参考 <Link url="https://opencode.ai/go/" title="官方套餐介绍"/> 与 <MemoryCite /> 及 <Entity category="software" value="DeepSeek Harness"/>。`;

// Ranges from metadata are authoritative; the scan covers captures that ship markup without them.
// Shapes mirror the capture: `safe_urls` for cite, `entities` for the ref table, line ranges on files.
const metadataComponents = [
  {
    type: 'cite',
    start_index: source.indexOf(cite),
    end_index: source.indexOf(cite) + cite.length,
    safe_urls: [
      { url: 'https://opencode.ai/v2/docs/console/billing' },
      { url: 'https://opencode.ai/v2/docs/console/go/' },
    ],
    entities: [{ entity_type: 'search', ref: 'turn785607search0' }],
  },
  {
    type: 'file_cite',
    start_index: source.indexOf(fileCite),
    end_index: source.indexOf(fileCite) + fileCite.length,
  },
];
assert.equal(collectInlineComponents(source, { components: messageComponents({ ...message, metadata: { ...message.metadata, genui_components: metadataComponents } }), message }).length, 5);
assert.equal(collectInlineComponents(source, {}).length, 5, 'without metadata the scan finds the self-describing tags');

// Ordinary prose and code samples must survive untouched.
const prose = '代码里写 `<Link>` 不带地址，文档提到 <Cite> 也只是文字。';
assert.equal(collectInlineComponents(prose, {}).length, 0);
assert.equal(stripInlineComponents(prose, {}), prose);

const html = renderAssistantMarkdown(document, source, {
  officialCitations: citations,
  genuiComponents: messageComponents({ ...message, metadata: { ...message.metadata, genui_components: metadataComponents } }),
});
for (const tag of ['Cite', 'FileCite', 'MemoryCite', 'Link', 'Entity', 'Chart', 'WritingBlock']) {
  assert.ok(!html.includes(`<${tag}`) && !html.includes(`&lt;${tag}`), `${tag} markup must not survive rendering`);
}
assert.ok(html.includes('data-testid="webpage-citation-pill"'), 'citation must use the frozen official pill');
assert.ok(html.includes('+0') === false, 'a single source must not claim extra sources');
assert.ok(html.includes('data-file-citation-group-size="1"'), 'file citation must use the frozen official chip');
assert.ok(html.includes('billion-context-full-log.txt'), 'file citation keeps an ungrouped official label');
assert.equal(parseHTML('<html><body>' + html + '</body></html>').document.querySelector('a.decorated-link')?.getAttribute('href'), 'https://opencode.ai/go/');
assert.ok(html.includes('记忆'), 'components without a frozen template degrade to plain text');
assert.ok(html.includes('DeepSeek Harness'), 'entity values stay readable');

// An unresolved citation yields no chip and no raw markup.
const unresolved = renderAssistantMarkdown(document, `正文${cite}`, { officialCitations: citations });
assert.ok(!unresolved.includes('<Cite') && !unresolved.includes('&lt;Cite'));

// Copies and exports carry the same information as text rather than component markup.
const copy = messageCopyContent([{
  id: 'message-1', type: 'markdown', markdown: source, message,
  genuiComponents: messageComponents({ ...message, metadata: { ...message.metadata, genui_components: metadataComponents } }),
}], document);
for (const tag of ['Cite', 'FileCite', 'MemoryCite', 'Link', 'Entity']) {
  assert.ok(!copy.text.includes(`<${tag}`), `${tag} markup must not reach the clipboard`);
}
assert.ok(/\[ias\.edu\]\[\d+\]/.test(copy.text), 'citations become reference links');
assert.ok(copy.text.includes('[官方套餐介绍](https://opencode.ai/go/)'), 'links stay links in plain text');
assert.ok(copy.text.includes('billion-context-full-log.txt'), 'file citations keep their local name');
assert.ok(copy.text.includes('DeepSeek Harness') && copy.text.includes('记忆'), 'entities and memory cites stay readable');
assert.ok(!copy.html.includes('&lt;Cite'), 'copied HTML must not escape raw component markup either');

console.log('DIL-era inline components parsed, resolved, rendered and exported without raw markup.');
