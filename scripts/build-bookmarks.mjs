import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { htmlSafeSvg } from './serialize-html.mjs';
import { bookmarkTargets } from './bookmark-targets.mjs';
export async function buildBookmarks(root, library) {
  const base = join(root, 'replay'),
    f = JSON.parse(await readFile(join(root, 'official-templates/project-sources.json'), 'utf8')),
    menuRef = JSON.parse(await readFile(join(root, 'official-templates/reader-more.json'), 'utf8')),
    cache = new Map();
  for (const c of library.conversations)
    cache.set(
      c.id,
      bookmarkTargets(JSON.parse(await readFile(join(root, c.conversation_path), 'utf8'))),
    );
  const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12),
    files = {};
  // Reading position ships as its own pair of hashed assets, injected into readers only.
  for (const name of ['bookmarks.js', 'bookmarks.css', 'reading-position.js', 'reading-position.css']) {
    const s = await readFile(join(root, 'scripts', name), 'utf8');
    files[name] = name.replace('.', '.' + hash(s) + '.');
    await writeFile(join(base, files[name]), s);
  }
  const pages = (await readdir(base))
    .filter((x) => x.endsWith('.html'))
    .concat(
      (await readdir(join(base, 'conversations')))
        .filter((x) => x.endsWith('.html'))
        .map((x) => 'conversations/' + x),
    );
  for (const path of pages) {
    const d = parseHTML(await readFile(join(base, path), 'utf8')).document,
      prefix = path.startsWith('conversations/') ? '../' : './',
      isReader = ![
        'data-ceobe-import-page',
        'data-ceobe-project-detail',
        'data-ceobe-projects-page',
        'data-ceobe-asset-library',
      ].some((x) => d.body.hasAttribute(x)),
      chatId = isReader ? d.body.dataset.readerChatId : null,
      targets = cache.get(chatId) || [];
    const icon =
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 3.5h10v13l-5-3-5 3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    const sprites = parseHTML(
      await readFile(join(root, 'official-assets/cdn/assets/sprites-shell-097001e7.svg'), 'utf8'),
    ).document;
    for (const [name, id] of [
      ['user', 'avatar'],
      ['gpt', 'blossom'],
      ['edit', 'pencil'],
    ]) {
      const symbol = sprites.getElementById(id);
      if (!symbol) throw Error('Missing bookmark icon: ' + id);
      const template = d.createElement('template');
      template.id = 'ceobe-bookmark-icon-' + name;
      template.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="' +
        symbol.getAttribute('viewBox') +
        '" fill="currentColor" aria-hidden="true" focusable="false">' +
        symbol.innerHTML +
        '</svg>';
      d.body.append(template);
    }
    const all = { targets, chatId: chatId || null };
    const json = d.createElement('script');
    json.type = 'application/json';
    json.id = 'ceobe-bookmark-data';
    json.textContent = JSON.stringify(all).replaceAll('<', '\\u003c');
    d.body.append(json);
    const sections = [...d.querySelectorAll('section[data-ceobe-message-ids]')];
    const moreExample = d.querySelector('section button[aria-label="更多操作"]');
    for (const section of sections) {
      if (!chatId) break;
      const ids = JSON.parse(section.dataset.ceobeMessageIds),
        t = targets.find((t) => t.message_ids.some((id) => ids.includes(id)));
      if (!t) continue;
      section.dataset.bookmarkTarget = t.message_id;
      section.dataset.bookmarkAliases = JSON.stringify(t.message_ids);
      let more = section.querySelector('button[aria-label="更多操作"]');
      if (!more) {
        const copy = section.querySelector('[data-testid=copy-turn-action-button]');
        if (copy) {
          more = moreExample ? moreExample.cloneNode(true) : copy.cloneNode(true);
          for (const attr of more.getAttributeNames())
            if (attr.startsWith('data-') || attr === 'id' || attr === 'title')
              more.removeAttribute(attr);
          more.innerHTML = '<span class="flex items-center justify-center h-8 w-8">⋯</span>';
          copy.parentElement.append(more);
        } else {
          more = d.createElement('button');
          more.textContent = '⋯';
          more.className = 'text-token-text-secondary rounded-lg h-8 w-8';
          section.append(more);
        }
      }
      more.dataset.bookmarkMessageMore = t.message_id;
      more.type = 'button';
      more.tabIndex = 0;
      more.setAttribute('aria-label', '更多操作');
      more.setAttribute('aria-haspopup', 'menu');
      more.setAttribute('aria-expanded', 'false');
      const mark = d.createElement('button');
      mark.type = 'button';
      mark.className = more.className;
      mark.dataset.bookmarkMark = t.message_id;
      mark.setAttribute('aria-label', '编辑书签');
      mark.innerHTML = icon;
      mark.hidden = true;
      more.after(mark);
      for (const b of section.querySelectorAll('button'))
        if (['编辑消息', '评价回复', '分享', '切换模型'].includes(b.getAttribute('aria-label'))) {
          b.dataset.bookmarkUnavailable = '';
          b.tabIndex = 0;
          b.setAttribute('aria-disabled', 'true');
          b.title = '本地归档不执行此操作；可用书签记录个人备注';
        }
    }
    if (chatId) {
      const rail = d.querySelector('[data-ceobe-prompt-rail]');
      const button = d.createElement('button');
      button.type = 'button';
      button.dataset.bookmarkOpen = 'current';
      button.className = 'ceobe-bookmark-rail text-token-text-secondary rounded-lg';
      button.setAttribute('aria-label', '当前聊天书签');
      button.title = '当前聊天书签';
      button.innerHTML = icon;
      if (rail) rail.before(button);
      else d.querySelector('main')?.prepend(button);
      const form = d.querySelector('#prompt-textarea')?.closest('form');
      if (form) {
        form.dataset.bookmarkComposer = '';
        form.replaceChildren();
        const hint = d.createElement('span');
        hint.textContent = '个人备注保存在书签中，不会发送给 AI';
        const open = d.createElement('button');
        open.type = 'button';
        open.className = 'btn btn-secondary';
        open.dataset.bookmarkOpen = 'current';
        open.textContent = '书签与备注';
        form.append(hint, open);
      }
    }
    const moreSidebar = [...d.querySelectorAll('[data-sidebar-item]')].find(
      (e) => e.textContent.trim() === '更多',
    );
    if (moreSidebar) {
      moreSidebar.dataset.bookmarkSidebarMore = '';
      moreSidebar.setAttribute('role', 'button');
      moreSidebar.tabIndex = 0;
      moreSidebar.setAttribute('aria-label', '更多');
      moreSidebar.removeAttribute('id');
      moreSidebar.setAttribute('aria-expanded', 'false');
    }
    const menu = parseHTML(menuRef.menu).document.firstElementChild;
    menu.dataset.bookmarkMenu = '';
    menu.hidden = true;
    menu.removeAttribute('style');
    const m = menu.querySelector('[role=menu]'),
      item = m.querySelector('[role=menuitem]').cloneNode(true);
    m.replaceChildren(item);
    m.removeAttribute('id');
    m.removeAttribute('aria-labelledby');
    m.dataset.state = 'open';
    item.replaceChildren();
    for (const a of item.getAttributeNames()) if (a.startsWith('data-')) item.removeAttribute(a);
    item.classList.remove('sm:hidden');
    item.removeAttribute('hidden');
    item.textContent = '添加书签';
    item.dataset.bookmarkMenuAction = '';
    item.tabIndex = 0;
    item.removeAttribute('id');
    for (const use of menu.querySelectorAll('use')) use.remove();
    d.body.append(menu);
    function modal(name, title) {
      const outer = d.createElement('dialog');
      outer.className = 'ceobe-bookmarks-modal';
      outer.dataset.bookmarkDialog = name;
      outer.setAttribute('aria-labelledby', 'bookmark-' + name + '-title');
      const shell = parseHTML(f.library).document.firstElementChild;
      shell.removeAttribute('id');
      shell.removeAttribute('role');
      shell.removeAttribute('aria-labelledby');
      shell.removeAttribute('style');
      shell.replaceChildren();
      const head = d.createElement('header');
      head.className = 'ceobe-bookmark-header';
      head.innerHTML =
        '<h2 id="bookmark-' +
        name +
        '-title"></h2><button type="button" class="btn btn-ghost" data-bookmark-close aria-label="关闭">×</button>';
      head.querySelector('h2').textContent = title;
      shell.append(head);
      outer.append(shell);
      d.body.append(outer);
      return shell;
    }
    const list = modal('list', '书签');
    const body = d.createElement('div');
    body.className = 'ceobe-bookmark-list-body';
    body.innerHTML =
      '<div class="ceobe-bookmark-toolbar"><button type="button" class="btn btn-secondary" data-bookmark-scope="current">当前聊天</button><button type="button" class="btn btn-secondary" data-bookmark-scope="all">全部书签</button></div><input type="search" data-bookmark-search aria-label="搜索书签标题或聊天标题" placeholder="搜索书签标题或聊天标题"><p data-bookmark-list-status role="status"></p><div data-bookmark-list></div>';
    list.append(body);
    const edit = modal('editor', '书签备注');
    const fields = d.createElement('form');
    fields.dataset.bookmarkForm = '';
    fields.innerHTML =
      '<p data-bookmark-context></p><blockquote data-bookmark-excerpt></blockquote><label for="bookmark-title">书签标题</label><input id="bookmark-title" name="title" maxlength="160" required><label for="bookmark-note">个人备注 <span>（可选，最多 20000 字符）</span></label><textarea id="bookmark-note" name="note" maxlength="20000" rows="6" placeholder="为什么保留这条消息？有什么想法或待办？"></textarea><p data-bookmark-editor-status role="status"></p><div class="ceobe-bookmark-footer"><button type="button" class="btn btn-ghost" data-bookmark-delete>删除书签</button><button type="button" class="btn btn-secondary" data-bookmark-cancel>取消</button><button type="submit" class="btn btn-primary" data-bookmark-save>保存书签</button></div>';
    edit.append(fields);
    const status = d.createElement('p');
    status.dataset.bookmarkStatus = '';
    status.className = 'ceobe-bookmark-toast';
    status.setAttribute('role', 'status');
    status.hidden = true;
    d.body.append(status);
    for (const name of [
      'bookmarks.js',
      'bookmarks.css',
      ...(chatId ? ['reading-position.js', 'reading-position.css'] : []),
    ]) {
      const e = d.createElement(name.endsWith('.js') ? 'script' : 'link');
      if (name.endsWith('.js')) {
        e.type = 'module';
        e.src = prefix + files[name];
        d.body.append(e);
      } else {
        e.rel = 'stylesheet';
        e.href = prefix + files[name];
        d.head.append(e);
      }
    }
    await writeFile(
      join(base, path),
      '<!DOCTYPE html>\n' + htmlSafeSvg(d.documentElement.outerHTML),
    );
  }
}
