const rail = document.querySelector('[data-ceobe-prompt-rail]');
if (rail) {
  const markers = [...rail.querySelectorAll('[data-ceobe-jump]')];
  const turns = new Map([...document.querySelectorAll('section[data-testid]')].map(n => [n.dataset.testid, n]));
  const entries = markers.map(button => ({ button, target: turns.get(button.dataset.ceobeJump) })).filter(e => e.target);
  const viewport = markers[0]?.parentElement.parentElement;
  const menu = document.createElement('div');
  menu.className = 'ceobe-prompt-menu popover rounded-2xl shadow-long py-1.5 select-none';
  menu.hidden = true;
  menu.setAttribute('aria-label', '对话目录');
  const list = document.createElement('ul');
  menu.append(list); rail.firstElementChild.append(menu);
  entries.forEach(({button, target}, index) => {
    const row = document.createElement('li');
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'ceobe-prompt-item';
    const heading = document.createElement('span');
    heading.className = 'ceobe-prompt-item-heading';
    const label = document.createElement('span');
    label.className = 'ceobe-prompt-item-label';
    label.textContent = button.dataset.ceobePromptLabel;
    heading.append(label);
    const filename = button.dataset.ceobePromptFilename;
    const reply = button.dataset.ceobePromptReply;
    if (filename) {
      const file = document.createElement('span');
      file.className = 'ceobe-prompt-item-filename';
      file.textContent = filename;
      heading.append(file);
    }
    item.append(heading);
    if (reply) {
      const detail = document.createElement('span');
      detail.className = 'ceobe-prompt-item-detail';
      const summary = document.createElement('span');
      summary.className = 'ceobe-prompt-item-reply';
      summary.textContent = reply;
      detail.append(summary);
      item.append(detail);
    }
    item.setAttribute('aria-label', filename ? `${button.dataset.ceobePromptLabel}：${filename}` : button.dataset.ceobePromptLabel);
    item.dataset.ceobeJump = button.dataset.ceobeJump;
    if (button.dataset.ceobePromptKind) item.dataset.ceobePromptKind = button.dataset.ceobePromptKind;
    row.append(item); list.append(row);
    entries[index].item = item;
  });
  let hovered = false, open = false, closeTimer, fadeTimer, active, frame, detailItem, menuPositioned = false;
  let accurateLayout;
  function showDetail(item) {
    if (!item || item === detailItem || !item.querySelector('.ceobe-prompt-item-detail')) return;
    detailItem?.removeAttribute('data-ceobe-detail-active');
    detailItem = item;
    detailItem.setAttribute('data-ceobe-detail-active', '');
  }
  function clearDetail() {
    detailItem?.removeAttribute('data-ceobe-detail-active');
    detailItem = null;
  }
  function ensureAccurateLayout() {
    if (!accurateLayout) {
      document.documentElement.setAttribute('data-ceobe-accurate-turn-layout', '');
      accurateLayout = new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    return accurateLayout;
  }
  function keepVisible(container, node) {
    if (!node || container.clientHeight <= 0) return;
    const box = container.getBoundingClientRect(), rect = node.getBoundingClientRect();
    if (rect.top < box.top) container.scrollTop -= box.top - rect.top;
    else if (rect.bottom > box.bottom) container.scrollTop += rect.bottom - box.bottom;
  }
  function show() {
    if (rail.hidden || !entries.length) return;
    clearTimeout(closeTimer); clearTimeout(fadeTimer);
    open = true; menu.hidden = false; menu.inert = false;
    menu.setAttribute('aria-hidden', 'false');
    rail.setAttribute('data-ceobe-menu-open', '');
    if (!menuPositioned) {
      keepVisible(list, active?.item);
      menuPositioned = true;
    }
  }
  function hide() {
    clearTimeout(closeTimer); open = false; menu.inert = true;
    menu.setAttribute('aria-hidden', 'true');
    rail.removeAttribute('data-ceobe-menu-open');
    clearTimeout(fadeTimer); fadeTimer = setTimeout(() => { menu.hidden = true; clearDetail(); }, 160);
  }
  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      const keyboardFocus = rail.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
      if (!hovered && !keyboardFocus) hide();
    }, 250);
  }
  rail.addEventListener('mouseenter', () => { hovered = true; show(); });
  rail.addEventListener('mouseleave', () => { hovered = false; scheduleClose(); });
  rail.addEventListener('focusin', show);
  rail.addEventListener('focusout', scheduleClose);
  list.addEventListener('pointermove', event => showDetail(event.target.closest('.ceobe-prompt-item')));
  list.addEventListener('focusin', event => showDetail(event.target.closest('.ceobe-prompt-item')));
  rail.addEventListener('keydown', event => {
    if (event.key === 'Escape') { hovered = false; document.activeElement?.blur(); hide(); return; }
    const buttons = event.target.closest('.ceobe-prompt-menu') ? entries.map(e => e.item) : markers;
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowDown') next = Math.min(index + 1, buttons.length - 1);
    if (event.key === 'ArrowUp') next = Math.max(index - 1, 0);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (next !== undefined) { event.preventDefault(); buttons[next].focus({preventScroll:true}); }
  });
