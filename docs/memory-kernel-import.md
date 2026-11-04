# 记忆内核本地导入

内核源现在属于 CEOBE 的私有数据，而不是运行时的外部依赖。

## 位置

```text
data/private/memory-kernel/source/
```

它来自 handover：

```text
memory-kernel.bundle     代码、契约、覆盖层
memory-corpus.zip        31 会话原文、L1/L2/L4、L5
```

`data/private` 已被 `.gitignore` 排除，**source、derived view 和 manifest 都不提交**。

## 一次性放入

把 bundle 还原成 git 仓库，再把 corpus 解压进去：

```powershell
git clone memory-kernel.bundle data/private/memory-kernel/source
Expand-Archive memory-corpus.zip -DestinationPath data/private/memory-kernel/source -Force
```

也可以直接复制已经还原好的 handover 目录，但不要复制 `.git`。

## 生成 CEOBE 视图

```powershell
npm run memory:import
```

它会依次：

```text
overlay 19 项校验
L1 / L2 / L4（input 30 + inbox 1）
L3 overview
L5 tree
ceobe-index
12 份分册
→ 生成 data/private/memory-kernel/memory-view.json
→ 写 source-manifest.json
```

只校验、不重新生成 view：

```powershell
node scripts/import-memory-kernel.mjs --check-only
```

## 先看状态

```powershell
npm run memory:status      # archive / source / view / 页面 四段对比
npm run memory:checklist   # 待补的 L1/L2/L4、L3/L3.1、L5、索引、分册
```

- `memory:status` 报告新会话、已不在 archive 的会话、source 是否比 view 新、
  页面是否需要重新发布；`--json` 输出机器可读结果，`--strict` 在过期时退出码 1；
- `memory:checklist` 按会话层 / L3 / L5 / 索引与分册分组列出待办；
  `--stage` 把新会话写成 `data/private/memory-kernel/inbox-staging.json` 待办，
  只生成待办，不生成内容，也不自动并入 `input/`；
- 两者都只读；`npm run check` 里会跑一次 `memory:status`（只告警，不改变退出码）。

新鲜度口径在 `scripts/memory-freshness.mjs`，CLI 和记忆页共用：
关键文件哈希 + source 文件 mtime 判断 view 是否过期，view 与
`replay/public/memory-data.json` 的 mtime 判断页面是否需要重新发布。

## L5 时间窗

`global/tree.json` 的边是 `[from, to, type]`，节点带 `ts`。导入时由
`scripts/memory-tree-time.js` 推导时间窗，**不写回内核产物**（内核重新生成后仍然有效）：

```text
节点：valid_at = ts，invalid_at = 推翻它的节点 ts（沿 superseded 出边），superseded_by = 该节点号
边：  [from, to, type, valid_at, invalid_at]
      superseded 的 invalid_at = 目标节点 ts；其余类型为 null
```

推导结果过 6 条不变量（窗口顺序、superseded 节点必须有出边、非 superseded 节点不得带窗口、
superseded 边必须有窗口、非 superseded 边不得带窗口、一个节点不得有多条 superseded 出边），
不通过则 `npm run memory:import` 直接失败。页面用同一份模块做 `?as_of=` 过滤。

校验、生成 view 并重建页面：

```powershell
npm run memory:import:build
```

单独重建页面：

```powershell
npm run library
```

## 数据流

```text
source（私有）
  ↓ memory:import（校验 + 适配）
memory-view.json（私有派生）
  ↓ library
replay/public/memory-data.json（本地页面数据）
```

运行时页面只读 `replay/public/memory-data.json`，不访问 source；修改内核后重新跑导入。

## 约束

- 不把 source、view、manifest 加入 git；
- 不把原始 corpus 复制到 `attachments/` 或公开导出；
- `source-manifest.json` 记录关键文件哈希，用来判断 view 是否过期；
- 当前 view schema 是 `ceobe.memory-view/2`。
