/**
 * Verify the archive's structural integrity.
 *
 * The archive is append-only, so the thing worth checking is not "is it up to date" but "can every
 * snapshot still be read": the raw payload is there, the canonical file parses, the fields the reader
 * depends on exist, and the counts agree with each other.
 *
 * Usage: node scripts/verify-archive.mjs [--root archive] [--json]
 * Exit code is 1 when any problem is found.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const projectRoot = import.meta.dirname.replace(/[\\/]scripts$/, '');
const { values } = parseArgs({
  options: { root: { type: 'string' }, json: { type: 'boolean', default: false } },
});
const archiveRoot = resolve(projectRoot, values.root || 'archive');

const REQUIRED = ['schema_version', 'kind', 'id', 'title', 'messages', 'linear_message_ids'];
const problems = [];
const sources = [
  { dir: 'chatgpt-share', raw: 'raw/share.html', sourceType: 'chatgpt_share' },
  { dir: 'chatgpt-web', raw: 'raw-responses.json', sourceType: 'chatgpt_web' },
];

const report = { snapshots: 0, conversations: 0, messages: 0, resourcesDownloaded: 0, sources: {}, problems };

for (const source of sources) {
  const sourceRoot = join(archiveRoot, source.dir);
  let shares;
  try {
    shares = (await readdir(sourceRoot, { withFileTypes: true })).filter(entry => entry.isDirectory());
  } catch {
    report.sources[source.dir] = { shares: 0, snapshots: 0 };
    continue;
  }
  let snapshots = 0;
  for (const share of shares) {
    const shareRoot = join(sourceRoot, share.name);
    const snapshotDirs = (await readdir(shareRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();

    if (!snapshotDirs.length) problems.push(`${source.dir}/${share.name}: no snapshots`);

    for (const snapshot of snapshotDirs) {
      snapshots += 1;
      const dir = join(shareRoot, snapshot);
      const label = `${source.dir}/${share.name}/${snapshot}`;

      // Raw payload must survive: it is what makes the snapshot re-decodable.
      try {
        const raw = await stat(join(dir, source.raw));
        if (raw.size === 0) problems.push(`${label}: ${source.raw} is empty`);
      } catch {
        problems.push(`${label}: missing ${source.raw}`);
      }

      let canonical;
      try {
        canonical = JSON.parse(await readFile(join(dir, 'conversation.ceobe.json'), 'utf8'));
      } catch (error) {
        problems.push(`${label}: conversation.ceobe.json unreadable (${error.code || error.message})`);
        continue;
      }

      for (const field of REQUIRED) {
        if (canonical[field] === undefined) problems.push(`${label}: canonical field ${field} missing`);
      }
      if (canonical.kind !== 'ceobe.conversation') problems.push(`${label}: kind is ${canonical.kind}`);
      if (canonical.id !== share.name) problems.push(`${label}: id ${canonical.id} does not match folder`);
      if (canonical.source?.type && canonical.source.type !== source.sourceType) {
        problems.push(`${label}: source.type ${canonical.source.type} found under ${source.dir}`);
      }
      const messageIds = Object.keys(canonical.messages || {});
      const linear = canonical.linear_message_ids || [];
      // 节点数通常比消息多一个：客户端根节点 client-created-root 没有对应消息。
      const nodes = Object.values(canonical.nodes || {});
      const roots = nodes.filter(node => node.parent_id === null);
      if (roots.length !== 1) problems.push(`${label}: ${roots.length} root nodes`);
      for (const id of messageIds) {
        if (!canonical.nodes?.[id]) problems.push(`${label}: message ${id} has no node`);
      }
      for (const id of linear) {
        if (!canonical.messages?.[id]) problems.push(`${label}: linear id ${id} has no message`);
      }

      report.snapshots += 1;
      report.conversations += 1;
      report.messages += messageIds.length;
      report.resourcesDownloaded += Number(canonical.import_report?.resource_counts?.downloaded || 0);
    }
  }
  report.sources[source.dir] = { shares: shares.length, snapshots };
}

if (values.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const parts = Object.entries(report.sources).map(([name, item]) => `${name} ${item.shares} 个 / ${item.snapshots} 快照`);
  console.log(`档案：${parts.join('；')}`);
  console.log(`快照 ${report.snapshots} 个，消息 ${report.messages} 条，已下载资源 ${report.resourcesDownloaded} 个`);
  if (problems.length) {
    console.log(`问题 ${problems.length} 个：`);
    for (const problem of problems.slice(0, 20)) console.log('  - ' + problem);
  } else {
    console.log('结论：每个快照的原始载荷、canonical 文件与计数都一致');
  }
}

if (problems.length) process.exitCode = 1;
