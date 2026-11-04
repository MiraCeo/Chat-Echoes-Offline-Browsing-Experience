# 记忆内核接入交接（1.3.0 之后）

> 目的：让下一个模型/人不用重读整段会话，就能接手内核层、UI 重排和后续自动化。
> 当前版本：CEOBE 1.3.0（2026-11-03）。
> 当前发布：commit `7dbc111`，annotated tag `v1.3.0`，已 push `origin/main` 和 `origin v1.3.0`。
> 不创建 GitHub Release 页面。

---

## 一、先看哪里

按顺序：

1. `HANDOVER.md`：项目整体交接；
2. `TODO.md`：当前待办和 1.3.x 自动化清单；
3. `CHANGELOG.md`：1.3.0 已交付内容；
4. `docs/memory-kernel-import.md`：内核源、导入、重建；
5. 本文：1.3.0 之后的边界和交接。

内核自己的文档在：

```text
data/private/memory-kernel/source/HANDOVER.md
data/private/memory-kernel/source/RUNBOOK.md
data/private/memory-kernel/source/overlay/CONTRACT.md
data/private/memory-kernel/source/overlay/DELIVERY.md
```

---

## 二、当前架构

```text
data/private/memory-kernel/source/       内核源（私有，不提交）
        ↓ npm run memory:import
data/private/memory-kernel/memory-view.json
        ↓ npm run library
replay/public/memory-data.json
        ↓
memory.html / 会话页 / 项目页 / 时间线
```

### 不能提交的生成物

```text
data/private/memory-kernel/source/
data/private/memory-kernel/memory-view.json
data/private/memory-kernel/source-manifest.json
replay/
```

这些都在 `.gitignore` 里。提交时只加源码、测试、文档、版本文件，**不要 `git add -A`**。

### 内核源

```text
data/private/memory-kernel/source/
```

约 10.8 MB，包含：

- 31 会话原文；
- L1/L2/L4；
- L3/L3.1 overlay；
- L5 tree；
- 12 份分册；
- 校验器、契约、RUNBOOK。

原始 corpus 是私人数据，不要公开分发，不要复制到 `attachments/` 或公开导出。

---

## 三、当前数据口径

```text
archive 会话：31
轮次：1559
账号组：gq 10 / g1 7 / g-early 11 / g-oct 3
未分组：0
全局主线：13
thread：15
项目：7
冲突：9
分册：12
L5：381 节点 / 183 边
```

四组：

```text
gq       国庆组
g1       01–07 序列
g-early  早期账号
g-oct    十月账号
```

g1 的 7 个会话包含 `6ae4e806`（inbox staging）和 `6ae0d90e`（未编号 07）。

---

## 四、当前 UI

### 记忆页

```text
memory.html?group=global
memory.html?group=gq
memory.html?group=g1
memory.html?group=g-early
memory.html?group=g-oct
memory.html?group=g1&session=<id>
```

结构：

```text
范围 tab（全局 + 四组）
→ 搜索
→ 层级导航（L3.1 / L3 / L1 / L2 / L4 / L5）
→ 内容
```

设计决策：

- **范围优先**，L1–L5 是详情层，不做五个主导航 tab；
- L3.1 是组记忆落地页；
- L3 是主线/全局总览；
- L1/L2/L4 是会话详情；
- L5 是全局跨会话树；
- 未分组为 0，隐藏。

### 其他入口

- 会话页右上角「本会话记忆」；窄屏右下角浮动入口；
- 项目页「组记忆」摘要（唯一项目入口）；
- 时间线不再挂逐条记忆入口；
- L4/L5 来源跳 `#bookmark=<message_id>` 并高亮。

---

## 五、已知决策

1. `outcome` 取值域：`updated | no_information | worse | unknown`；
2. 单会话线允许 3 节点例外，不强行凑 6 节点；
3. `user_recollection` 作为显式证据类型，UI 标注“本人回忆，无原始会话”；
4. L5 跨会话边单次判定方差大，同一棵树跑 2–3 遍取并集，人工复核，不做跨树映射；
5. 项目页只显示“所在组记忆”，不冒充项目专属记忆；
6. 记忆页搜索是页内搜索，不混入聊天全局搜索。

---

## 六、1.3.1 范围与进度

### 已提交（未发布）

```text
20b8932 feat(memory): visualize the L4 event tree
3a33a83 refactor(memory): consolidate memory entry points
58907c0 fix(memory): simplify the memory page layout
fc2bec5 feat(memory): add memory status and update checklist
6f16c30 feat(memory): show memory freshness on the memory page
1fbbdbd fix(build): retry ENOENT when syncing public/previews
```

- L4 事件树已实现：节点/边、状态颜色、详情、筛选、窄屏列表；
- 入口已收敛：项目页只保留组记忆摘要，时间线移除逐条记忆 chip；
- 记忆页布局已清理：去重复 badge/说明行，变更块默认收起并人类可读。

### 必做

