// archive/chatgpt-share/README.md: the human-readable title ↔ ID index. Isolated temp data only.
import assert from 'node:assert/strict';import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';import {join} from 'node:path';
import {renderChatIndexMarkdown,writeChatIndexMarkdown,snapshotOf,CHAT_INDEX_FILE} from './chat-index-markdown.mjs';
import {createChatStore} from './chat-store.mjs';
const entries=[
 {id:'6a606f18-e6e0-83ee-b3c3-6c74f720a853',title:'事件复盘 | 与评价',captured_at:'2026-09-15T15:18:32.338Z',turn_count:12,conversation_path:'archive/chatgpt-share/6a606f18-e6e0-83ee-b3c3-6c74f720a853/2026-09-15T15-18-32.338Z/conversation.ceobe.json'},
 {id:'chat-two',title:'第二条\n换行\t标题',captured_at:'not-a-date',turn_count:3,conversation_path:'archive\\chatgpt-share\\chat-two\\2026-01-01\\conversation.ceobe.json'},
 {id:'chat-odd',title:'',captured_at:'2026-01-02T00:00:00Z',conversation_path:'data/private/other/conversation.ceobe.json'},
];
const md=renderChatIndexMarkdown(entries,{generatedAt:'2026-09-18T01:02:03Z'});
assert.ok(md.startsWith('# 本地聊天归档索引\n'));assert.ok(md.includes('| 标题 | 聊天 ID（文件夹名） | 最新快照 | 导入时间 | 轮数 |'));
assert.ok(md.includes('| 事件复盘 \\| 与评价 | `6a606f18-e6e0-83ee-b3c3-6c74f720a853` | [2026-09-15T15-18-32.338Z](./6a606f18-e6e0-83ee-b3c3-6c74f720a853/2026-09-15T15-18-32.338Z/) | '),'pipe escaped, ID in code, relative link to the snapshot');
assert.ok(md.includes('| 第二条 换行 标题 | `chat-two` | [2026-01-01](./chat-two/2026-01-01/) | not-a-date | 3 |'),'control characters collapsed, backslash paths understood, unparsable dates kept verbatim');
assert.ok(md.includes('| — | `chat-odd` | — | '),'foreign paths get no link, empty title shows a dash');
assert.ok(md.includes('- 聊天数：3'));assert.equal(snapshotOf({id:'x',conversation_path:'archive/chatgpt-share/y/2026/conversation.ceobe.json'}),null,'ID mismatch yields no link');
assert.ok(renderChatIndexMarkdown([]).includes('（暂无聊天）'));
// Written atomically to archive/chatgpt-share/README.md; the chat store refreshes it after a rename.
await mkdir('data/private',{recursive:true});const root=await mkdtemp(join(process.cwd(),'data/private/chat-index-test-'));
try{const file=await writeChatIndexMarkdown(root,entries);assert.equal(file,join(root,CHAT_INDEX_FILE));const written=await readFile(file,'utf8');assert.ok(written.startsWith('# 本地聊天归档索引\n'));assert.ok(written.includes('| 事件复盘 \\| 与评价 | `6a606f18-e6e0-83ee-b3c3-6c74f720a853` |'));assert.ok(!written.includes('.tmp'));
 await mkdir(join(root,'archive'),{recursive:true});await writeFile(join(root,'archive/library.ceobe.json'),JSON.stringify({schema_version:'1.0.0',kind:'ceobe.library',conversations:entries}));
 await createChatStore(root).mutate({id:'chat-two',action:'rename',title:'改名后的标题'});const after=await readFile(file,'utf8');assert.ok(after.includes('| 改名后的标题 | `chat-two` |'));assert.ok(!after.includes('第二条'));
 console.log('PASS chat index markdown: table rendering, escaping, snapshot links, atomic write, refresh after rename');
}finally{await rm(root,{recursive:true,force:true})}
