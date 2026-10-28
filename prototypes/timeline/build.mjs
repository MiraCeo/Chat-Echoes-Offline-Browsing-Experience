import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// 只读原型：把时间线索引与标题合成一个自包含 HTML（内联 CSS/JS/数据），
// 输出到 data/private，不进入正式页面、不参与生产构建。
const root = resolve(import.meta.dirname, '..', '..');
const indexPath = join(root, 'replay', 'public', 'timeline-index.json');
const chatsPath = join(root, 'replay', 'chats.json');
const index = JSON.parse(await readFile(indexPath, 'utf8'));
const catalog = JSON.parse(await readFile(chatsPath, 'utf8'));
const titles = new Map((catalog.chats || []).map(chat => [chat.id, chat.title]));
const conversations = index.conversations
  .filter(item => Number.isFinite(item.first) && Number.isFinite(item.last))
  .map(item => ({
    id: item.id,
    title: titles.get(item.id) || '会话 ' + String(item.id).slice(0, 8),
    first: item.first,
    last: item.last,
    first_message_id: item.first_message_id || null,
    turns: item.turns,
    days: item.days || {},
  }));

if (!conversations.length) throw new Error('时间线索引为空，先运行 npm run library。');
const firsts = conversations.map(item => item.first);
const lasts = conversations.map(item => item.last);
const pad = value => String(value).padStart(2, '0');
const month = seconds => { const d = new Date(seconds * 1000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const range = `${month(Math.min(...firsts))} ~ ${month(Math.max(...lasts))}`;

const script = await readFile(join(root, 'prototypes', 'timeline', 'prototype.js'), 'utf8');
const style = await readFile(join(root, 'prototypes', 'timeline', 'prototype.css'), 'utf8');
const data = JSON.stringify({ conversations }).replace(/</g, '\\u003c');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>聊天时间轴 · P1–P4 原型</title>
<style>${style}</style>
</head>
<body>
<div class="proto-shell">
  <header class="proto-top">
    <div>
      <h1>聊天时间轴 · 原型</h1>
      <p class="proto-sub"><span data-proto-count>${conversations.length}</span> 个会话 · ${range} · 只读原型，不影响正式时间线</p>
    </div>
    <nav class="proto-tabs" aria-label="原型">
      <a data-variant-link="p1" href="?v=p1">P1 等距</a>
      <a data-variant-link="p2" href="?v=p2">P2 横向月轴</a>
      <a data-variant-link="p3" href="?v=p3">P3 覆盖条</a>
      <a data-variant-link="p4" href="?v=p4">P4 活跃日</a>
    </nav>
  </header>
  <p class="proto-desc" data-proto-desc></p>
  <main id="proto"></main>
  <p class="proto-foot">只读原型 · 点击卡片在新标签页打开本地会话 · 数据来自 replay/public/timeline-index.json</p>
</div>
<script>window.__TIMELINE_DATA__ = ${data};</script>
<script>${script}</script>
</body>
</html>`;

const outDir = join(root, 'data', 'private', 'timeline-prototypes');
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'index.html'), html);
console.log(`Timeline prototype: ${conversations.length} conversations, ${range} -> ${join('data', 'private', 'timeline-prototypes', 'index.html')}`);
