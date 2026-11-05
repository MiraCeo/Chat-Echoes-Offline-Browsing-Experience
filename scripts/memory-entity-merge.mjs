#!/usr/bin/env node
/**
 * Entity consolidation for the kernel's `entities.json`.
 *
 * The registry was normalized once by aliases + rejected names (2026-10-31).
 * This finds what is left: exact normalized collisions, alias/canonical
 * cross-matches, and near-duplicates above a similarity threshold.
 *
 *   npm run memory:entities                 # dry run: print the merge plan
 *   npm run memory:entities -- --apply      # write the merged registry (backup first)
 *   --threshold 0.85                        # fuzzy similarity threshold
 *   --allow-cross-kind                      # allow merging different `kind`s
 *   --json                                  # machine-readable plan
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');
const registryPath = root => join(root, 'data/private/memory-kernel/source/entities.json');

const normalize = value => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[\s\p{P}\p{S}]/gu, '');

const bigrams = text => {
  const clean = normalize(text);
  const set = new Set();
  for (let index = 0; index < clean.length - 1; index += 1) set.add(clean.slice(index, index + 2));
  return set;
};
const similarity = (a, b) => {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
};

const tierRank = tier => (tier === 1 ? 3 : tier === 2 ? 2 : 1);
const pickCanonical = group => [...group].sort((a, b) =>
  tierRank(b.tier) - tierRank(a.tier)
  || (b.mentions || 0) - (a.mentions || 0)
  || String(a.canonical).length - String(b.canonical).length
  || String(a.canonical).localeCompare(String(b.canonical)))[0];

const mergeGroup = group => {
  const canonical = pickCanonical(group);
  const aliases = new Set(canonical.aliases || []);
  let sessions = 0;
  let mentions = 0;
  let firstSeen = null;
  let thread = canonical.thread || null;
  for (const entity of group) {
    if (entity !== canonical) aliases.add(entity.canonical);
    for (const alias of entity.aliases || []) aliases.add(alias);
    sessions += Number(entity.sessions) || 0;
    mentions += Number(entity.mentions) || 0;
    if (entity.first_seen && (!firstSeen || entity.first_seen < firstSeen)) firstSeen = entity.first_seen;
    if (!thread && entity.thread) thread = entity.thread;
  }
  aliases.delete(canonical.canonical);
  return {
    canonical: canonical.canonical,
    aliases: [...aliases].sort(),
    kind: canonical.kind,
    thread,
    sessions,
    mentions,
    first_seen: firstSeen,
    tier: canonical.tier,
    merged_from: group.filter(entity => entity !== canonical).map(entity => entity.canonical),
  };
};

export function planMerges(registry, { threshold = 0.85, allowCrossKind = false } = {}) {
  const entities = Array.isArray(registry.entities) ? registry.entities : [];
  const rejected = new Set((registry.rejected || []).map(normalize));
  const groups = [];
  const assigned = new Set();

  // 1. Exact normalized collisions across canonical names and aliases.
  const byName = new Map();
  for (const entity of entities) {
    for (const name of [entity.canonical, ...(entity.aliases || [])]) {
      const key = normalize(name);
      if (!key || rejected.has(key)) continue;
      if (!byName.has(key)) byName.set(key, new Set());
      byName.get(key).add(entity);
    }
  }
  for (const [key, members] of byName) {
    if (members.size < 2) continue;
    const group = [...members];
    if (!allowCrossKind && new Set(group.map(entity => entity.kind)).size > 1) continue;
    groups.push({ reason: `同名/别名冲突：${key}`, confidence: 'high', entities: group });
    for (const entity of group) assigned.add(entity.canonical);
  }

  // 2. Near-duplicates above the similarity threshold.
  const remaining = entities.filter(entity => !assigned.has(entity.canonical));
  for (let i = 0; i < remaining.length; i += 1) {
    for (let j = i + 1; j < remaining.length; j += 1) {
      const a = remaining[i];
      const b = remaining[j];
      if (assigned.has(a.canonical) || assigned.has(b.canonical)) continue;
      if (!allowCrossKind && a.kind !== b.kind) continue;
      const score = similarity(a.canonical, b.canonical);
      if (score < threshold) continue;
      groups.push({ reason: `近似（${score.toFixed(2)}）`, confidence: 'medium', entities: [a, b] });
      assigned.add(a.canonical);
      assigned.add(b.canonical);
    }
  }

  const merged = groups.map(group => ({ ...mergeGroup(group.entities), reason: group.reason, confidence: group.confidence }));
  const mergedNames = new Set(merged.flatMap(item => [item.canonical, ...item.merged_from]));
  const kept = entities.filter(entity => !mergedNames.has(entity.canonical));
  return {
    schema: 'ceobe.entity-merge-plan/1',
    threshold,
    allow_cross_kind: allowCrossKind,
    before: entities.length,
    after: kept.length + merged.length,
    groups: merged,
    kept,
  };
}

export function applyPlan(registry, plan) {
  const entities = [...plan.kept, ...plan.groups.map(group => ({
    canonical: group.canonical,
    aliases: group.aliases,
    kind: group.kind,
    thread: group.thread,
    sessions: group.sessions,
    mentions: group.mentions,
    first_seen: group.first_seen,
    tier: group.tier,
  }))];
  entities.sort((a, b) => tierRank(b.tier) - tierRank(a.tier)
    || (b.mentions || 0) - (a.mentions || 0)
    || String(a.canonical).localeCompare(String(b.canonical)));
  return {
    ...registry,
    generated_at: new Date().toISOString(),
    entities,
    applied: {
      at: new Date().toISOString(),
      scope: 'entities.json',
      before: plan.before,
      after: plan.after,
      groups: plan.groups.length,
      note: '实体合并：同名/别名冲突 + 近似候选；L4 的 ents 未改动，只收敛注册表。',
    },
  };
}

/** Collect the distinct `ents` strings used by a set of L4 trees, with provenance. */
export async function collectL4Entities(root, eventsDir) {
  const sourceRoot = join(root, 'data/private/memory-kernel/source');
  const dir = join(sourceRoot, eventsDir);
  const counts = new Map();
  let files = [];
  try { files = (await readdir(dir)).filter(name => name.endsWith('.json')); }
  catch { return counts; }
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    let doc;
    try { doc = JSON.parse(await readFile(join(dir, file), 'utf8')); } catch { continue; }
    let firstSeen = null;
    for (const l2 of [join(sourceRoot, 'memory', `${id}.md`), join(sourceRoot, 'inbox/memory', `${id}.md`)]) {
      try {
        const match = (await readFile(l2, 'utf8')).match(/^first:\s*(.+)$/m);
        if (match) { firstSeen = match[1].trim().slice(0, 10); break; }
      } catch { /* try the next location */ }
    }
    for (const name of doc.ents || []) {
      if (!counts.has(name)) counts.set(name, { count: 0, sessions: new Set(), first_seen: null });
      const entry = counts.get(name);
      entry.count += 1;
      entry.sessions.add(id);
      if (firstSeen && (!entry.first_seen || firstSeen < entry.first_seen)) entry.first_seen = firstSeen;
    }
  }
  return counts;
}

