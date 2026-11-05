# 记忆内核对照跟进（Graphiti / GraphRAG / mem0 / cognee / MemOS / Hindsight）

> 来源一：`getzep/graphiti`（2026-11-04 浅克隆，`--depth 1`，读 README、`edges.py`、`nodes.py`、
> `search_config_recipes.py`、`community_operations.py`、`prompts/dedupe_edges.py`、
> `temporal_edge_utils.py` 与 `graphiti.py` 的方法骨架；未逐行读 `graphiti.py` / `search_utils.py`）。
> 来源二：`microsoft/graphrag`（2026-11-05 浅克隆，读 `docs/index/` 的 overview / methods /
> default_dataflow / outputs 与 `docs/query/` 的 overview / global_search；未逐行读代码）。
> 来源三：`mem0ai/mem0`（2026-11-05 浅克隆，读 `docs/core-concepts/` 的 how-it-works /
> memory-operations/add / search / memory-evaluation；未逐行读 `main.py`）。
> 来源四：`topoteretes/cognee`（2026-11-05 浅克隆，读 `cognee/memory/entries.py`、
> `cognee/memify_pipelines/` 四个精修阶段、`cognee/modules/improve/` 的 stages / watermarks、
> `global_context_index/build_document_index.py`；未逐行读全部代码）。
> 来源五：`MemTensor/MemOS`（2026-11-05 浅克隆，读 `api/mcp_serve.py`、`mem_cube/`、
> `mem_os/core.py` 的 dump/load、README；未逐行读全部代码）。**关注导出与互操作。**
> 来源六：`vectorize-io/hindsight`（2026-11-05 浅克隆，读 README 的 Core Concepts /
> Memory Types / Three Operations / Observations / Mental Models / Decision Models / Banks / MCP；
> 未逐行读代码）。**五个参考里最综合的一个。**
> 目的：把值得跟进的点记下来，供 1.3.2 / 1.4 排期。**本文不代表已获实施授权。**
> 结论一句话：值得抄的不是图数据库和向量检索，而是「事实有有效期、失效不删除」的数据模型，
> 「重复与矛盾分开判」的判定纪律，「图 → 层次社区 → 社区报告」这条自动摘要链，
> 「时间元数据 + 多路检索 + token 效率」这套评测口径，「建图与改图分离 + 水位门控」的增量更新，
> 「自描述 bundle + MCP 工具面」的导出方式，以及「证据计数 + 常驻答案」的信念模型。

---

## 〇、总览（2026-11-05 收口）

六个参考项目看完了，主线记忆框架的六个面都有人覆盖。这一节是结论，后面各节是原始对照。

### 六个项目各给什么

| 项目 | 一句话贡献 | 我们抄什么 |
|---|---|---|
| **Graphiti** | 事实带有效期，失效不删除 | 双时态边（已落地） |
| **GraphRAG** | 图 → 层次社区 → 社区报告 | 社区报告层（P1-2） |
| **mem0** | 时间元数据 + 四路检索 + token 效率 | 检索信号、评测口径（P1-3） |
| **cognee** | 建图与改图分离 + 水位门控 | 精修层、增量更新（P1-4） |
| **MemOS** | 自描述 bundle + MCP 工具面 | 导出与互操作（P2-3） |
| **Hindsight** | 证据计数 + 常驻答案 + 类型化判断 | L5 信念化、L3.1 常驻问题 |

### 六个面与当前状态

| 面 | 参考 | 我们的状态 |
|---|---|---|
| 数据模型 | Graphiti | ✅ 双时态 + 重要度分层已落地 |
| 抽取质量 | —（自研） | ✅ 评测 + 动态上限 + g1 重抽完成 |
| 精修层 | cognee | ⬜ 待建（P1-4） |
| 摘要层 | GraphRAG + cognee | ⬜ 待建（P1-2） |
| 检索层 | mem0 + Hindsight | ⬜ 待建（P1-3） |
| 信念层 | Hindsight | ⬜ 待建（L5 信念化 / L3.1 常驻问题） |
| 导出层 | MemOS | ⬜ 待建（P2-3） |

### 收口后的路线

1. **P1-4 精修层**（cognee）：L4→L5 之间的实体合并 / 补边 / 冲突复核，独立幂等阶段；
2. **P1-2 社区报告层**（GraphRAG + cognee）：确定性 tf-idf 索引 + LLM 社区报告；
3. **P1-3 检索**（mem0 + Hindsight）：BM25 + 实体 + 时间三路，加 token 效率指标；
4. **L5 信念化**（Hindsight）：`support` 证据计数 + `refined` 历史；
5. **L3.1 常驻答案**（Hindsight）：四块改成四个常驻问题，系统维护答案；
6. **P2-3 导出 / MCP**（MemOS）：自描述 bundle + 只读工具面；
7. **P2-1 episode 反向索引 → P2-2 分册可再生成**。

### 不跟进的共性

六个项目的技术栈并不相同，但共同点是**都要跑一个服务 + 一个数据库**：