async function scrollMessageTop(target){
  document.documentElement.setAttribute('data-ceobe-accurate-turn-layout','');
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  let scroller=target.parentElement;
  while(scroller&&!( /(auto|scroll)/.test(getComputedStyle(scroller).overflowY)&&scroller.scrollHeight>scroller.clientHeight))scroller=scroller.parentElement;
  scroller ||= document.scrollingElement;
  const offset=scroller===document.scrollingElement?0:scroller.getBoundingClientRect().top;
  const visibleTop=Math.max(offset,document.querySelector('header')?.getBoundingClientRect().bottom||0)+8;
  const top=Math.max(0,target.getBoundingClientRect().top+scroller.scrollTop-visibleTop);
  const missing=top-(scroller.scrollHeight-scroller.clientHeight);
  if(missing>0){const host=document.querySelector('[data-ceobe-message-list]');if(host){let space=host.querySelector('[data-ceobe-jump-space]');if(!space){space=document.createElement('div');space.dataset.ceobeJumpSpace='';space.setAttribute('aria-hidden','true');host.append(space)}space.style.height=((parseFloat(space.style.height)||0)+missing+1)+'px'}}
  scroller.scrollTo({top,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
  function scrollParent(node) {
    for (let p = node.parentElement; p; p = p.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    }
    return document.scrollingElement;
  }
  rail.addEventListener('click', async event => {
    const button = event.target.closest('[data-ceobe-jump]') || (menu.contains(event.target) ? detailItem : null);
    if (!button) return;
    const target = turns.get(button.dataset.ceobeJump);
    if (!target) return;
    event.preventDefault();
    await ensureAccurateLayout();
    await scrollMessageTop(target);
  }, true);
  function update() {
    frame = null;
    if (!entries.length) { rail.hidden = true; return; }
    const scroller = scrollParent(entries[0].target);
    const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
    let current = entries[0];
    for (const entry of entries) { if (entry.target.getBoundingClientRect().top <= top + 100) current = entry; else break; }
    if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = entries.at(-1);
    viewport.style.maxHeight = Math.floor(Math.min(innerHeight, scroller.clientHeight) * .5) + 'px';
    list.style.maxHeight = viewport.style.maxHeight;
    if (current === active) return;
    active = current;
    for (const entry of entries) for (const node of [entry.button, entry.item]) {
      node.toggleAttribute('data-toc-active', entry === active);
      if (entry === active) node.setAttribute('aria-current', 'location'); else node.removeAttribute('aria-current');
    }
  }
  const requestUpdate = () => { if (!frame) frame = requestAnimationFrame(update); };
  document.addEventListener('scroll', requestUpdate, {capture:true, passive:true});
  window.addEventListener('resize', requestUpdate);
  new ResizeObserver(requestUpdate).observe(document.querySelector('main') || document.body);
  new MutationObserver(() => { if (rail.hidden) { hovered = false; hide(); } else requestUpdate(); }).observe(rail, {attributes:true, attributeFilter:['hidden']});
  update();
}
