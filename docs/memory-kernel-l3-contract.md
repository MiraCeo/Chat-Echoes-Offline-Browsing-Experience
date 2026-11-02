# L3 / L3.1 分类与快照契约（草案 v0.3）

> 目标读者：负责记忆内核的模型。  
> 本文只定义维度、输出字段和验收案例，不重跑 L2/L4，不恢复原文，不改 CEOBE 前端。  
> 起草：2026-10-31。当前状态：待内核模型评审。  
> **工作流变更（2026-10-31）：本契约是 L3/L3.1 的临时桥接，不是最终接入合同；内核完成完整 L1–L5 后统一接入 CEOBE，不再逐层拆分交付。**
>
> **2026-11-02 更新：内核已交付完整 L1–L5；实际数据契约以 `D:\ai-memory-handover\overlay\CONTRACT.md` 和 `overlay/*.v2.json` 为准。本文件保留为接入背景，不再作为验收源。**

## 0. 一句话目标

把现在的“账号组 + 主题词 + 快照”混合分类，拆成：

```text
scope（来源范围）
project（项目实体）
thread（叙事线）
theme（跨线主题）
as_of / supersedes（时间与版本）
```

**group 不等于 thread，project 不等于 case，theme 不等于 thread，snapshot 不等于 current。**

## 0.1 接口方已确认（v0.2）

内核回复中的四项，接口方按以下方式落契约：

1. **`in_scope` 采用**：thread 实体唯一，gq/g1 两份 L3 都带完整时间轴，每个节点标 `in_scope: true|false`；UI 按 thread id 去重，不渲染成两条线。
2. **主线数量不设上限**：`mainline_threads` 是数组；gq 交 5 条就显示 5 条，不硬编码 4 条。
3. **无分组按降级视图处理**：只有 L1/L2/L4，没有 L3/L3.1；记忆页显示“未分组”汇总 + 逐会话入口，不生成空 bank。
4. **conflict 的语义责任在内核**：`unresolved` 不得静默消失，必须带 `owner/status`；接口只展示和校验，不自动判定、不自动关闭。
5. **10-22「起点＋改造」没有独立来源**：不在时间轴新增该节点；改为“截至 10/22 快照边界仍未定稿”。不伪造证据指针。
6. **`same_event_two_observers` 采用**：14:19 / 14:18 是两个账号对同一事件的观察，不判数据错误、不静默选一个。
7. **`delta_from_previous` 采用**：L3.1 必须能输出跨快照变化；UI 优先显示“上一版 → 本版”的变更，而不是两张几乎相同的卡。
8. **继承证据采用**：L3.1 条目允许 `evidence_mode: inherited`，通过 `thread_ref` 回退；不要求每条都点到轮次。
9. **单源量化标注**：TourGrid 的 9.9% / 57–61 标 `confidence: single_source`，不当作已复核事实。
10. **数量动态读取**：当前 archive 为 31 个会话（gq 10、g1 6、未分组 15）；旧内核包 36 会话 / 21 未分组是旧口径。接口按当前 `group_id` 动态读取，不写死 21 或 15。
11. **g1 新口径**：g1 现有 6 个会话，`as_of` 为 2026-10-26；新增 `6ae4e806` 覆盖 10/22–10/26，UI 不得写死 10/22。
12. **sys-plan 跨组**：系统策划线 `scope_refs` 为 `["gq","g1"]`，gq/g1 各有 5 条 mainline；UI 按数组显示，不加固定上限。
13. **staging 路径**：新增会话的 L2 可以放在 `inbox/`，由 `archive-map` 显式给出路径并标 `staging: true`；接口不得假设 `memory/` 一定存在。
14. `conflict-ask-referrer` 属于 `within_thread_revision`，不是 `same_event_two_observers`；`preferred` 只表示实际发生的动作，不表示“问对了”。

## 1. 当前已确认的问题

