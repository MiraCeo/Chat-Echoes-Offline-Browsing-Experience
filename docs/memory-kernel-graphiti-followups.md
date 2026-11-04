# 记忆内核对照跟进（Graphiti）

> 来源：`getzep/graphiti`（2026-11-04 浅克隆，`--depth 1`，读 README、`edges.py`、`nodes.py`、
> `search_config_recipes.py`、`community_operations.py`、`prompts/dedupe_edges.py`、
> `temporal_edge_utils.py` 与 `graphiti.py` 的方法骨架；未逐行读 `graphiti.py` / `search_utils.py`）。
> 目的：把值得跟进的点记下来，供 1.3.2 / 1.4 排期。**本文不代表已获实施授权。**
> 结论一句话：值得抄的不是图数据库和向量检索，而是「事实有有效期、失效不删除」的数据模型，
> 和「重复与矛盾分开判」的判定纪律。

---

## 一、Graphiti 的模型

| 构件 | 内容 |
|---|---|
| `EntityNode` | `name` / `labels` / `summary`（随边演化）/ `attributes` / `name_embedding` |
| `EntityEdge` | `name` / `fact` / `episodes[]` / **`valid_at` / `invalid_at` / `expired_at` / `reference_time`** |
| `EpisodicNode` | `source` / `source_description` / `content` / `valid_at` —— 原始数据，一等对象 |
| `CommunityNode` | 标签传播聚类 + 区域摘要，层级化 |
| `SagaNode` | 跨 episode 的长叙事 + 摘要 |

检索是 BM25 + 向量 + 图 BFS 三路，再用 RRF / MMR / cross-encoder 融合；去重把
`duplicate_facts` 与 `contradicted_facts` 分成两个输出。

---

## 二、对照

| 维度 | CEOBE 内核 | Graphiti | 判断 |
|---|---|---|---|
| 时间模型 | 节点有 `ts`，状态 `decided/pending/superseded`；边只有 `[from,to,type]` | 边有完整双时态窗口 | **真差距**，数据已具备，只差 schema |
| 出处 | `src: [{s,r,n}]` 正向指针，archive 即 episode 库 | `EpisodicNode` + 反向 `episodes[]` | 半差距：正向够用，缺反向索引 |
| 去重/矛盾 | RUNBOOK：L5 边跑 2–3 遍取并集 + 人工复核 | 重复/矛盾分开判，提示词极保守 | **真差距**：现在是降方差，不是判定程序 |
| 聚类 | L3 主线/主题全人工（13 主线 / 15 thread） | 标签传播自动社区 + 摘要 | **真差距**，纯图算法、不需要 API |
| 检索 | 记忆页 `String.includes` 平铺过滤，无排序、无中文分词 | BM25 + 向量 + BFS + RRF | **真差距**，可只取 BM25 + 图扩展 |
| 本体 | `entities.json` 243 条 + tier 分层 + rejected 词表 | Pydantic 自定义类型 | CEOBE 的 tier 设计更贴合自己的语料，不换 |
| 摄入 | 全量重建（秒级） | 增量 add_episode | 差距小，但删除的连带撤销是真缺口 |
| 冲突语义 | `outcome` 四值 + `preferred` 只表事实版本 + 双观察保留 | 自动失效 | **CEOBE 更严谨，不要换** |

当前 L5 实测：381 节点 / 183 边；边类型 `superseded` 87、`caused_by` 68、`precedes` 25、`part_of` 3；
节点状态 `decided` 289、`superseded` 87、`pending` 5。

---

## 三、跟进项

### P0-1 · 给 L5 边补双时态窗口

**现状**：87 条 `superseded` 边只说明「A 被 B 推翻」，不说明「A 从什么时候起不再成立」。
这件事只体现在目标节点的 `ts` 上，边本身不携带。抽查 4 条，`B.ts > A.ts` 全部成立。

**做法**

- 边从 `[from, to, type]` 扩为 `[from, to, type, valid_at, invalid_at]`（读端兼容旧数组）；
- `superseded` 边的 `invalid_at` = 目标节点 `ts`；`precedes` / `caused_by` / `part_of` 为 `null`；
- `validate-tree.mjs` 新增不变量：`invalid_at >= valid_at`、`superseded` 必须有 `invalid_at`、
  `invalid_at` 不得早于源节点 `ts`、窗口不得超出 `sessions` 的时间范围；
- `memory-view` 透出窗口，L5 视图按窗口着色，而不是只按节点状态着色。

**验收**：旧树仍能读；新树通过 4 条不变量；L5 视图能区分「当时成立、后来被推翻」和「一直成立」。

**成本**：半天，零模型调用。**落点**：1.3.2。

---

### P0-2 · 点时间查询（`?as_of=`）

**现状**：`as_of` 只存在于组快照元数据（`l3-*.v2.json`），页面只能看「现在」。

**做法**

- `memory.html?group=global&as_of=2026-10-22`：显示 `ts <= T` 的节点、窗口覆盖 T 的边；
- 之后被推翻的节点标「当时成立、后来被推翻」，并给出推翻它的节点与时间；
- 与 `l3-*.v2.json` 的 `as_of` 口径保持一致，不另造时间语义。

**验收**：给定 2026-10-22，能列出当时成立、现在已 `superseded` 的节点；
同一 URL 刷新结果稳定；与组快照的 `as_of` 不矛盾。

**成本**：1 天（含 UI）。**落点**：1.3.2。

> 这两项的关系：P0-1 改的是事件树的**结构**（边从「关系」变成「带起止时间的关系」），
> P0-2 是这个结构的**用法**（按时间点回看、定位具体事件）。时间是在 P0-1 里补的，
> P0-2 消费它。