1. **L4 事件树可视化**
   - 节点、边、状态、轮次；
   - 节点详情；
   - 状态/类型筛选；
   - 点击节点跳原文；
   - 窄屏降级为缩进列表；
   - 独立模块，避免和整体 UI 重排耦合。
   - 状态：已实现 `scripts/memory-event-tree.js`，待 1.3.1 发布。

2. **`memory:status`** — 已完成
   - `npm run memory:status` 对比 archive / source / view / 已发布页面；
   - 报告新会话、已不在 archive 的会话、source 是否比 view 新、页面是否需要重新发布；
   - `--json` 机器可读，`--strict` 过期时退出码 1；
   - 实现：`scripts/memory-status.mjs` + `scripts/memory-freshness.mjs`。

3. **页面过期提示** — 已完成
   - 记忆页顶部显示 view 生成时间和页面构建时间；
   - source 在 view 之后有更新时显示「记忆可能过期」并给出修复命令；
   - 页面只报告 source 是否比 view 新，不报告“页面比 view 旧”（页面本身就是发布物）。

4. **更新清单** — 已完成
   - `npm run memory:checklist` 列出待补 L1/L2/L4 的会话（新会话 / 缺层 / 轮次变化）、
     需要更新的 L3/L3.1、缺 L5 节点的会话、`ceobe-index` 计数和分册正文；
   - `--stage` 把新会话写成 `data/private/memory-kernel/inbox-staging.json` 待办。

### 可选

- 自动 inbox staging：已完成最小版本（只生成待办，不生成内容，不自动并入 `input/`）；
- L5 边生成辅助：未做。

### 不做

- 模型/子代理自动编排；
- 自动生成 L2/L4；
- L5 跨会话图；
- 项目专属记忆；
- 整体 UI 重排。

---

## 七、1.3.2 / 1.4 建议

### 1.3.2

- L5 跨会话图（时间窗 + `?as_of=` 点时间查看已落地）；
- 项目专属记忆；
- 时间轴详情里的记忆入口；
- 记忆搜索键盘导航；
- L5 筛选/折叠。

### 1.4

- 模型/子代理编排；
- 自动更新任务队列；
- 校验门和人工复核；
- 自动 L5 边生成辅助。

> 2026-11-04 对照 `getzep/graphiti` 后的具体跟进项（P0 边双时态 / `?as_of=` 查询，
> P1 去重矛盾两步判定 / 社区检测 / BM25 检索，P2 episode 反向索引 / 分册可再生成）
> 见 [记忆内核对照跟进](memory-kernel-graphiti-followups.md)，排期以那份文档为准。

---

## 八、更新流程

### 内核 source 更新

```powershell
npm run memory:status      # 先看差在哪
npm run memory:checklist   # 再看要补什么
npm run memory:import
npm run library
```

`memory:import` 会跑：

```text
overlay 19 项
L1/L2/L4（30 + inbox 1）
L3 overview
L5 tree
index
12 份分册
→ memory-view
→ source-manifest
```

### 只重建页面

```powershell
npm run library
```

### 验收

```powershell
npm test
npm run build
npm run check
```

当前基线：

```text
npm test       全量通过
npm run build  12.77s
npm run check  38 页
```

---

## 九、历史产物归档

2026-11-04 已把旧调试/导出/原型产物移到：

```text
data/private/_attic/2026-11-04/
```

包括：

```text
verify/ dom-adapt/ test-archive-share/ pdf/ web-capture/
pdf-mobile/ html-export/ pdf-document/ timeline-prototypes/
timeline-card-concepts/ memory-kernel-inbox/ md-export/
live-compare/ asset-baseline/ npm-cache/ memory-kernel-handover/
official-dom/（除 6ad4e7d4 外的旧快照）
参考文件清理评估.md
```

保留：

```text
data/private/archive-backups/
data/private/memory-kernel/
data/private/official-dom/6ad4e7d4/
data/private/import-jobs/
data/private/delete-jobs/
data/private/import-packages/
data/private/_attic/
```

归档说明和文件清单在：

```text
data/private/_attic/2026-11-04/README.md
data/private/_attic/2026-11-04/MOVED.txt
```

---

## 十、接手注意事项

1. 不要提交 `data/private`、`replay`、`dist`；
2. 不要删除 `archive/`；
3. 不要用 junction/symlink 把 `archive/` 或 `data/private/` 接进会被递归删除的临时目录；
4. 内核 source 是私人数据，不要公开；
5. 改 UI 前先读 `docs/usage.md` 和 `CHANGELOG.md`；
6. 改内核前先读 `RUNBOOK.md` 和 `overlay/CONTRACT.md`；
7. 1.3.1 的 L4 可视化应做成独立模块，避免被后续 UI 重排推翻；
8. 任何新写入测试继续使用隔离数据。

---

## 十一、当前工作树

```text
main 比 origin/main 领先 10 个提交
1.3.0 已 tag/push
1.3.1 已提交但未发布（memory:status / 页面过期提示 / 更新清单 / inbox staging 已完成）
最新提交以 `git log -1` 为准
tracked 工作树干净
```

如果接手时不是这个状态，先 `git status` 和 `git log -1`，不要假设本文仍然准确。