1. gq / g1 是账号组和阶段，不是完整叙事线；当前 L3 容易把“这一组”误当成“这段历史”。
2. TourGrid 横跨 gq、g1，却被拆成两边各一个作品集案例；它应该是一条跨组 thread，并有独立 project 实体。
3. 设计心理学分散在多个会话、多个 thread 中；它不应被强行补成一条主线，而应作为 theme。
4. gq 与 g1 的截止日期不同（gq 10/13、g1 10/26），并排展示时会被误读成互相矛盾；需要 `as_of` 和 `snapshot` 标记。
5. 同一项目存在标题/别名不一致（如 `以撒的竞合`、`《以撒的竞合》`、`以撒的竞合 0.3.0`），不能靠标题做合并键。
6. 局部判断被写成长期结论，例如 g1 的“朋友关系变化”、gq 的“三项目补短板”。

## 2. 分类维度

### 2.1 scope

来源边界，不是叙事。

```json
{
  "kind": "group | global",
  "id": "gq | g1 | global",
  "label": "国庆组 / 01–05 序列 / 全局"
}
```

- gq / g1 可以各自产出 scope 内的 L3；
- 跨组内容不应被切成两份；scope 只说明“这份视图覆盖哪里”。

### 2.1.1 ungrouped（无分组会话）

无分组不是第三种账号组，不能生成 L3.1 bank。

```json
{
  "ungrouped": {
    "session_ids": [],
    "available_layers": ["l1", "l2", "l4"],
    "absent_layers": ["l3", "l3.1"]
  }
}
```

接口约定：

- 无分组会话保留 L1/L2/L4，不生成 thread、不生成 bank；
- 记忆页显示“未分组”汇总和逐会话列表，不显示空白记忆卡；
- 任何“每个会话都必须有 group”的 UI 假设都视为错误；
- 数量必须从当前导出动态读取，不能硬编码 21 或 15。

CEOBE 的 `memory:export` 现在会输出：

```json
{ "group_id": "gq | g1 | null" }
```

旧内核包里的 36 会话 / 21 未分组是旧口径；新导出以实际 `group_id` 为准。

### 2.2 project

稳定的项目/作品实体，不是叙事阶段，也不是一个案例。

```json
{
  "id": "tourgrid",
  "label": "TourGrid",
  "aliases": ["tourgrid", "Tour Grid"],
  "status": "active | paused | archived",
  "phases": [
    { "from": "2026-09-29", "to": "2026-10-22", "label": "作品集主线" }
  ]
}
```

要求：

- 一个项目只有一个稳定 `id`；
- 标题、书名号、版本号只作为 alias，不能生成多个 project；
- 项目可在多个 scope 中被引用。

### 2.3 thread

有时间轴、有判断演变的叙事线。可以跨组、跨项目；也可是组内线。

```json
{
  "id": "tourgrid",
  "label": "TourGrid：从作品到方法论",
  "kind": "cross_group | group",
  "mainline": true,
  "scope_refs": ["gq", "g1"],
  "project_refs": ["tourgrid"],
  "status": "active | paused | closed",
  "as_of": "2026-10-26",
  "timeline": [
    {
      "at": "2026-09-29",
      "event": "评分 7–8/6/8，纳入作品集",
      "in_scope": true,
      "evidence": [{ "session_id": "uuid", "rounds": [1, 8] }]
    }
  ],
  "current_state": "作品集主线，等待授权与进一步量化",
  "open": ["授权未回", "起点＋改造的表述尚未定稿"],
  "judgement_changes": [
    {
      "from": "作品集案例",
      "to": "独立项目主线",
      "at": "2026-10-12",
      "evidence": [{ "session_id": "uuid", "rounds": [1, 5] }]
    }
  ]
}
```

要求：

- `mainline: true` 表示应出现在 L3 主线清单中；
- 一条线只出现一次，不能每个 scope 各复制一份；
- **`in_scope` 已确认采用**：thread 实体唯一，两份 L3 都带完整时间轴；每个节点标 `in_scope: true | false`，表示该节点的主要证据是否属于当前 scope；
- `in_scope: false` 的节点只作为跨组上下文展示，不计入当前 scope 的 coverage，也不得被复制成另一条 thread；
- 时间轴节点必须带 session/round 证据指针，不贴大段原文。

