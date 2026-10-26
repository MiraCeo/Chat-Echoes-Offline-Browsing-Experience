import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// README 截图用的隔离演示夹具：合成对话 + 一个项目 + 一条书签 + 一个图片附件，
// 完全不包含真实聊天内容；构建产物只落在 data/private/readme-shot。
const ROOT = resolve('data/private/readme-shot');
const ARCHIVE = join(ROOT, 'archive', 'chatgpt-share');
const CAPTURE = '2026-10-20T09-00-00.000Z';
const digits = n => String(n).padStart(2, '0');
const iso = seconds => new Date(seconds * 1000).toISOString();

await rm(ROOT, { recursive: true, force: true });
for (const entry of ['scripts', 'src', 'official-templates', 'official-assets', 'samples', 'package.json', 'vite.config.mjs']) {
  await cp(entry, join(ROOT, entry), { recursive: true });
}
await mkdir(join(ROOT, 'node_modules'), { recursive: true });
await cp('node_modules/katex', join(ROOT, 'node_modules', 'katex'), { recursive: true });

const message = (id, role, text, createdAt, extra = {}) => ({
  id, role, author: { role, metadata: {} }, created_at: createdAt, updated_at: createdAt,
  status: 'finished_successfully', end_turn: role === 'assistant' ? true : null, recipient: 'all', channel: null,
  content: { type: 'text', blocks: [{ type: 'text', text }], raw: { content_type: 'text', parts: [text] } },
  attachments: [], citations: [], content_references: extra.references || [],
  metadata: extra.metadata || {}, visible: true,
  raw: { id, author: { role }, content: { content_type: 'text', parts: [text] } },
});

const conversation = ({ id, title, startedAt, turns, resources = [], counts = { downloaded: 0, unresolved: 0, failed: 0 } }) => {
  const messages = {};
  const ids = [];
  turns.forEach((turn, index) => {
    const messageId = `${id.slice(0, 8)}-${String(index + 1).padStart(4, '0')}-4000-8000-${String(index + 1).padStart(12, '0')}`;
    messages[messageId] = message(messageId, turn.role, turn.text, startedAt + index * 42, turn.extra || {});
    ids.push(messageId);
  });
  return {
    schema_version: '1.0.0', kind: 'ceobe.conversation', id, title,
    created_at: startedAt, updated_at: startedAt + turns.length * 42,
    current_node_id: ids.at(-1),
    source: {
      type: 'chatgpt_share', share_id: id, url: `https://chatgpt.com/share/${id}`,
      file: `archive/chatgpt-share/${id}/${CAPTURE}/raw/share.html`,
      captured_at: iso(startedAt + 90), sha256: '0'.repeat(64), format: 'chatgpt_react_flight_html',
    },
    linear_node_ids: [...ids], linear_message_ids: [...ids], nodes: {}, messages,
    metadata: { title, conversation_id: id, default_model_slug: 'gpt-5-6-thinking', create_time: startedAt, update_time: startedAt + 300 },
    raw_payload: {},
    completeness: { structured_payload: { status: 'usable' }, rendered_dom: { status: 'absent' } },
    resources,
    import_report: {
      status: 'structure_checked', resource_counts: counts, assets: [],
      complete_offline_archive: false,
    },
  };
};

// —— 合成对话 1：把零散需求整理成表格（带表格、代码块、一张图） ——
const alphaId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const alphaCapture = join(ARCHIVE, alphaId, CAPTURE);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="260" viewBox="0 0 480 260">
  <rect width="480" height="260" rx="16" fill="#f8fafc"/>
  <text x="32" y="52" font-family="Segoe UI, system-ui" font-size="20" fill="#111827">每周使用时长（演示数据）</text>
  <g fill="#4c8bed">
    <rect x="52" y="150" width="54" height="70" rx="6"/>
    <rect x="136" y="112" width="54" height="108" rx="6"/>
    <rect x="220" y="88" width="54" height="132" rx="6"/>
    <rect x="304" y="64" width="54" height="156" rx="6"/>
    <rect x="388" y="128" width="54" height="92" rx="6"/>
  </g>
  <g font-family="Segoe UI, system-ui" font-size="13" fill="#64748b" text-anchor="middle">
    <text x="79" y="240">周一</text><text x="163" y="240">周二</text><text x="247" y="240">周三</text>
    <text x="331" y="240">周四</text><text x="415" y="240">周五</text>
  </g>