| 项目 | 图库 | 向量库 | 关系库 | 服务端 |
|---|---|---|---|---|
| Graphiti | Neo4j / FalkorDB / Neptune | 存在图库里（`fact_embedding`） | 无 | 参考 MCP + FastAPI REST |
| GraphRAG | **无图库**（NetworkX + GraphML） | LanceDB（默认） | 无（Parquet） | 无服务端（CLI/库） |
| mem0 | Neo4j（可选） | 25+ 种（Qdrant / Chroma / pgvector / Milvus …） | SQLite / Postgres | FastAPI + 托管 Platform |
| cognee | Kuzu（默认）/ Neo4j / Neptune / Postgres | LanceDB（默认）/ pgvector | SQLAlchemy（SQLite / Postgres） | FastAPI + 前端 |
| MemOS | Neo4j / PolarDB / Postgres | Milvus / Qdrant | 无 | FastAPI + MCP |
| Hindsight | 无独立图库（存 Postgres） | pgvector | PostgreSQL / Oracle 23ai | FastAPI + UI + 每 bank 一个 MCP |

CEOBE 是「静态页面 + 本地文件 + 无服务」，所以一律不跟：图数据库、向量库、Postgres、
云端租户、计费、遥测。只借**数据模型、判定程序、评测口径、导出格式**这四类东西。

> 注意：GraphRAG 和 Hindsight 其实不是「三件套」——前者是纯文件（Parquet + NetworkX + LanceDB），
> 后者是单库（Postgres + pgvector）。真正需要「图库 + 向量库 + 服务端」的是 Graphiti / mem0 /
> cognee / MemOS 四个。

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

### 优先级总表

标签保留原编号（已完成的 P0 被 TODO / CHANGELOG / commit 引用），**实际执行顺序以本表为准**：

| 顺序 | 项 | 状态 | 落点 |
|---|---|---|---|
| 1 | **P1-0 抽取质量闭环**（评测 + 类型约束 + 归并） | 待做 | 1.4（提前到最前） |
| 2 | P1-1 去重/矛盾两步判定 | 待做（并入 P1-0 第 3 步） | 1.4 |
| 3 | P1-2 社区检测 → 候选主线/主题 | 待做 | P1-0 之后 |
| 4 | P1-3 记忆检索 BM25 + 图扩展 | 待做 | P1-0 之后 |
| 5 | P2-1 Episode 反向索引 | 待做 | 1.4 |
| 6 | P2-2 分册可再生成 | 待做 | 1.4 |
| — | P0-1 L5 边双时态窗口 | **已完成** | 1.3.2 |
| — | P0-2 `?as_of=` 点时间查询 | **已完成** | 1.3.2 |

> 2026-11-04 调整：抽取质量是核心框架，优先级高于其余跟进项。P0 两项是数据模型层，
> 已完成且不占位；P1-0 补的是「抽取 → 解析/归并 → 存储」里缺失的中间环节。

### P0-1 · 给 L5 边补双时态窗口

**状态：已完成（1.3.2）**

**现状**：87 条 `superseded` 边只说明「A 被 B 推翻」，不说明「A 从什么时候起不再成立」。
这件事只体现在目标节点的 `ts` 上，边本身不携带。抽查 4 条，`B.ts > A.ts` 全部成立。

**做法（已实现）**

- 边从 `[from, to, type]` 扩为 `[from, to, type, valid_at, invalid_at]`（旧的三元组读法仍可用）；
- 节点同时带 `valid_at` / `invalid_at` / `superseded_by`：`invalid_at` = 推翻它的节点 `ts`；
- `superseded` 边的 `invalid_at` = 目标节点 `ts`；`precedes` / `caused_by` / `part_of` 为 `null`；
- **推导放在 CEOBE 的导入适配层**（`scripts/memory-tree-time.js`），不写进内核 `tree.json`：
  内核产物由模型重新生成，写进去会丢；放在适配层则每次导入都重新推导；
- 导入时校验 6 条不变量，不通过直接失败：`invalid_at >= valid_at`、`superseded` 节点必须有出边、
  非 `superseded` 节点不得带 `invalid_at`、`superseded` 边必须有 `invalid_at`、
  非 `superseded` 边不得带 `invalid_at`、一个节点不得有多条 `superseded` 出边；
- `memory-view` 透出窗口，L5 视图按窗口着色（被推翻的节点琥珀色边框 + 推翻时间）。

**验收**：旧树仍能读；新树通过 6 条不变量；L5 视图能区分「当时成立、后来被推翻」和「一直成立」。

**成本**：半天，零模型调用。**落点**：1.3.2。

> 与计划的一处偏差：原计划改内核 `validate-tree.mjs`。实际把校验放在 CEOBE 导入层，
> 因为内核产物会被重新生成，而 `data/private` 不提交——放在适配层才是可提交、可回归的那一半。
> 内核侧 `PROMPT-L5.md` 若将来直接产出窗口，适配层会原样保留（推导是幂等的）。

---

### P0-2 · 点时间查询（`?as_of=`）

**状态：已完成（1.3.2）**

**现状**：`as_of` 只存在于组快照元数据（`l3-*.v2.json`），页面只能看「现在」。

**做法（已实现）**

- `memory.html?group=global&as_of=2026-10-15`：显示当时已存在的节点、两端都存在的边；
- 之后被推翻的节点标「当时成立、后来被推翻」，并给出推翻时间与推翻它的节点；
- L5 区块内提供日期选择器和「回到当前」，与 URL 双向同步；
- 按**本地日历日**比较（与页面显示同一套日历），避开 UTC+8 的 8 小时偏移；
- 与 `l3-*.v2.json` 的 `as_of` 口径保持一致，不另造时间语义。