### 2.4 theme

跨线、反复出现、但不具备单一路径的主题。设计心理学属于这一类。

```json
{
  "id": "design-psychology",
  "label": "设计心理学 / 心理模拟",
  "kind": "cross_cutting_theme",
  "thread_refs": ["tourgrid", "self-and-work"],
  "scope_refs": ["gq", "g1"],
  "evidence": [
    { "session_id": "uuid", "rounds": [24, 25], "note": "设计心理学与交互分工" },
    { "session_id": "uuid", "rounds": [23, 24], "note": "共情→社会认知→设计心理学→HCI" }
  ],
  "boundary": "心理分析用于设计判断，不被写成简历能力项"
}
```

要求：

- theme **不参与主线数量**；
- theme 不强行给出“起点—转折—当前状态”的单线叙事；
- 允许一个 theme 的证据来自多条 thread，但必须显式列 `thread_refs`；
- theme 可以没有当前状态，但不能伪造一个。

### 2.5 snapshot / as_of

每份 L3、L3.1 都是有截止日的快照。

```json
{
  "as_of": "2026-10-13",
  "snapshot": true,
  "supersedes": ["l3:gq@2026-10-09"],
  "freshness_note": "本卡截至 2026-10-13；后续变化见 g1 或新版本"
}
```

要求：

- 所有“当前状态”必须带 `as_of`；
- 同一事实在 gq/g1 时间不同，不算冲突，标为时间差；
- 只有明确覆盖关系时才写 `supersedes`；
- 不允许把后一快照的结论写进前一快照。

### 2.5.1 delta_from_previous

L3.1 必须能说明“相比上一份同组快照，哪几条变了”，否则 UI 只能并排两张几乎一样的卡。

```json
{
  "delta_from_previous": {
    "previous_bank": "gq@v9",
    "previous_as_of": "2026-10-09",
    "changes": [
      {
        "block": "doing",
        "item_key": "tourgrid",
        "from": "作品集案例",
        "to": "独立项目主线",
        "thread_ref": "tourgrid",
        "reason": "10-12 升到第一顺位"
      }
    ]
  }
}
```

要求：

- `delta_from_previous` 只列状态变化，不重复整段文本；
- 没有上一份快照时为 `null`；
- 变化必须能回指 thread/project/theme 或证据；
- 跨快照的“变化”不要塞进 `blocks.changes`；`changes` 是组内历史，`delta_from_previous` 是版本差异。

### 2.6 conflict

显式记录跨组/跨快照冲突，不静默合并。

```json
{
  "id": "conflict-yj-submit-time",
  "type": "same_event_two_observers",
  "topic": "鹰角提交时间",
  "left": { "scope": "gq", "value": "14:19", "evidence": [] },
  "right": { "scope": "g1", "value": "14:18", "evidence": [] },
  "resolution": "time-bound | preferred | unresolved",
  "status": "open | resolved | accepted_ambiguity",
  "owner": "kernel | interface | user",
  "preferred": null,
  "note": "同一事件的两个账号观察，不判为数据错误，不静默合并"
}
```

`same_event_two_observers` 是正式类型：两个账号在同一天记录同一事件时，保留两个观察，不给单边 preferred，除非有第三方证据。

### 2.6.1 preferred 的语义

`preferred` **不是“哪一方更可信/更正确”**，而是“当前以哪一方的记录作为事实版本展示”。取值只能是：

```text
"left" | "right" | null
```

不能用 scope id；`conflict-ask-referrer` 这种同一会话内的改口，必须同时有 `preferred_reason` 和 `outcome`：

```json
{
  "preferred": "right",
  "preferred_reason": "同一会话第 2 轮当场改口，随后实际发送",
  "outcome": "no_information",
  "status": "resolved"
}
```