</svg>`;
const alphaSvg = Buffer.from(svg, 'utf8');
const alphaSha = createHash('sha256').update(alphaSvg).digest('hex');
const alpha = conversation({
  id: alphaId, title: '把零散需求整理成一页表格', startedAt: 1792480000,
  counts: { downloaded: 1, unresolved: 0, failed: 0 },
  resources: [{
    key: 'asset-demo-svg', name: 'weekly-usage.svg', mime_type: 'image/svg+xml',
    local_path: 'assets/' + alphaSha + '.svg', sha256: alphaSha, size_bytes: alphaSvg.length,
    status: 'downloaded', message_ids: [`${alphaId.slice(0, 8)}-0002-4000-8000-000000000002`],
    message_id: null, pointers: ['assets/weekly-usage.svg'],
  }],
  turns: [
    { role: 'user', text: '把下面这些零散需求整理成一页表格，顺便说明每项的验收标准：\n\n- 导入要能一次粘贴多条链接\n- 失败的那条不能中断其余\n- 资料库要能按来源筛选\n- 导出要能带附件' },
    { role: 'assistant', text: '整理成一页表格如下，验收标准我按“用户能自己验证”的方式写：\n\n| 需求 | 现状 | 验收标准 |\n| --- | --- | --- |\n| 批量导入 | 已支持 | 一次粘贴 5 条，失败 1 条时其余 4 条仍然归档 |\n| 失败隔离 | 已支持 | 单条失败只记录原因，不中断队列 |\n| 资料库筛选 | 已支持 | 按来源会话筛选后，数量与列表一致 |\n| 带附件导出 | 已支持 | 导出目录里出现 `attachments/`，链接可直接打开 |\n\n配套的导入脚本大致长这样：\n\n```powershell\nnpm run export:md -- --all --out D:\\vault\\ceobe\nnpm run archive:share -- https://chatgpt.com/share/<share-id>\n```\n\n再附一张演示用的占用示意图：\n\n![每周使用时长](assets/weekly-usage.svg)' },
  ],
});

// —— 合成对话 2：贝叶斯公式（带行内与独立公式） ——
const betaId = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const beta = conversation({
  id: betaId, title: '贝叶斯公式到底在修正什么', startedAt: 1792490000,
  turns: [
    { role: 'user', text: '贝叶斯公式我总是记不住直觉，能不能用一个具体例子讲清楚它在“修正”什么？' },
    { role: 'assistant', text: '可以用一句话概括：**用新证据重新分配你对各个假设的信任**。公式本身是\n\n\\[P(H \\mid E) = \\frac{P(E \\mid H)\\,P(H)}{P(E)}\\]\n\n其中 \\(P(H)\\) 是先验，\\(P(E \\mid H)\\) 是这个假设下看到证据的可能性，\\(P(E)\\) 是证据本身出现的总概率。\n\n举个例子：某种病的患病率是 1%，检测的灵敏度 99%、特异度 95%。检测阳性之后真正患病的概率不是 99%，而是\n\n\\[\\frac{0.99 \\times 0.01}{0.99 \\times 0.01 + 0.05 \\times 0.99} \\approx 16.7\\%\\]\n\n所以“阳性”把 1% 修正到了约 17%，但离“基本确诊”还差得远——这就是先验和证据强度共同作用的结果。' },
    { role: 'user', text: '也就是说，低先验会把阳性结果拉回来？' },
    { role: 'assistant', text: '对。可以把后验看成“先验 × 似然比”的一个加权结果：\n\n1. 先验越低，需要的证据就越强；\n2. 特异度决定了“假阳性”有多少，它经常被忽略；\n3. 同一个检测，用在低风险人群和高风险人群里，阳性含义完全不同。\n\n这也是为什么筛查项目通常要做二次确认：第一次阳性只是把人群从 1% 挑到 17%，第二次检测才会把概率推到足够高。' },
  ],
});

// —— 合成对话 3：构建脚本偶发失败（带代码块与列表） ——
const gammaId = 'cccccccc-3333-4333-8333-cccccccccccc';
const gamma = conversation({
  id: gammaId, title: '构建脚本为什么偶发失败', startedAt: 1792500000,
  turns: [
    { role: 'user', text: 'CI 上的构建脚本偶尔失败，报 EBUSY，但本地重跑就好了。通常是什么原因？' },
    { role: 'assistant', text: 'EBUSY 基本都是“有别的进程正拿着这个文件”。在 Windows 上最常见的是三类：\n\n1. 开发服务器还在监听，热更新在写同一个目录；\n2. 杀毒软件扫描刚下载的文件；\n3. 并行任务同时写同一个共享文件（两边都用 `writeFile` 就会撞上）。\n\n给写文件加一个“存在就跳过”的写法和短暂重试，通常就稳了：\n\n```js\nawait writeFile(target, bytes, { flag: "wx" }).catch(error => {\n  if (error.code !== "EEXIST") throw error;\n});\n```\n\n如果是共享目录被多个进程同时复制，重试几次比直接失败合理：\n\n```js\nfor (let attempt = 0; ; attempt += 1) {\n  try { await cp(source, target, { recursive: true }); break; }\n  catch (error) {\n    if (!["EBUSY", "EPERM"].includes(error.code) || attempt >= 3) throw error;\n    await new Promise(done => setTimeout(done, 120 * (attempt + 1)));\n  }\n}\n```' },
  ],
});