**验收**：给定 2026-10-15，能列出当时成立、现在已 `superseded` 的节点；
同一 URL 刷新结果稳定；与组快照的 `as_of` 不矛盾。

**成本**：1 天（含 UI）。**落点**：1.3.2。

> 实测：截至 2026-10-15 显示 307 节点 / 149 边（全量 381 / 183），
> 其中 1 个节点当时成立、后来被推翻；截至 2026-10-22 为 347 / 165。

> 这两项的关系：P0-1 改的是事件树的**结构**（边从「关系」变成「带起止时间的关系」），
> P0-2 是这个结构的**用法**（按时间点回看、定位具体事件）。时间是在 P0-1 里补的，
> P0-2 消费它。

---

### P1-0 · 抽取质量闭环（评测 + 类型约束 + 归并）

**状态：待做（最高优先级）**

**现状（实测）**

| 信号 | 数值 | 含义 |
|---|---|---|
| L4 节点 | 393（30 会话 + inbox 1） | 每会话约 13 个，在提示词 8–15 的区间内 |
| 类型分布 | `decision` 286（76%）、`problem` 59、`artifact` 21、`event` 8、`open` 3 | 五类分不出来，等于只有一类 |
| 正文长度 | 中位 25 字，最长 53（上限 60） | 节点像笔记，脱离上下文读不懂 |
| 实体 | 264 个，235 个只出现一次（89%） | 抽取时没有受控词表 |
| L5 合并 | 393 → 381，只合了 12 组（3%） | 跨会话同一件事基本没合上 |
| 质量指标 | **无** | 只有结构校验器，没有质量指标 |

**差距**：CEOBE 在「抽完」和「写文件」之间没有解析/归并环节，每个会话孤立抽取，
抽的时候不知道别的会话里已经有什么。Graphiti 的完整框架正是围绕这一环建的。

**做法（四步）**

> **工作方式约束（2026-11-04 确认）**：内核支持修改，但人工只做小范围精修，不做大范围改。
> 研究期内尽量让模型自动跑，人工只点检分歧项。因此评测拆成「自动指标 + 模型起草标注 +
> 人工只复核分歧」，而不是逐条人工标注。
>
> **上下文隔离（2026-11-04 确认）**：评测、标注、内核重跑一律交给**子代理在干净上下文中**执行，
> 主代理不亲自跑——主代理已经读过现有抽取结果，会带着答案出题。子代理只拿 L2 和规则，
> 不读 `events/`。主代理只负责对比、汇总和把分歧交给人。

1. **评测**（进行中）
   - 两层：**自动指标**（类型分布/熵、正文长度、节点密度、`superseded` 一致性、来源覆盖）
     无需标注，每次跑内核都能算；**语义指标**（召回 / 精确 / 类型准确 / 状态准确 /
     `superseded` 边）对标注文件评分；
   - 标注由模型从 L2 起草，人工只点检分歧项；
   - 试点《03查看文件内容》：两轮独立标注（子代理、干净上下文、不读 `events/`）后，
     候选集 84 条（core 11 / supporting 54 / optional 19）；
   - **旧 L4（15 条）语义匹配：核心召回 54.5%、支撑召回 16.7%**；
   - **新 L4（0.3.0，25 条）：核心召回 72.7%、支撑召回 29.6%**，6 条 `superseded` 链，
     体积 4000 字节；仍漏 3 条 core（2 条是合并丢判断、1 条真漏）；
   - 校准：新 L4 标了 19/25 条 core，分层失效，已在提示词加「core 8–12 条」约束；
   - **g1 全组（7 会话）已按 0.3.0 重抽**：249 节点（core 84 / supporting 165）、99 条边、
     46 条 `superseded` 链、51.6 KB；校验 PASS（体积只报不拦）；
   - 试点《03查看文件内容》语义匹配：核心召回 **54.5%（旧）→ 72.7%（v2）→ 81.8%（v3）**，
     支撑召回 **16.7% → 29.6% → 42.6%**；仍漏 2 条 core（1 条合并、1 条真漏）；
   - 校准生效：除试点（19/25 core，规则加入前抽取）外，其余 6 篇 core 均为 11–12 条（46–52%）；
   - **g1 L5 已归并**：249 → 240 节点（合并率 96%）、112 条边、5 条严格跨会话 `superseded`；
     按主线分布 self-and-work 75 / yj-intern 59 / isaac 56 / null 30 / sys-plan 15 / tourgrid 5；
   - `validate-tree.mjs` 的 `superseded` 方向改为按**来源时间**校验（原来按节点号，
     会逼归并员重排会话顺序）；L5 树已按时间重新编号；
   - 用户确认「内推人始终只有秋」，M7 的同一性成立；
   - **g1 L5 已接入页面**：`memory.html?group=g1` 底部新增「L5 跨会话树」，按主线分组
     （self-and-work 75 / yj-intern 60 / isaac 56 / 未归属 30 / sys-plan 15 / tourgrid 5），
     core 节点带紫色左边框；层级导航新增「L5 跨会话树」；
   - `PROMPT-L5.md` 加两条硬规则：**先按类型分桶再合并**（`open` 只并 `open`、`decision` 只并
     `decision`）、**合并后逐源核对时间范围 / 主体 / 条件**三个限定词；
   - **core 抽查（02 / 04）**：02 的 12 条 core 里 4 条不够格（含一对重复占位），建议 8；
     04 的 12 条里 1 条偏边缘，建议 11；
   - **「不要凑满 12 条」的约束重抽失败**：两篇 core 仍是 12，但 `superseded` 链从
     9→3（02）、4→3（04）大幅回退——抽取员改了策略、丢了推翻关系。**保留 v3，不采用 v4**；
     core 过度标注改用「复核后降级」的后处理，不再靠提示词约束；
   - **上限是主要瓶颈**：第一轮标注为守住「8–15 条」主动舍弃了 4 处真实推翻；
     放开上限后同一会话列出 84 条候选、15 条 `superseded` 链，其中 3 条是作者自己的
     「决策」小节都没标注的。说明「节点数 ≤16」这个数量代理在压制真实信息；
   - 工具：`npm run memory:eval -- --session <short>`，标注在
     `data/private/memory-kernel/eval/`（不提交）。