`outcome` 词表固定为：

```text
updated | no_information | worse | unknown
```

含义：

- `updated`：动作发生，且获得了可用的新事实/状态；
- `no_information`：动作发生，但没有获得有效信息；
- `worse`：动作发生，结果反而变差；
- `unknown`：动作发生，结果未知/未回。

`resolution: "preferred"` 只说明事实版本，不说明动作有收益；结论价值由 `outcome` 承担。

- 如果只是两个 observer 对同一外部事件的记录不同，用 `same_event_two_observers`，不要选 preferred；
- 如果是同一 observer 在同一会话内 4 分钟内改口，用 `within_thread_revision`，并写入 `judgement_changes`；
- 如果冲突问的是“哪种做法更好”，不应使用 `preferred`，应标 `unresolved`。

`conflict-ask-referrer` 属于 `within_thread_revision`，不是跨账号 observer 冲突；`preferred: "right"` 只表示“右侧是当前事实版本”，`outcome: "no_information"` 表示“问了，但没得到有效信息”。

### 2.6.2 same_event_two_observers 与 within_thread_revision

```text
same_event_two_observers
  gq 14:19 / g1 14:18 对同一提交事件的两种观察
  → 保留两个观察，不选边

within_thread_revision
  同一账号、同一会话、短时间内先建议等待、后改口去问
  → 记录 judgement_changes，preferred 只表示实际发生的动作
```

## 3. L3 输出格式

```json
{
  "schema": "ceobe.memory-l3/2",
  "scope": { "kind": "group", "id": "gq", "label": "国庆组" },
  "as_of": "2026-10-13",
  "coverage": { "sessions": 10, "rounds": 751, "session_ids": [] },
  "projects": [],
  "threads": [],
  "themes": [],
  "conflicts": [],
  "coverage_gaps": [
    { "from": "2026-07-21", "to": "2026-08-09", "note": "早期 TourGrid / 设计心理学原文缺失" }
  ],
  "sources": []
}
```

最低要求：

- 每个 `threads[]`、`themes[]`、`projects[]` 有稳定 id；
- 每个 mainline thread 有时间轴、当前状态、未决清单、证据指针；
- 不把 theme 写进 `threads[]`；
- 不把 group 当作 thread；
- `coverage_gaps` 必须显式列出，不能用摘要填补。

## 4. L3.1 输出格式

```json
{
  "schema": "ceobe.memory-bank/2",
  "group": "gq",
  "as_of": "2026-10-13",
  "based_on": "l3:gq@2026-10-13",
  "coverage": { "sessions": 10, "rounds": 751 },
  "mainline_threads": ["tourgrid", "yj-intern", "isaac", "kjj", "sys-plan"],
  "theme_index": ["design-psychology"],
  "delta_from_previous": null,
  "blocks": {
    "who": [],
    "doing": [],
    "waiting": [],
    "changes": []
  },
  "flags": [
    { "kind": "snapshot", "text": "本卡截至 2026-10-13，不代表 10-22 后状态" }
  ]
}
```

每个 block item 建议增加：

```json
{
  "key": "TourGrid",
  "text": "...",
  "thread_ref": "tourgrid",
  "theme_refs": ["design-psychology"],
  "status": "current | historical | unresolved",
  "evidence": [{ "session_id": "uuid", "rounds": [1, 5] }],
  "evidence_mode": "direct | inherited | none",
  "evidence_precision": "round | coarse | none",
  "confidence": "single_source | multi_source | unknown"
}
```

硬约束：

- L3.1 不得引入 L3 中不存在的新事实；
- `changes` 块只放已发生的变化，未决/推测放 `waiting` 或 `unresolved`；
- 每条尽量能回指 thread/project/theme；不能回指的标 `misc`，不伪装成主线；
- 每个 bank 必须带 `as_of` 和 `snapshot` 标记；
- `mainline_threads` 是数组，**不设固定条数**；5 条合法，UI 必须渲染全部，不能硬编码 4；
- 没有逐条 evidence 的 L3.1 条目允许 `evidence_mode: inherited`，通过 `thread_ref` 继承；接口必须实现这条回退，不能要求每条都点到轮次；
- 单次自分析、无第三方复核的量化结论标 `confidence: single_source`，UI 显示来源提示，不当成权威数据。