for (const [conversationValue, id] of [[alpha, alphaId], [beta, betaId], [gamma, gammaId]]) {  const folder = join(ARCHIVE, id, CAPTURE);
  await mkdir(join(folder, 'raw'), { recursive: true });
  await mkdir(join(folder, 'assets'), { recursive: true });
  await writeFile(join(folder, 'conversation.ceobe.json'), JSON.stringify(conversationValue, null, 2), 'utf8');
  await writeFile(join(folder, 'raw', 'share.html'), '<!doctype html><title>demo</title>', 'utf8');
}
await mkdir(join(ARCHIVE, alphaId, CAPTURE, 'assets'), { recursive: true });
await writeFile(join(ARCHIVE, alphaId, CAPTURE, 'assets', alphaSha + '.svg'), alphaSvg);

// 再补两份纯文本附件，让资料库截图里有多行可看（不影响阅读页正文）。
const extraAssets = [
  { conversation: alpha, id: alphaId, name: '需求清单.md', mime: 'text/markdown', body: '# 需求清单\n\n- 导入\n- 检索\n- 导出\n' },
  { conversation: alpha, id: alphaId, name: '验收标准.txt', mime: 'text/plain', body: '每条需求都要能被用户自己验证。\n' },
  { conversation: gamma, id: gammaId, name: 'build-log.txt', mime: 'text/plain', body: 'Task :app:assembleRelease\nBUILD SUCCESSFUL in 42s\n' },
];
for (const asset of extraAssets) {
  const bytes = Buffer.from(asset.body, 'utf8');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const extension = asset.name.split('.').pop();
  await writeFile(join(ARCHIVE, asset.id, CAPTURE, 'assets', `${sha}.${extension}`), bytes);
  asset.conversation.resources.push({
    key: 'asset-' + sha.slice(0, 8), name: asset.name, mime_type: asset.mime,
    local_path: `assets/${sha}.${extension}`, sha256: sha, size_bytes: bytes.length,
    status: 'downloaded', message_ids: [], message_id: null, pointers: [],
  });
}
// 资源是在写文件之前追加的，所以带上新列表重写一次对话 JSON。
for (const [conversationValue, id] of [[alpha, alphaId], [beta, betaId], [gamma, gammaId]]) {
  await writeFile(join(ARCHIVE, id, CAPTURE, 'conversation.ceobe.json'), JSON.stringify(conversationValue, null, 2), 'utf8');
}

const projectId = randomUUID();
await mkdir(join(ROOT, 'data', 'private'), { recursive: true });
await writeFile(join(ROOT, 'data', 'private', 'projects.ceobe.json'), JSON.stringify({
  schema_version: '1.0.0', kind: 'ceobe.projects',
  projects: [{
    id: projectId, name: '产品调研', icon: 'book', color: '#4c8bed',
    description: '把公开分享整理成可离线查阅的资料：需求、结论和验收标准放在一起。',
    created_at: '2026-10-18T09:00:00.000Z', updated_at: '2026-10-20T09:00:00.000Z',
    conversation_ids: [alphaId, betaId],
  }],
}, null, 2), 'utf8');
await writeFile(join(ROOT, 'data', 'private', 'bookmarks.ceobe.json'), JSON.stringify({
  schema_version: '1.0.0', kind: 'ceobe.bookmarks',
  items: [{
    id: randomUUID(), chat_id: betaId, message_id: beta.message_ids ?? Object.keys(beta.messages)[1],
    excerpt: '检测阳性之后真正患病的概率不是 99%，而是约 16.7%。',
    role: 'assistant', created_at: '2026-10-20T10:00:00.000Z',
    title: '先验与证据强度', note: '做筛查类产品时，这个数字比灵敏度更值得写在文档里。',
    updated_at: '2026-10-20T10:00:00.000Z', version: 1,
  }],
}, null, 2), 'utf8');

console.log('fixture root:', ROOT);
console.log('building library…');
const build = execFileSync(process.execPath, ['scripts/build-library.mjs'], {
  cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024,
});
console.log(build.split('\n').filter(line => /Library|Assets|Projects|pages|Decorations/.test(line)).join('\n'));
const library = JSON.parse(await readFile(join(ROOT, 'archive', 'library.ceobe.json'), 'utf8'));
console.log('conversations:', library.conversations.map(entry => `${entry.id.slice(0, 8)} ${entry.title} (${entry.turn_count} 轮)`).join('\n'));