2. **类型约束与动态上限**（进行中）
   - **准则：动态上限优先于硬上限。** 任何预算都要挂在内容信号上，不挂在轮次或固定字节上；
   - **已改 `PROMPT-L4.md` 0.3.0**：删掉「约每 8 轮 1 个、上限 16」和 4 KB 硬上限，
     改为 `core ≤ 12`、`supporting ≤ 2 × core`、`optional` 不进 L4；体积是结果不是闸门；
   - `r` 允许同轮多节点（起点不倒退即可），脊柱顺序由 `n` 保证；
   - 节点新增 `w`（core / supporting / optional）；§6 改为「L2 定路径，原文定全集」；
   - 五类各定必填字段：`decision` 必须有「定了什么 / 替代了什么 / 依据哪轮」，
     `problem` 必须有「暴露了什么 / 影响什么」，`artifact` 必须有「产出物 / 归属」，
     `open` 必须有「卡在哪 / 谁能解」；
   - 抽不出来即不合法，由校验器拒绝。
3. **归并环节**（2–3 天，即 P1-1）
   - 机械生成候选（同 tier1 实体 + 时间窗 ±3 天）；
   - 重复/矛盾分开问，记票 + `confidence`；
   - 人工只复核票数不一致的。
4. **重跑对比**（1 天）
   - 新提示词 + schema 重跑 L4/L5，产出 `tree-v2.json`；
   - 与基线 eval 对比，达标才替换；旧树留作基线。

**验收**：基线 eval 有数字；新树 4 个指标不低于基线且至少一项明显提升；旧树可回退。

**成本**：5–7 天。**落点**：1.4，排在所有跟进项之前。

> **重跑范围（2026-11-04 决定）**：现有 L4（393 节点）与 L5（381 节点）按旧提示词产出，
> **视为作废**；L1 / L2 / L3 / L3.1 不受影响。
> **先做 01–07 组（g1，7 个会话）**：L4 定下来之后再研究这个组的 L5，其余三组暂不动。
> 旧树保留为 `tree-v1` 基线，用于 eval 对比与回退。

**风险**：重跑会改掉全部节点编号和边，等于产出一棵新树。必须保留旧树做基线，
新树先出 `tree-v2.json`、eval 通过再切换。页面和 `?as_of` 不用改——时间窗是机械推导的，换树自动生效。

**不借的部分**：Graphiti 的抽取提示词（实体/三元组 ≠ 事件/判断）、图数据库、摄入期向量化、自动失效。

---

### P1-1 · 去重/矛盾两步判定

**状态：待做（并入 P1-0 第 3 步执行，本节保留判定细节）**

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

### P1-2 · 社区报告层（原「社区检测 → 候选主线」）

**现状**：L3 主线纯人工（13 主线 / 15 thread / 12 分册），L5 图里可能有没被任何主线覆盖的簇；
g1 的 L5 已有 241 节点，平铺列表读不动。

**做法**（参考 GraphRAG 的 `CommunityReport`）：

1. 对 L5 图跑层次聚类（Leiden 或标签传播），得到 `parent` / `children` / `level`；
2. 每个社区生成报告：`title` / `summary` / `findings`（3–5 条要点）/ `rank`；
3. 报告作为 **L3.1 候选**，人工只做「采纳 / 改写 / 丢弃」，不再从零写；
4. 页面按社区层级展示：默认显示报告（10–20 块），点开才看节点。

**验收**：241 节点收敛成 10–20 个可读块；人工复核表可勾选；不自动改 `l3-*.v2.json`。

**成本**：2–3 天（聚类 1 天 + 报告生成 1–2 天）。**落点**：P1-0 之后。

> 2026-11-05 升级：原计划只做「聚类 → 候选主线」，看完 GraphRAG 后扩成「聚类 → 社区报告」。
> 只聚类的话，人工还得从簇里自己读；有了报告，人工只做采纳/改写，价值大得多。

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

1. **P1-0 抽取质量闭环**（评测 → 类型约束 → 归并 → 重跑对比）—— 最优先，核心框架；
2. **P1-1 去重/矛盾两步判定** —— 作为 P1-0 第 3 步执行；
3. **P1-2 社区检测**出候选主线（纯图算法，给人工复核提供输入）；
4. **P1-3 BM25 + 图扩展检索**（与「记忆搜索键盘导航」同批）；
5. **P2-1 episode 反向索引 → P2-2 分册可再生成**（删除安全与自动更新的前置）。

