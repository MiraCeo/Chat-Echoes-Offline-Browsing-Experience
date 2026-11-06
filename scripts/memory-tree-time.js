/**
 * L5 event-tree time model.
 *
 * Shared by the import adapter (Node) and the memory page (browser) so the
 * window derivation and the point-in-time filter can never disagree.
 *
 * Node validity: `[ts, invalid_at)` — `invalid_at` is the `ts` of the node that
 * supersedes it, i.e. the target of its outgoing `superseded` edge.
 * Edge validity: `[from.ts, invalid_at)` — `invalid_at` is `to.ts` for
 * `superseded` edges (the source fact stopped being true when the target was
 * decided) and `null` for the other relation types.
 *
 * Days are compared as local calendar days (`YYYY-MM-DD`), the same calendar
 * the page displays, so a query never drifts by the UTC+8 offset.
 */

export const SUPERSEDED = 'superseded';

const pad = value => String(value).padStart(2, '0');

/** Local calendar day of an epoch-seconds timestamp, as `YYYY-MM-DD`. */
export function dayOf(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parse a `YYYY-MM-DD` query value; returns the normalized string or null. */
export function parseAsOf(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return text;
}

/**
 * Add `valid_at` / `invalid_at` to nodes and a 4th/5th slot to edges.
 * Edges stay arrays so older readers that only look at `[from, to, type]`
 * keep working.
 */
const ROUND_MS = 5 * 60 * 1000;
const NODE_MS = 1000;

/**
 * Earliest source timestamp of a node. The global tree carries `ts`, but the
 * per-group trees do not, so fall back to the first source's session date plus
 * its round offset. The L4 node number breaks ties inside one round, so a
 * supersede edge between two nodes of the same round still points forward.
 */
export function sourceTime(node, times) {
  let best = null;
  for (const source of node?.src || []) {
    const first = times?.get?.(source.s);
    if (!Number.isFinite(first)) continue;
    const time = first + (source.r?.[0] || 0) * ROUND_MS + (source.n || 0) * NODE_MS;
    if (best === null || time < best) best = time;
  }
  return best;
}

export function deriveTreeWindows(tree, times = null) {
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  const edges = Array.isArray(tree?.edges) ? tree.edges : [];
  const byNumber = new Map(nodes.map(node => [node.n, node]));
  const tsOf = new Map(nodes.map(node => [node.n, Number.isFinite(node.ts) ? node.ts : sourceTime(node, times)]));
  const superseder = new Map();
  for (const edge of edges) {
    if (edge?.[2] !== SUPERSEDED) continue;
    const target = byNumber.get(edge[1]);
    if (target) superseder.set(edge[0], target);
  }
  const derivedNodes = nodes.map(node => {
    const target = superseder.get(node.n) || null;
    const ts = tsOf.get(node.n) ?? null;
    const targetTs = target ? tsOf.get(target.n) ?? null : null;
    const sources = Array.isArray(node.src) ? node.src : [];
    // Belief model: how many sources back this node, and the evidence timeline
    // (each source plus the supersede event). Derived, never hand-edited.
    const support = {
      sources: sources.length,
      sessions: new Set(sources.map(source => source.s)).size,
    };
    const refined = [
      ...sources.map(source => ({ kind: 'source', session: source.s, round: source.r?.[0] ?? null })),
      ...(target ? [{ kind: 'superseded', by: target.n, at: targetTs }] : []),
    ];
    return {
      ...node,
      valid_at: ts,
      invalid_at: target ? targetTs : null,
      superseded_by: target ? target.n : null,
      support,
      refined,
    };
  });
  const derivedEdges = edges.map(edge => {
    const [from, to, type] = edge;
    return [
      from, to, type,
      tsOf.get(from) ?? null,
      type === SUPERSEDED ? tsOf.get(to) ?? null : null,
    ];
  });
  return { nodes: derivedNodes, edges: derivedEdges };
}

/** Mechanical invariants for the derived windows. Returns human-readable issues. */
export function validateTreeWindows(tree, derived = deriveTreeWindows(tree)) {
  const issues = [];
  const byNumber = new Map(derived.nodes.map(node => [node.n, node]));
  const supersededOut = new Map();
  for (const node of derived.nodes) {
    if (node.invalid_at !== null && node.valid_at !== null && node.invalid_at < node.valid_at) {
      issues.push(`#${node.n} 的 invalid_at 早于 valid_at`);
    }
    if (node.s === SUPERSEDED && node.invalid_at === null) {
      issues.push(`#${node.n} 标为 superseded 但没有出边指向推翻它的节点`);
    }
    if (node.s !== SUPERSEDED && node.invalid_at !== null) {
      issues.push(`#${node.n} 不是 superseded 却带 invalid_at`);
    }
    if (node.superseded_by !== null) {
      const target = byNumber.get(node.superseded_by);
      if (!target) issues.push(`#${node.n} 的 superseded_by 指向不存在的节点`);
      else if (!(target.valid_at > node.valid_at)) issues.push(`#${node.n} 被更早或同时间的 #${target.n} 推翻`);
    }
    // Belief model invariants: support counts the sources, refined lists them.
    const sourceCount = Array.isArray(node.src) ? node.src.length : 0;
    if (node.support?.sources !== sourceCount) issues.push(`#${node.n} 的 support.sources 与 src 数量不一致`);
    if (node.support?.sessions > sourceCount) issues.push(`#${node.n} 的 support.sessions 大于来源数`);
    const refinedSources = (node.refined || []).filter(item => item.kind === 'source').length;
    if (refinedSources !== sourceCount) issues.push(`#${node.n} 的 refined 来源条目与 src 数量不一致`);
  }
  for (const edge of derived.edges) {
    const [from, to, type, validAt, invalidAt] = edge;
    if (!byNumber.has(from) || !byNumber.has(to)) { issues.push(`边 ${from}→${to} 端点不存在`); continue; }
    if (from === to) issues.push(`边 ${from}→${to} 是自环`);
    if (invalidAt !== null && validAt !== null && invalidAt < validAt) issues.push(`边 ${from}→${to} 的 invalid_at 早于 valid_at`);
    if (type === SUPERSEDED) {
      if (invalidAt === null) issues.push(`superseded 边 ${from}→${to} 缺少 invalid_at`);
      supersededOut.set(from, (supersededOut.get(from) || 0) + 1);
    } else if (invalidAt !== null) {
      issues.push(`边 ${from}→${to}（${type}）不应带 invalid_at`);
    }
  }
  for (const [number, count] of supersededOut) {
    if (count > 1) issues.push(`#${number} 有多条 superseded 出边`);
  }
  return issues;
}

/**
 * Point-in-time view: nodes that existed by `asOf` (inclusive of that day) and
 * edges whose both endpoints existed. `laterSuperseded` counts nodes that were
 * still standing at `asOf` and were overturned afterwards.
 */
export function filterTreeAt(tree, asOf) {
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  const edges = Array.isArray(tree?.edges) ? tree.edges : [];
  if (!asOf) return { asOf: null, nodes, edges, hidden: 0, laterSuperseded: 0 };
  const visible = new Set();
  const kept = [];
  let laterSuperseded = 0;
  for (const node of nodes) {
    const day = dayOf(node.ts);
    if (!day || day > asOf) continue;
    visible.add(node.n);
    kept.push(node);
    const invalidDay = dayOf(node.invalid_at);
    if (invalidDay && invalidDay > asOf) laterSuperseded += 1;
  }
  const keptEdges = edges.filter(edge => visible.has(edge[0]) && visible.has(edge[1]));
  return { asOf, nodes: kept, edges: keptEdges, hidden: nodes.length - kept.length, laterSuperseded };
}