/**
 * Compare L4 entity strings against the registry: propose a mapping to an
 * existing canonical when one is close enough, otherwise propose registering
 * the name as a new entity with tier derived from how many sessions use it.
 */
export function proposeEntityMappings(registry, counts, { threshold = 0.85 } = {}) {
  const known = new Map();
  for (const entity of registry.entities || []) {
    known.set(entity.canonical, entity);
    for (const alias of entity.aliases || []) known.set(alias, entity);
  }
  const map = [];
  const register = [];
  for (const [name, entry] of counts) {
    if (known.has(name)) continue;
    let best = null;
    for (const [candidate, entity] of known) {
      const score = similarity(name, candidate);
      if (!best || score > best.score) best = { candidate, entity, score };
    }
    // Containment catches "系统策划（实习）" → "系统策划" without merging
    // version variants like "Qwen3.5-27B" / "Qwen3.8-27B". Purely numeric
    // names ("0.6") are never mapped by containment — they match by accident.
    const left = normalize(name);
    const right = best ? normalize(best.candidate) : '';
    const hasCjk = value => /[\u4e00-\u9fff]/.test(value);
    const minLength = hasCjk(left) || hasCjk(right) ? 2 : 3;
    const contained = Boolean(best)
      && !/^[\d.]+$/.test(left)
      && Math.min(left.length, right.length) >= minLength
      && (left.includes(right) || right.includes(left));
    if (best && (best.score >= threshold || contained)) {
      map.push({ name, count: entry.count, canonical: best.entity.canonical, score: Number(best.score.toFixed(2)), via: contained ? 'containment' : 'similarity' });
    } else {
      const sessions = entry.sessions.size;
      register.push({
        name,
        count: entry.count,
        sessions,
        first_seen: entry.first_seen,
        tier: sessions >= 3 ? 1 : sessions === 2 ? 2 : 3,
        best_candidate: best && best.score > 0 ? best.entity.canonical : null,
        best_score: best ? Number(best.score.toFixed(2)) : 0,
      });
    }
  }
  return { map, register };
}