已完成：**P0-1 边双时态**、**P0-2 `?as_of=` 查询**（1.3.2）。

> 2026-11-04 调整：原顺序把 P1-3 / P1-2 排在前面，理由是「纯机械、风险低」。
> 但抽取质量决定这棵树值不值得读，属于核心框架；P0 两项是数据模型层，已完成且不占位。
> 因此 P1-0 提到最前，P1-2 / P1-3 顺延到它之后。

---

## 七、GraphRAG 对照（2026-11-05）

### 知识模型

| 构件 | 内容 |
|---|---|
| `TextUnit` | 文本块（默认 1200 token），带出处 |
| `Entity` | `title` / `type` / `description` / `frequency` / `degree` |
| `Relationship` | `source` / `target` / `description` / `weight` |
| `Covariate`（claim） | `subject` / `object` / `status`（TRUE/FALSE/SUSPECTED）/ `start_date` / `end_date` |
| `Community` | Leiden 层次聚类，`parent` / `children` / `level` |
| `CommunityReport` | 每个社区的 LLM 报告：`title` / `summary` / `full_content` / `rank` / `findings` |

流水线六阶段：切块 → 建文档表 → 抽实体/关系/claim → Leiden 层次聚类 → 生成社区报告 → 向量化。
查询四种：local（实体为中心）、global（对社区报告做 map-reduce）、drift（用社区信息扩展 local）、
basic（普通向量 RAG）。

### 对照

| 维度 | CEOBE | GraphRAG | 判断 |
|---|---|---|---|
| 图的性质 | **事件图**（decision/problem/artifact） | **实体图**（人/组织/地点/事件） | 不同任务，不换 |
| 聚类 | L3 主线人工（每组 5 条） | Leiden 层次聚类，自动 | **真差距** |
| 摘要层 | L3 分册人工写 | 每个社区自动生成报告 + findings + rank | **真差距** |
| 时间 | L5 边有 `valid_at`/`invalid_at`（机械推导） | claim 有 `start_date`/`end_date`（LLM 判） | **CEOBE 更严谨** |
| 检索 | 页面浏览 + 子串搜索 | local / global / drift / basic 四种 | **真差距** |
| 增量更新 | 全量重跑 | `update_*` 系列工作流 | 差距，优先级低 |
| 抽取成本 | 全 LLM | 有 FastGraphRAG（NLP 抽实体，省 75% 成本） | 可参考，中文难 |

### 值得跟进

1. **层次化社区报告**（已并入 P1-2）——补上 L5 图与 L3 主线之间缺的自动摘要层；
2. **社区报告作为检索单元**——页面默认显示报告（10–20 块），点开才看节点；
3. **drift search 的思路**——用社区信息扩展查询，等 P1-3 检索做完再考虑；
4. **增量更新工作流**——只重算受影响的社区，对 1.4 的自动更新队列有参考价值。

### 不跟进

- Parquet / 向量库 / 图数据库——破坏静态页面模型；
- 实体图——CEOBE 是事件图，换过去等于重写；
- claim 的 LLM 判定——我们的时间窗是机械推导的，更可靠；
- FastGraphRAG 的 NLP 抽取——英文名词短语抽取，中文事件抽取用不上。

---

## 八、mem0 对照（2026-11-05）

> 来源：`mem0ai/mem0`（浅克隆，读 `docs/core-concepts/how-it-works.mdx`、
> `memory-operations/add.mdx`、`search.mdx`、`memory-evaluation.mdx`；未逐行读 `main.py`）。

### 模型

| 构件 | 内容 |
|---|---|
| 抽取 | 单遍 LLM 从「输入 + 上下文」抽 ADD-only 事实；先查相关旧记忆避免重复 |
| 去重 | 哈希去重 + 向量化 |
| 实体链接 | 专有名词 / 引号文本 / 复合名词短语 → 实体图，跨记忆连接 |
| 时间推理 | 独立一遍，抽「何时发生 / 进行中还是已完成 / 时间精度 / 记忆类型」 |
| 记忆类型 | `event` / `state` / `plan` / `preference` / `relationship` / `absence` |
| 检索 | 语义 + BM25 + 实体 + 时间四路信号，按 rank 融合 |
| 评测 | LoCoMo 92.5 / LongMemEval 94.4 / BEAM 64.1（1M）、48.6（10M），**平均 ~7K token/查询** |

### 对照

| 维度 | CEOBE | mem0 | 判断 |
|---|---|---|---|
| 定位 | 个人档案记忆（事件/判断） | Agent 记忆层（事实/偏好） | 不同任务 |
| 失效处理 | `superseded` + 时间窗，显式标推翻 | ADD-only，旧事实保留但不标失效 | **CEOBE 更显式** |
| 时间元数据 | `valid_at` / `invalid_at`（机械推导） | 何时发生 / 进行中 / 精度 / 类型（LLM 抽） | **互补** |
| 检索信号 | 子串匹配 | 语义 + BM25 + 实体 + 时间 | **真差距** |
| 评测 | 召回 / 精确 / 类型准确 | 准确率 + **token 效率** + top-k 截断 | **缺 token 维度** |
| 记忆类型 | event / decision / problem / artifact / open | event / state / plan / preference / relationship / **absence** | `absence` 值得补 |