---

### P1-1 · 去重/矛盾两步判定

**现状**：`PROMPT-L5.md` §3 的三条合并判据（实体相同 / 时间窗相邻 / 判断同义）写得对，
但没有候选集，模型是在全树里凭记忆找，只能靠跑 2–3 遍取并集压方差。

**做法**

1. 机械生成候选：同 tier1 实体 + 时间窗 ±3 天（即 §3 的判据，先算出来）；
2. 对每个候选问两个独立问题（重复？矛盾？），沿用 Graphiti 的保守措辞：
   - 「除非新事实明确让旧事实为假，否则不要标为矛盾」；
   - 「不要把额外的活动、进展、状态更新当作对角色/归属/职责事实的矛盾」；
3. 答案与 `confidence` 写进边，2–3 遍跑变成「每条边 3 票」而不是「3 棵树取并集」；
4. 人工只复核票数不一致的。

**验收**：同一批候选跑 3 遍，边级一致率可度量；`validate-tree` 能校验票数字段；
人工复核表只列分歧项。

**成本**：2–3 天（含提示词改写与回归）。**落点**：1.4（属于「校验门和人工复核」）。

---

### P1-2 · 社区检测 → 候选主线/主题

**现状**：L3 主线纯人工（13 主线 / 15 thread / 12 分册），L5 图里可能有没被任何主线覆盖的簇。

**做法**：`scripts/memory-communities.mjs` 对 `tree.json` 跑标签传播（381 节点，毫秒级），
输出 `global/communities.json`：簇 → 节点 id → 主导实体 → 建议归属主线。
人工复核后决定是否新增主线/主题。

**验收**：能指出未被任何主线覆盖的簇；复核表可勾选；不自动改 `l3-*.v2.json`。

**成本**：1 天，纯图算法、无 API key。**落点**：1.3.2 末（服务「L5 跨会话图」）。

---

### P1-3 · 记忆检索升级到 BM25 + 图扩展 + RRF

**现状**：`memory.js` 的搜索是 `searchIndex.filter(entry => text.includes(query))`，
无排序、无中文分词、无图扩展。

**做法**

- 构建期建倒排索引（中文 bigram + 拉丁词），BM25 打分；
- 命中 L5 节点后做 1 跳扩展（沿 `caused_by` / `superseded` 边），带出「相关但没命中关键词」的节点；
- RRF 融合两路结果。

**验收**：同一查询排序稳定；`test-memory-browser` 增加排序断言；无向量、无网络、无 API key。

**成本**：2 天。**落点**：1.3.2（与「记忆搜索键盘导航」同批）。

> 这也是 TODO §四「档案 MCP server 只读薄适配层」的前置条件——那个适配层缺的正是检索质量。

---

### P2-1 · Episode 反向索引

**现状**：`src` 是正向指针（节点 → 会话轮次），缺反向（会话轮次 → 哪些 L5 节点引用它）。

**做法**：构建期生成 `cited_by`：`<short>:<round>` → L5 节点 id 列表。

**验收**：会话页「本会话记忆」能显示被引用数；删除会话时能列出受影响的 L5 节点/边。

**成本**：半天。**落点**：1.4（删除安全的前置）。

---

### P2-2 · 分册可再生成（Saga 化）

**现状**：12 份分册是手写静态文档。

**做法**：分册正文 = 成员节点时间轴 + 摘要，人工编辑作为 overlay 保留；重新生成不覆盖人工编辑。

**验收**：重新生成与人工编辑可 diff；人工段落不被覆盖。

**成本**：2–3 天。**落点**：1.4（「自动更新任务队列」的形状）。

---

## 四、不跟进

| 项 | 理由 |
|---|---|
| 图数据库（Neo4j / FalkorDB / Neptune） | 381 节点 / 183 边放一个 JSON 文件里，页面直接读；上 DB 破坏「静态页面 + 无服务」模型 |
| 摄入期向量化 | 要 API key、要联网，与「内核 source 是私人数据、不公开」冲突；中文专有名词密集语料上 BM25 + 实体对齐性价比更高 |
| 查询期调 LLM | CEOBE 页面是静态的，检索必须在构建期或浏览器内完成 |
| 自动失效（无人工复核） | 契约要求冲突保留双版本、`preferred` 只表事实版本、`outcome` 单独承担结论价值 |
| Telemetry / MCP server / REST server | Graphiti README 自己标注「无鉴权、无注入防护、不要暴露到不可信网络」，与本地服务定位不符 |

---

## 五、不能动的契约

跟进任何一项时，以下约束不变：

1. `outcome` 取值域固定为 `updated | no_information | worse | unknown`；
2. `preferred` 只表示「当前以哪一方作为事实版本」，不表示「哪一方更正确」；
3. `same_event_two_observers` 保留两个观察，不选边；
4. 冲突不自动关闭，`unresolved` 必须带 `owner/status`；
5. L1 契约一行不改；
6. 任何自动产出都要过人工复核门，不静默并入。

---

## 六、建议顺序

1. **1.3.2**：P0-1 边双时态 → P0-2 `?as_of=` 查询（纯机械，风险最低，兑现「L5 跨会话图」）；
2. **1.3.2**：P1-3 BM25 + 图扩展检索（与「记忆搜索键盘导航」同批）；
3. **1.3.2 末 / 1.4 初**：P1-2 社区检测出候选主线（纯图算法，给人工复核提供输入）；
4. **1.4**：P1-1 去重/矛盾两步判定 + 票数复核（「校验门和人工复核」）；
5. **1.4**：P2-1 episode 反向索引 → P2-2 分册可再生成（删除安全与自动更新的前置）。