/** Build the registry entries for the names that need registering. */
export function buildRegistrations(register, { kind = 'other' } = {}) {
  return register.map(item => ({
    canonical: item.name,
    aliases: [],
    kind,
    thread: null,
    sessions: item.sessions,
    mentions: item.count,
    first_seen: item.first_seen,
    tier: item.tier,
  }));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const option = name => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const has = name => process.argv.includes(name);
  const root = resolve(option('--root') || projectRoot);
  const path = registryPath(root);
  if (!existsSync(path)) {
    console.error(`找不到实体表：${path}`);
    process.exit(1);
  }
  const registry = JSON.parse(await readFile(path, 'utf8'));
  const threshold = Number(option('--threshold') || 0.85);
  const plan = planMerges(registry, {
    threshold,
    allowCrossKind: has('--allow-cross-kind'),
  });

  const eventsDir = option('--events');
  const l4 = eventsDir
    ? proposeEntityMappings(registry, await collectL4Entities(root, eventsDir), { threshold })
    : null;

  if (has('--json')) {
    console.log(JSON.stringify({ plan, l4 }, null, 2));
  } else {
    console.log(`实体合并计划（${has('--apply') ? 'apply' : 'dry-run'}）`);
    console.log(`  注册表 ${plan.before} → ${plan.after} 条，${plan.groups.length} 组`);
    for (const group of plan.groups) {
      console.log(`  [${group.confidence}] ${group.canonical} ← ${group.merged_from.join('、')}（${group.reason}）`);
    }
    if (!plan.groups.length) console.log('  注册表内没有可合并的实体。');
    if (l4) {
      console.log('');
      console.log(`L4 实体对齐（${eventsDir}）`);
      console.log(`  可映射到已有实体：${l4.map.length} 条`);
      for (const item of l4.map.slice(0, 20)) console.log(`    ${item.name} → ${item.canonical}（${item.score}）`);
      console.log(`  需要新注册：${l4.register.length} 条`);
      for (const item of l4.register.slice(0, 20)) {
        console.log(`    ${item.name}（${item.count} 次 / ${item.sessions} 会话 / tier ${item.tier}，最近候选 ${item.best_candidate || '—'} ${item.best_score}）`);
      }
    }
  }

  if (has('--register') && l4) {
    const additions = buildRegistrations(l4.register);
    const next = {
      ...registry,
      generated_at: new Date().toISOString(),
      entities: [...registry.entities, ...additions],
      applied: {
        at: new Date().toISOString(),
        scope: `entities.json + ${eventsDir}`,
        before: registry.entities.length,
        after: registry.entities.length + additions.length,
        groups: additions.length,
        note: 'L4 实体注册：未在注册表中的实体按会话数定 tier，kind 默认 other，thread 待人工补。',
      },
    };
    const backup = path.replace(/\.json$/, `.pre-register-${Date.now()}.json`);
    await writeFile(backup, JSON.stringify(registry, null, 2) + '\n', 'utf8');
    await writeFile(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
    console.log(`\n已注册 ${additions.length} 条实体到 ${path}`);
    console.log(`备份：${backup}`);
  }

  if (has('--apply')) {
    const backup = path.replace(/\.json$/, `.pre-merge-${Date.now()}.json`);
    await writeFile(backup, JSON.stringify(registry, null, 2) + '\n', 'utf8');
    await writeFile(path, JSON.stringify(applyPlan(registry, plan), null, 2) + '\n', 'utf8');
    console.log(`\n已写入 ${path}`);
    console.log(`备份：${backup}`);
  }
}