## 5. 必须通过的验收案例

### A. TourGrid 跨组

```text
projects 中只有 1 个 tourgrid
threads 中只有 1 条 tourgrid，scope_refs 含 gq、g1
gq/g1 的 L3 都引用同一 id
不得在两边各生成一个“作品集案例”
```

时间轴至少覆盖：

```text
9/29 评分 → 10/3 17 页 → 10/6 系统册第三
→ 10/9 与可简吧并列 → 10/12 升第一
→ 10/15 9.9% 重合 / 57–61 同名
→ 授权未回
→ 截至 10/22 快照边界仍未定稿
```

10-22 没有独立证据指针，不新增“起点＋改造”节点；该表述只作为快照边界说明。

### B. 设计心理学是 theme

```text
themes 中存在 design-psychology
threads 中不存在名为“设计心理学”的 mainline
它至少挂到 TourGrid 和“自我与作品”两条 thread
证据至少覆盖 gq、g1 各一处
不生成“设计心理学主线”
```

### C. 快照时间

```text
gq as_of = 10/13，g1 as_of = 10/26 时：
- 以撒 0.3.0 与 0.8.2 共存，不判矛盾
- 终末地“0.3 期间不动”与“后续压上去”共存，标为不同快照
```

### D. 项目别名

```text
以撒的竞合
《以撒的竞合》
以撒的竞合 0.3.0
```

必须归并为同一 project id，不得按标题生成多个项目。

### E. 过强结论

```text
g1“朋友关系已改变” → 标为 unresolved
gq“三项目补短板” → 移出“我是谁”，标为阶段任务或 historical
```

### F. 无分组降级

```text
未分组会话只出现在 L1/L2/L4
不生成 L3/L3.1
记忆页显示汇总与逐会话入口，不显示空 bank
数量从当前导出读取，等于实际 session_ids.length
```

### G. in_scope

```text
同一跨组 thread 在 gq/g1 两份 L3 中 id 相同
时间轴完整，每个节点带 in_scope
gq 中 g1 侧节点 in_scope=false，但仍展示为上下文
UI 按 thread id 合并，不能显示成两条线
coverage 只统计 in_scope=true 的节点
```

### H. delta_from_previous

```text
每个 L3.1 都带 delta_from_previous
有上一版时列出变更项；无上一版为 null
跨快照变化不塞进 blocks.changes
```

### I. unresolved ownership

```text
每条 unresolved conflict 带 owner/status
接口不自动关闭
kernel 只能在带新证据的新版本里改为 resolved 或 accepted_ambiguity
```

## 6. 最小迁移方式

不要重跑全部 L2/L4。先产出 gq / g1 的 **L3/L3.1 覆盖层**：

1. 保留现有 Markdown 作为来源；
2. 新增 `projects` / `threads` / `themes` / `conflicts`;
3. L3.1 只改元数据和 block 归属，不重写全部文本；
4. 旧产物保留，`supersedes` 指向旧版本；
5. 先交 gq / g1 两份覆盖层，评审通过后再考虑全局 L3。

## 7. 非目标

- 不恢复原始聊天；
- 不重跑 L2/L4；
- 不合并 gq 和 g1；
- 不把摘要补成原文；
- 不先改 CEOBE UI；
- 不因“主line 数量”强行制造主线。

## 8. 仍需内核模型确认