### 值得跟进

1. **时间元数据补两个字段**：`state`（ongoing / completed）和 `precision`（day / month / unknown）。
   我们现在只有窗口起止，没有「这件事还在进行还是已经结束」「时间精度到哪一级」。
   这两个字段直接影响「截至某日这件事是什么状态」的查询质量。
2. **检索加实体与时间两路信号**：P1-3 原计划是 BM25 + 图扩展，mem0 的做法是四路融合
   （语义 / BM25 / 实体 / 时间）。实体信号可以用我们的 `entities.json`，时间信号用 `valid_at`。
3. **评测加 token 效率**：我们的 eval 只看召回/精确，没看「检索出来的上下文有多大」。
   对页面浏览影响小，但对将来的 MCP 只读适配层是硬指标。
4. **`absence` 记忆类型**：mem0 把「没发生的事」单独列一类（没投递、没看到实习）。
   我们的 `open` 只覆盖「未解决」，不覆盖「否定事实」。这类判断在语料里不少。

### 不跟进

- 向量库 / 图数据库 / SQL 三件套——同上；
- ADD-only 不标失效——我们的 `superseded` 更显式，不退回；
- 它的 benchmark 数字——语料和语言都不同，只借方法不借分数。

---

## 九、cognee 对照（2026-11-05）

> 来源：`topoteretes/cognee`（浅克隆，读 `cognee/memory/entries.py`、
> `cognee/memify_pipelines/` 的 global_context_index / consolidate_entities /
> cross_connect_entities / review_conflicts、`cognee/modules/improve/` 的 stages / watermarks、
> `cognee/tasks/memify/global_context_index/build_document_index.py`；未逐行读全部代码）。

### 模型

cognee 把「建图」和「改图」拆成两套流水线：

| 流水线 | 做什么 |
|---|---|
| **cognify** | 从文本抽实体/关系，建图（对应我们的 L4） |
| **memify** | 在已有图上做精修，幂等、可单独重跑 |
| **improve** | 带门控的阶段编排：没有新写入就跳过（watermark） |

memify 的四个精修阶段：

| 阶段 | 做什么 | 对应我们的 |
|---|---|---|
| `consolidate_entities` | 按相似度 + 名称合并近重复实体，支持 `dry_run` | L5 归并 |
| `cross_connect_entities` | 按相似度/重叠补边，限制每节点新增边数 | L5 跨会话边 |
| `global_context_index` | **确定性**层次索引：每文档一个 bucket（tf-idf 独有实体）+ 一个 root（文档频率共享实体），**不用 LLM** | L3 / L5 摘要层 |
| `review_conflicts` | 读事实 → 审实体 → 写冲突 | 冲突记录 |

`improve` 的 watermark 机制：每个阶段记自己的时间戳，只认 `succeeded` 的操作；
没有新写入就返回 `no_writes_since_last_improve` 跳过；时间戳缺失或损坏时**保守重跑**。

### 对照

| 维度 | CEOBE | cognee | 判断 |
|---|---|---|---|
| 建图与改图 | L4 抽取 + L5 归并，一次跑完 | cognify / memify 分离，memify 可单独重跑 | **真差距** |
| 全局索引 | L3 人工写 + GraphRAG 式 LLM 报告 | **确定性** tf-idf / 文档频率索引，零 LLM | **互补** |
| 增量更新 | 全量重跑 | watermark 门控，无新写入就跳过 | **真差距** |
| 冲突处理 | 人工记录 + `outcome` 词表 | 独立 `review_conflicts` 阶段 | 可参考 |
| 实体合并 | L5 归并时顺带做 | 独立阶段，带阈值 / dry_run / 保护类型 | 更可控 |

### 值得跟进

1. **把「精修」拆成独立阶段**（最贴合「衔接 L2-L5」）：
   现在 L4 抽完直接进 L5 归并，中间没有可单独重跑的精修层。cognee 的做法是
   `consolidate_entities` / `cross_connect_entities` / `review_conflicts` 各自幂等，
   可以只重跑其中一个。对应到我们：L4 之后加一层「实体合并 + 补边 + 冲突复核」，
   与 L5 归并解耦。
2. **确定性全局索引**：`global_context_index` 用 tf-idf（每会话独有实体）+
   文档频率（全局共享实体）建两层索引，**零 LLM**。这可以作为 GraphRAG 式 LLM 社区报告的
   廉价替代或前置：先出确定性索引，再决定哪些 bucket 值得让 LLM 写报告。
3. **watermark 门控的增量更新**：每个阶段记自己的水位，没有新写入就跳过；
   时间戳缺失时保守重跑。这直接对应 1.4 的「自动更新任务队列」。
4. **冲突复核独立成阶段**：读事实 → 审实体 → 写冲突，和我们的冲突记录结构接近，
   但它是可重跑的阶段而不是一次性人工动作。

### 不跟进

- Postgres / 图库 / 向量库三件套——同上；
- 实体为中心的图——CEOBE 是事件图；
- 它的 session / trace / feedback 记忆条目——面向 agent 运行时，不是档案记忆。

---

## 十、MemOS 对照（2026-11-05）

