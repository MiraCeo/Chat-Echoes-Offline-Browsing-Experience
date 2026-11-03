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
- 项目页「组记忆」摘要；
- 时间线条目「记忆」；
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

## 六、1.3.1 建议范围

### 必做

1. **L4 事件树可视化**
   - 节点、边、状态、轮次；
   - 节点详情；
   - 状态/类型筛选；
   - 点击节点跳原文；
   - 窄屏降级为缩进列表；
   - 独立模块，避免和整体 UI 重排耦合。
   - 状态：已实现 `scripts/memory-event-tree.js`，待 1.3.1 发布。

2. **`memory:status`**
   - 对比 archive / source / view；
   - 报告新会话；
   - 报告 source 是否比 view 新。

3. **页面过期提示**
   - 显示 view 生成时间；
   - source 变化时提示“记忆可能过期”。

4. **更新清单**
   - 列出需要补 L1/L2/L4 的会话；
   - 列出需要更新 L3/L3.1/L5/分册的项。

### 可选

- 自动 inbox staging（只生成待办，不生成内容）；
- L5 边生成辅助。

### 不做

- 模型/子代理自动编排；
- 自动生成 L2/L4；
- L5 跨会话图；
- 项目专属记忆；
- 整体 UI 重排。

---

## 七、1.3.2 / 1.4 建议

### 1.3.2

- L5 跨会话图；
- 项目专属记忆；
- 时间轴详情里的记忆入口；
- 记忆搜索键盘导航；
- L5 筛选/折叠。

### 1.4

- 模型/子代理编排；
- 自动更新任务队列；
- 校验门和人工复核；
- 自动 L5 边生成辅助。

---

## 八、更新流程

### 内核 source 更新

```powershell
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

## 九、接手注意事项

1. 不要提交 `data/private`、`replay`、`dist`；
2. 不要删除 `archive/`；
3. 不要用 junction/symlink 把 `archive/` 或 `data/private/` 接进会被递归删除的临时目录；
4. 内核 source 是私人数据，不要公开；
5. 改 UI 前先读 `docs/usage.md` 和 `CHANGELOG.md`；
6. 改内核前先读 `RUNBOOK.md` 和 `overlay/CONTRACT.md`；
7. 1.3.1 的 L4 可视化应做成独立模块，避免被后续 UI 重排推翻；
8. 任何新写入测试继续使用隔离数据。

---

## 十、当前工作树

```text
main 与 origin/main 一致
1.3.0 已 tag/push
tracked 工作树干净
```

如果接手时不是这个状态，先 `git status` 和 `git log -1`，不要假设本文仍然准确。