1. 跨组 thread 是否统一放 global，group L3 只引用同一 id？接口按“全局唯一 id + 组内 in_scope”实现，请确认。
2. `theme` 是否允许挂 project，还是只挂 thread？接口建议同时支持，但以 thread 为主。
3. 旧 `chain/gq/banks/v10.md`、`chain/banks/v5.md` 是否保留为 `supersedes` 来源？
4. 当前接口侧 archive 是 31 会话（gq 10、g1 6、未分组 15），不是旧包的 36 / 21。请按新的 `memory:export` manifest（含 `group_id`）做覆盖层；旧 36 只作为历史来源，不要把新导入的 g1 会话漏掉。

## 9. 交付物

请内核模型先交付：

```text
1. 本契约的确认/修改意见
2. gq、g1 各一份 L3 v2 JSON（或等价结构化文件）
3. gq、g1 各一份 L3.1 v2 JSON
4. 一份契约校验结果（A–I 九个案例逐条 PASS/FAIL）
5. 没有重跑 L2/L4 的说明
```

---

**给内核模型的一句话：**  
先修分类和快照，不要重跑全量；TourGrid 是一条跨组 thread，设计心理学是 theme，不是第五条主线。

## 10. 覆盖层 v2 接口校验（2026-10-31）

实际读取 `D:\ai-memory\overlay` 后的接口侧结果。

### 10.1 通过

```text
archive-map：31 会话，136 条 L1/L2/L4 路径全部存在
分组计数：gq 10 / g1 6 / ungrouped 15，与当前 archive 一致
TourGrid：两版各 9 节点；gq in_scope 6/3，g1 3/6
theme：design-psychology 在两版均为 theme，无同名主线
mainline：gq 5 条、g1 5 条，与 threads[].mainline:true 一致
evidence：L3.1 共 46 条，全部落在对应 L3 覆盖会话内；rounds 结构合法
ungrouped：15 条与 gq/g1 不重叠，L1/L2/L4 路径存在
新会话：6ae4e806 的 staging L2 实际存在（inbox/memory，约 23 KB）
```

### 10.2 不能算 PASS 的语义问题

1. `conflict-yj-submit-time` 是 `same_event_two_observers`，但带 `preferred: "gq"`；契约要求两个观察都保留，`preferred` 必须为 `null`。
2. `conflict-ask-referrer` 用了 `kind: "same_session_revision"`，但契约名是 `within_thread_revision`；`preferred: "g1"` 不是版本/动作，无法被 UI 消费。应改为 `preferred: "right"` 或 `"asked_once"`，并补 `preferred_reason` / `outcome`。
3. `conflict-kjj-level` 与 `conflict-yj-seal` 的两侧 scope 都是 `gq`，`preferred: "gq"` 无法区分“较晚的哪一侧”；需要 `left|right` 或实际值。
4. `delta_from_previous` 实际结构是 `previous/added/changed/removed/note`，契约要求 `previous_bank/previous_as_of/changes[]`；`acceptance.json` 的 H 只验证了“有 delta”，没有验证结构。
5. thread 用 `nodes`，契约示例用 `timeline`；冲突用 `kind`，契约示例用 `type`；`status` 用 `closed/open`，契约用 `resolved/accepted_ambiguity`；`owner: memory-kernel`，契约用 `kernel`。这些可由接口适配层归一，但必须固定一套。
6. `DELIVERY.md` 说 6ae4e806 没有 L2，实际 `archive-map` 已指向 `inbox/memory/...`，文件存在；`REVIEW.md` 仍是 10/22/4 threads 旧版。文档需标废或修正。

### 10.3 接口侧的兼容决定

- 字段别名由接口适配层处理：`nodes → timeline`、`kind → type`、`closed → resolved`、`owner: memory-kernel → kernel`；
- `preferred` 与 `delta_from_previous` **不在适配层猜**，由内核修正；
- `evidence_mode` / `evidence_precision` / `confidence` 缺失时，接口先按 `direct` / `round` / `unknown` 兜底，等 v3 补齐；
- L1 为 6ae4e806 必补；L4 暂不补。

因此 A–J 不是 10/10：路径、计数、in_scope、mainline、evidence 范围通过；G（preferred 语义）和 H（delta 结构）不通过，需内核修正后再进 UI。