> 来源：`MemTensor/MemOS`（浅克隆，读 `src/memos/api/mcp_serve.py`、
> `src/memos/mem_cube/base.py` / `general.py`、`src/memos/mem_os/core.py` 的 dump/load、
> README；未逐行读全部代码）。**关注点：导出与互操作，不是可视化。**

### 模型

| 构件 | 内容 |
|---|---|
| **MemCube** | 可组合的记忆容器：`text_mem` / `act_mem`（KV-cache）/ `para_mem`（LoRA）/ `pref_mem` |
| `dump(dir)` / `load(dir, memory_types)` | 导出/导入一个 cube 到目录；`memory_types` 可只导某一类 |
| `share_cube` / `register_cube` / `unregister_cube` | 共享、挂载、卸载 cube |
| **MCP server** | 把上述操作暴露成工具：`search_memories` / `add_memory` / `get_memory` / `update_memory` / `delete_memory` / `dump_cube` / `share_cube` / `get_user_info` |
| 导出格式 | 目录 + `config.json`（含 `model_schema` 版本）+ 每类记忆各自的 dump 文件 |

### 对照

| 维度 | CEOBE | MemOS | 判断 |
|---|---|---|---|
| 导出单位 | `export:json` / `export:md` 单文件 | **目录 bundle**：manifest + 分层文件 | **真差距** |
| 版本校验 | `source-manifest.json` 有哈希 | `config.json` 带 `model_schema`，load 时校验 | 可参考 |
| 选择性导出 | 全量 | `memory_types` 只导某一类 | **真差距** |
| 互操作面 | 无（只有页面） | **MCP server**，工具齐全 | **真差距** |
| 分组 | 账号组 gq/g1/… | cube 可注册/共享/组合 | 概念对应 |
| 运行时记忆 | 无 | activation / parametric 记忆 | 不适用 |

### 值得跟进

1. **导出做成自描述 bundle**（最贴合「如何导出」）：
   一个目录，含 `manifest.json`（schema 版本、层清单、计数、哈希）+ 每层一个文件
   （L1/L2/L3/L4/L5）。现在我们的 `export:json` 是单文件、`source-manifest.json` 只覆盖
   内核源，两者没有合成一个可移植的包。
2. **选择性导出**：`memory_types` 那种「只导 L4」「只导 L5」的开关。对下游（MCP、别的模型）
   很有用——不是每个消费者都需要全部五层。
3. **MCP 工具面**：MemOS 的工具集可以直接作为我们 MCP 适配层的清单：
   `search` / `get` / `list` / `dump`，只读优先。这正好接上 TODO §四里那条
   「档案 MCP server 只读薄适配层」。
4. **cube 概念对应账号组**：我们的 gq/g1/g-early/g-oct 就是天然的 cube，
   可以按组导出、按组共享。

### 不跟进

- activation / parametric 记忆（KV-cache / LoRA）——静态档案用不上；
- 它的多库后端——同上；
- 云端共享与用户体系——CEOBE 是本地单用户。

---

## 十一、Hindsight 对照（2026-11-05）

> 来源：`vectorize-io/hindsight`（浅克隆，读 README 的 Core Concepts / Memory Types /
> Three Operations / Observations / Mental Models / Decision Models / Banks / MCP；
> 未逐行读代码）。**这是五个参考里最综合的一个**，五个面都有覆盖。
> 另注：本机 DSH 的 🧠 记忆插件就是它的 coding-agents 集成。

### 模型

| 构件 | 内容 |
|---|---|
| 记忆类型 | **world facts**（世界事实）/ **experiences**（自身经历）/ **observations**（证据支撑的信念）/ **mental models**（从观察与事实合成的理解） |
| 三个操作 | **retain**（写入，LLM 抽事实/时间/实体/关系）/ **recall**（四路检索）/ **reflect**（深度分析，形成新连接） |
| observations | 后台把相关事实合并成去重信念，**带原文引用与证据计数**，新证据是「强化/削弱/扩展」而不是覆盖 |
| mental models | 对某个问题的**常驻答案**：问题定义一次，系统写答案并在后台重写；读取是纯 DB 读，不检索、不调 LLM |
| knowledge pages | mental models 的封装：像 wiki 一样分文件夹、可搜索、**可投影成 markdown** |
| decision models | 小模型（0.8B）回答「这条是不是新的 / 哪些记忆相关 / 会不会改变知识页」这类**类型化判断**，不把文本丢给大模型 |
| banks | 隔离的记忆库，一个用户/agent/项目一个；严格隔离；带 disposition traits |
| MCP | 每个 bank 一个 MCP 端点，暴露 retain / recall / reflect |

### 对照

| 维度 | CEOBE | Hindsight | 判断 |
|---|---|---|---|
| 信念模型 | L5 节点有 `src`，无证据计数 | observations 带引用 + 证据计数 + 强化/削弱 | **真差距** |
| 常驻答案 | L3.1 四块人工写 | mental models：定义问题，系统维护答案 | **真差距** |
| 判断层 | 全 LLM | decision model（0.8B）做类型化判断 | **可参考** |
| 检索 | 子串匹配 | 四路 + RRF + cross-encoder | 同 mem0 |
| 深度分析 | 无 | reflect | 新能力 |
| 导出 | 单文件 | knowledge pages 投影成 markdown | 可参考 |
| 隔离 | 账号组 | banks | 概念对应 |

### 值得跟进

