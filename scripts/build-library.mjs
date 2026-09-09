import { localizeGeneratedFonts } from './local-katex-fonts.mjs';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildImportPage } from './build-import-page.mjs';
import { buildAssetLibrary } from './build-asset-library.mjs';
import { buildReaderUI } from './build-reader-ui.mjs';
import { buildChatOrganizer } from './build-chat-organizer.mjs';
import { buildSidebarControls } from './build-sidebar-controls.mjs';
import { buildProjectDetail } from './build-project-detail.mjs';
import { buildProjectsPage } from './build-projects-page.mjs';
import { buildChatMenu } from './build-chat-menu.mjs';
import { buildChatActions } from './build-chat-actions.mjs';
import { readChatMetadata } from './chat-store.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const archiveRoot = join(projectRoot, 'archive', 'chatgpt-share');
const indexPath = join(projectRoot, 'archive', 'library.ceobe.json');

const posixRelative = path => relative(projectRoot, path).replaceAll('\\', '/');

export async function buildLibraryIndex() {
  const conversations = [];
  await mkdir(archiveRoot, { recursive: true });
  for (const share of await readdir(archiveRoot, { withFileTypes: true })) {
    if (!share.isDirectory() || !/^[\w-]+$/.test(share.name)) continue;
    const shareRoot = join(archiveRoot, share.name);
    const captures = (await readdir(shareRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse();
    for (const captureName of captures) {
      const conversationPath = join(shareRoot, captureName, 'conversation.ceobe.json');
      try {
        const conversation = JSON.parse(await readFile(conversationPath, 'utf8'));
        if (conversation.kind !== 'ceobe.conversation' || typeof conversation.title !== 'string') continue;
        const counts = conversation.import_report?.resource_counts || {};
        conversations.push({
          id: share.name,
          title: conversation.title,
          source_type: conversation.source?.type || 'chatgpt_share',
          source_url: conversation.source?.url || null,
          captured_at: conversation.source?.captured_at || captureName,
          created_at: conversation.created_at || null,
          updated_at: conversation.updated_at || null,
          message_count: conversation.linear_message_ids?.length || 0,
          resource_counts: { downloaded: counts.downloaded || 0, unresolved: counts.unresolved || 0, failed: counts.failed || 0 },
          import_status: conversation.import_report?.status || 'unknown',
          structured_payload_status: conversation.completeness?.structured_payload?.status || 'unknown',
          rendered_dom_status: conversation.completeness?.rendered_dom?.status || 'unknown',
          complete_offline_archive: conversation.import_report?.complete_offline_archive === true,
          conversation_path: posixRelative(conversationPath),
          page: `./conversations/${share.name}.html`,
        });
        break;
      } catch { /* Failed or partial captures remain archived but do not replace the latest usable capture. */ }
    }
  }
  const meta=await readChatMetadata(projectRoot);
  for(const c of conversations)Object.assign(c,meta.items[c.id]||{});
  conversations.sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
  const library = { schema_version: '1.0.0', kind: 'ceobe.library', generated_at: new Date().toISOString(), conversations };
  await writeFile(indexPath, JSON.stringify(library, null, 2));
  return library;
}

async function buildReader(library, selectedId) {

  const selected = library.conversations.find(item => item.id === selectedId) || library.conversations[0];
  const run = (entry, output, preserve) => {
    const args = ['scripts/build-official-replay.mjs', '--input', entry.conversation_path, '--output-page', output,
      '--library', posixRelative(indexPath), '--entry-id', entry.id];
    if (preserve) args.push('--preserve-output');
    const result = spawnSync(process.execPath, args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Failed to build ${entry.title}`);
    process.stdout.write(result.stdout);
  };
  if(selected)run(selected, join('replay', 'index.html'), false);
  else {
    const empty=JSON.parse(await readFile(join(projectRoot,'samples/empty-conversation.json'),'utf8'));empty.title='本地聊天';
    await mkdir(join(projectRoot,'data/private'),{recursive:true});await writeFile(join(projectRoot,'data/private/empty-reader.ceobe.json'),JSON.stringify(empty));
    run({id:'empty',title:empty.title,conversation_path:'data/private/empty-reader.ceobe.json'},join('replay','index.html'),false);
  }
  await mkdir(join(projectRoot,'replay/conversations'),{recursive:true});
  for (const entry of library.conversations) run(entry, join('replay', 'conversations', `${entry.id}.html`), true);
  await cp(indexPath, join(projectRoot, 'replay', 'library.ceobe.json'));
  await mkdir(join(projectRoot, 'replay', 'public'), { recursive: true });
  await cp(indexPath, join(projectRoot, 'replay', 'public', 'library.ceobe.json'));
  await buildImportPage(projectRoot);
  await buildAssetLibrary(projectRoot, library);
  await buildProjectsPage(projectRoot);
  await buildProjectDetail(projectRoot, library);
  await buildChatMenu(projectRoot, library);
  await buildChatActions(projectRoot, library);
  await buildChatOrganizer(projectRoot);
  await buildSidebarControls(projectRoot);
  await buildReaderUI(projectRoot, library);
  await localizeGeneratedFonts(join(projectRoot,'replay'));
  console.log(`Library reader built: ${library.conversations.length} conversations; home is “${selected?.title || "本地聊天"}”.`);
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { values } = parseArgs({ options: { 'index-only': { type: 'boolean', default: false }, select: { type: 'string' } } });
  const library = await buildLibraryIndex();
  console.log(`Library index: ${indexPath} (${library.conversations.length} conversations)`);
  if (!values['index-only']) await buildReader(library, values.select);
}
