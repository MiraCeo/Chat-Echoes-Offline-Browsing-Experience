if (document.body.hasAttribute('data-ceobe-import-page') || document.body.hasAttribute('data-ceobe-project-detail')) {
  const form = document.querySelector('[data-ceobe-import-form]');
  const input = document.querySelector('[data-ceobe-import-input]');
  const submit = document.querySelector('[data-ceobe-import-submit]');
  if (!form || !input || !submit) throw new Error('Official import composer is incomplete.');
  input.setAttribute('contenteditable', 'true');
  input.setAttribute('role', 'textbox');
  input.setAttribute('aria-multiline', 'false');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('aria-describedby', 'ceobe-import-status');
  submit.type = 'submit';

  const status = document.createElement('div');
  status.id = 'ceobe-import-status';
  status.dataset.ceobeImportStatus = '';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  form.insertAdjacentElement('afterend', status);
  const actions = document.createElement('div');
  actions.className = 'ceobe-import-actions';
  status.insertAdjacentElement('afterend', actions);
  let busy = false;
  let available=false;
  const requests=new Map();
  const requestId=url=>{if(requests.has(url))return requests.get(url);let id;try{id=sessionStorage.getItem('ceobe.import-request:'+url)}catch{}if(!/^[a-f0-9-]{36}$/i.test(id||''))id=crypto.randomUUID();requests.set(url,id);try{sessionStorage.setItem('ceobe.import-request:'+url,id)}catch{}return id};
  let imported = null;
  let noticeTimer;
  const value = () => input.textContent.trim();
  const updateButton = () => { submit.disabled = busy || !available || !value(); };
  const showStatus = (text, state) => {
    status.textContent = text;
    status.dataset.state = state;
  };
  const setBusy = state => {
    busy = state;
    input.setAttribute('contenteditable', String(!state && available));
    form.setAttribute('aria-busy', String(state));
    submit.setAttribute('aria-busy', String(state));
    submit.setAttribute('aria-label', state ? '正在导入，请稍候' : '导入会话');
    updateButton();
  };
  const normalizeLink = text => {
    try {
      const url = new URL(text);
      if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || url.port || url.username || url.password ||
          !/^\/share\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/?$/i.test(url.pathname)) return null;
      url.search = ''; url.hash = '';
      return url.href;
    } catch { return null; }
  };
  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    if (!busy) { showStatus('', 'idle'); actions.replaceChildren(); }
    updateButton();
  });
  // Keep the captured contenteditable DOM, but never paste rich HTML into it.
  input.addEventListener('paste', event => {
    event.preventDefault();
    if (busy || !available) return;
    const text = (event.clipboardData?.getData('text/plain') || '').trim().replace(/[\r\n]+/g, ' ');
    const selection = window.getSelection();
    if (selection?.rangeCount && input.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node); range.setStartAfter(node); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
    } else input.textContent = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      if (!busy) form.requestSubmit();
    }
  });
  window.addEventListener('beforeunload', event => {
    if (busy) { event.preventDefault(); event.returnValue = ''; }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !available) return;
    const url = normalizeLink(value());
    actions.replaceChildren();
    if (!url) {
      showStatus(value() ? '链接格式不正确，请粘贴 https://chatgpt.com/share/… 形式的公开分享链接。' : '请先粘贴 ChatGPT 分享链接。', 'error');
      input.setAttribute('aria-invalid', 'true'); input.focus(); return;
    }
    input.removeAttribute('aria-invalid');
    setBusy(true);
    showStatus('正在读取分享页面并归档附件，请稍候…', 'busy');
    // One backend request covers multiple stages; do not invent a progress percentage.
    noticeTimer = setTimeout(() => showStatus('仍在归档中，较长对话或较多附件可能需要几分钟。请勿重复提交。', 'busy'), 15000);
    try {
      const projectId=document.body.dataset.projectImportId;
       if(document.body.hasAttribute('data-ceobe-project-detail')){
         if(!projectId)throw new Error('项目不存在，无法导入。');
         const check=await fetch('/api/projects',{cache:'no-store'}),data=await check.json();
         if(!check.ok||!data.writable||!data.projects?.some(p=>p.id===projectId))throw new Error('项目不可写，未开始导入。');
       }
       const response = imported?.url===url ? {ok:true,json:async()=>imported.result} : await fetch('/api/archive-share', {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ url, requestId:requestId(url) }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        if (response.status === 409) throw new Error(result?.error||'工作区正在写入，请等待完成后再重试。');
        if(result?.retryPublish)throw new Error(result.error);
        if (response.status === 404 || response.status === 405 || !result) throw new Error('当前服务不支持导入。请使用本地开发服务或本地生产预览服务；纯静态部署只支持阅读。');
        console.error('Share import failed:', result.error);
        throw new Error('导入未完成。请确认分享链接可公开访问及网络连接正常，然后重试。');
      }
      if(projectId){
         imported={url,result};
         const move=await fetch('/api/projects/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:result.shareId,projectId})});
         if(!move.ok)throw new Error('会话已归档，但移入项目失败。点击重试只重试关联，不会重复导入。');
         document.dispatchEvent(new Event('ceobe:project-imported'));
       }
       const destination = new URL(result.page, location.origin);
      if (destination.origin !== location.origin || !destination.pathname.startsWith('/conversations/')) throw new Error('归档已返回，但会话入口无效，请检查本地档案库。');
      if(!projectId)document.dispatchEvent(new Event('ceobe:project-imported'));
       const counts = result.resourceCounts || {};
      const missing = Object.entries(counts).filter(([key]) => ['failed', 'unresolved', 'skipped', 'missing'].includes(key))
        .reduce((sum, [, count]) => sum + (Number(count) || 0), 0);
      showStatus(`已归档「${result.title || '会话'}」，共 ${Number(result.messageCount) || 0} 条消息。${missing ? `有 ${missing} 个资源未保存，可在归档报告中查看。` : '可打开会话查看保存的内容。'}`, 'success');
      const open = document.createElement('a');
      open.href = destination.href; open.className = 'ceobe-import-open'; open.textContent = '打开会话';
      actions.append(open);
       if(projectId){status.textContent+=' 已移入“'+document.body.dataset.projectImportName+'”。';}
      open.focus();
       requests.delete(url);try{sessionStorage.removeItem('ceobe.import-request:'+url)}catch{}imported=null;
    } catch (error) {
      showStatus(error instanceof TypeError ? '连接中断，后台可能仍在归档。请先查看最近会话，确认后再重试。' : error.message, 'error');
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'ceobe-import-retry'; retry.textContent = '重试导入';
      retry.addEventListener('click', () => form.requestSubmit());
      actions.append(retry);
    } finally {
      clearTimeout(noticeTimer); setBusy(false);
    }
  });
  input.setAttribute('contenteditable','false');
  showStatus('正在检查本地导入服务…','idle');updateButton();
  fetch('/api/capabilities',{cache:'no-store',signal:AbortSignal.timeout(5000)}).then(async response=>{const data=await response.json();if(!response.ok||data.importShare!==true)throw Error();available=true;input.setAttribute('contenteditable','true');showStatus('','idle');updateButton()}).catch(()=>{available=false;input.setAttribute('contenteditable','false');showStatus('当前为只读页面或本地服务不可用，无法导入。请启动 npm run dev，或构建后运行 npm run preview，再刷新页面。','unavailable');updateButton()});
}