1. **observations 的证据计数与「强化/削弱」**（最贴合 L5）：
   我们的 L5 节点只有 `src` 列表，没有「这条信念被几条来源支持」「新证据是加强还是削弱」。
   加一个 `support` 计数和 `refined` 历史，L5 就从「合并后的节点」变成「可演化的信念」。
2. **mental models 式的 L3.1**：现在 L3.1 的四块（我是谁 / 在手的事 / 等着的事 / 近期变化）
   是人工写的。Hindsight 的做法是**把问题定义一次，系统维护答案**。对应到我们：
   把四块变成四个「常驻问题」，由 L5 图自动生成并重写，人工只审。
3. **decision model 式的判断层**：P1-1 的「重复/矛盾分开判」现在是 LLM 文本判断。
   Hindsight 用小模型输出**类型化答案**（是/否/哪个），成本低、可复现。可以先用规则 + 小模型，
   把大模型留给真正需要生成的地方。
4. **reflect 作为独立操作**：不是检索，是「对已有记忆做深度分析、形成新连接」。
   这可以成为记忆页的一个新入口（「让系统想想这件事」），也可以喂给 L5 的补边。
5. **knowledge pages 投影成 markdown**：我们的 L3 分册本来就是 markdown，
   可以借鉴「活文档 + 投影到磁盘」的形态，让分册可再生成（对应 P2-2）。

### 不跟进

- PostgreSQL + pgvector / Oracle 存储栈——同上；
- 云端、租户、计费、Memory Defense——本地单用户用不上；
- biomimetic 四分类整体照搬——我们是事件图，不是「世界事实 vs 自身经历」的二分。

---

## 十二、目的校准：三类记忆与三处适配（2026-11-05）

### 三类记忆

| 类别 | 消费者 | 典型问题 | 代表 |
|---|---|---|---|
| **Agent 运行时记忆** | 模型，每轮对话 | 「这个用户喜欢什么」「上次说到哪」 | Graphiti / mem0 / cognee / MemOS / Hindsight |
| **语料库问答** | 模型，一次性 | 「这批文档的主题是什么」 | GraphRAG |
| **个人聊天记忆** | 人 + 接手的模型 | 「我当时为什么这么定」「这半年在干什么」 | **CEOBE** |

六个参考项目没有一个是第三类。CEOBE 的最终目的不是「让我自己回顾」，是
**「让下一个模型快速理解我」**——所以消费者有两个：人（读 L2/L3）和模型（读 L4/L5 并需要能查）。

### 三处必须改

1. **社区聚类的对象**：按**事件**聚，不按实体聚。报告模板从「关于 X 我们知道什么」
   改成「这段时间发生了什么、怎么变的」。
2. **检索的查询类型**：叙事型（「为什么放弃那个方案」），不是事实型（「用户偏好」）。
   需要时间 + 因果 + 推翻关系，不只是关键词。
3. **常驻答案的内容**：写成「传记」（这个人是谁、在做什么、卡在哪），不是「偏好清单」。

### 路线调整

1. **P1-4 精修层**（cognee）——L4→L5 的衔接，模型读到的图得是干净的；
2. **P1-2 社区报告 + L3.1 常驻答案**（GraphRAG + Hindsight）——合成 `memory-profile.md`，
   这是模型接手的第一入口；
3. **P1-3 检索**（mem0 + Hindsight）——BM25 + 实体 + 时间，模型查得动；
4. **P2-3 导出 / MCP**（MemOS）——bundle + 工具面，模型拿得到；
5. **L5 信念化**（Hindsight）——`support` 计数，模型知道哪条更可信。

**「模型交接层」不是新增的第 7 项，是第 2–4 项的共同目标。** 做完这三项，模型接手时就有：
一页纸（profile）、一个索引（index）、一个查询入口（MCP）。

### 事件图 vs 实体图

六个项目是**实体图**（节点是人/组织/概念，边是关系），CEOBE 是**事件图**
（节点是判断/事件，边是因果/推翻）。这个差异不是实现细节，是**记忆单位**的差异：

| | 实体图 | 事件图 |
|---|---|---|
| 记忆单位 | 一个东西 | 一件发生的事 |
| 边语义 | 关系（静态） | 因果 / 推翻 / 时序（动态） |
| 时间 | 事实的有效期 | 事件的时间 + 判断的有效期 |
| 典型查询 | 「关于 X 知道什么」 | 「发生了什么、为什么变」 |
| 强项 | 实体消歧、事实聚合 | 叙事、因果、演变 |
| 弱项 | 事件是二等公民，因果难表达 | 实体消歧弱，「关于 X」要聚合 |

**对我们的目的，事件图更合适**：模型接手要理解的是「这个人怎么走到今天」，
不是「这个人的属性表」。但实体图有一个我们必须补的能力——**按实体聚合**：
「关于 TourGrid 我知道什么」需要把散在各事件里的 TourGrid 相关判断聚起来。

所以正确的形态是**事件图为主 + 实体索引为辅**：

- 事件图（L4/L5）承担叙事、因果、推翻；
- 实体索引（`entities.json` + 每个实体的关联事件列表）承担「关于 X」的聚合查询。

我们已经有 `entities.json`（243 条、tier 分层）和 L4 节点的 `e`（实体下标），
缺的是**反向索引**：从实体查到它出现在哪些事件里。这正是 P2-1（episode 反向索引）的姊妹项。
