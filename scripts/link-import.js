if (document.body.hasAttribute('data-ceobe-import-page') || document.body.hasAttribute('data-ceobe-project-detail')) {
  const form = document.querySelector('[data-ceobe-import-form]');
  const input = document.querySelector('[data-ceobe-import-input]');
  const submit = document.querySelector('[data-ceobe-import-submit]');
  if (!form || !input || !submit) throw new Error('Official import composer is incomplete.');

  // 统一在这里定义导入页的附加样式（折叠标题、上传入口、上传区）。
  if (!document.getElementById('ceobe-package-styles')) {
    const style = document.createElement('style');
    style.id = 'ceobe-package-styles';
    style.textContent = `
      [data-ceobe-import-help] summary { display:flex; align-items:center; gap:6px; width:max-content;
        font-size:12px; line-height:20px; color:#98a2b3; cursor:pointer; list-style:none; border-radius:6px;
        transition:color .16s ease; }
      [data-ceobe-import-help] summary::-webkit-details-marker { display:none; }
      [data-ceobe-import-help] summary:hover { color:#475467; }
      [data-ceobe-import-help] summary:focus-visible { outline:2px solid rgba(37,99,235,.45); outline-offset:3px; }
      [data-ceobe-import-help] summary::before { content:''; width:5px; height:5px; border-right:1.5px solid currentColor;
        border-bottom:1.5px solid currentColor; transform:rotate(-45deg); transition:transform .16s ease; }
      [data-ceobe-import-help][open] summary::before { transform:rotate(45deg); }
      [data-ceobe-package-details] summary { display:flex; align-items:center; gap:8px; width:max-content;
        margin-top:14px; font-size:13px; line-height:20px; color:#667085; cursor:pointer; list-style:none;
        border-radius:6px; transition:color .16s ease; }
      [data-ceobe-package-details] summary::-webkit-details-marker { display:none; }
      [data-ceobe-package-details] summary:hover { color:#344054; }
      [data-ceobe-package-details] summary:focus-visible { outline:2px solid rgba(37,99,235,.45); outline-offset:3px; }
      [data-ceobe-package-details] summary em { font-style:normal; color:#98a2b3; }
      [data-ceobe-package-details][open] summary { margin-bottom:10px; }
      [data-ceobe-package-zone] { padding:22px 16px; gap:8px; border-color:#d8dee4; background-color:#fcfcfd;
        transition:border-color .16s ease, background-color .16s ease; }
      [data-ceobe-package-zone]:hover { border-color:#b9c0c8; background-color:#f8f9fb; }
    `;
    document.head.append(style);
  }


  // 采集包：拖入表单、拖入上传区、或点选文件，都走同一个导入接口。
  const uploadPackage = async file => {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) { showStatus('请选择扩展导出的 .zip 采集包。', 'error'); return; }
    showStatus('正在导入采集包…', 'working');
    try {
      const response = await fetch('/api/archive-package', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || ('HTTP ' + response.status));
      showStatus('已导入：' + (data.title || data.shareId) + '（' + data.turnCount + ' 轮），正在打开…', 'done');
      location.assign(data.page);
    } catch (error) { showStatus('导入失败：' + error.message, 'error'); }
  };
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.zip,application/zip';
  picker.hidden = true;
  picker.addEventListener('change', () => uploadPackage(picker.files && picker.files[0]));
  form.insertAdjacentElement('beforebegin', picker);
  form.addEventListener('dragover', event => { if (event.dataTransfer && event.dataTransfer.types.includes('Files')) { event.preventDefault(); highlight(true); } });
  form.addEventListener('dragleave', () => { highlight(false); });
  form.addEventListener('drop', async event => {
    if (!event.dataTransfer || !event.dataTransfer.files[0]) return;
    event.preventDefault();
    highlight(false);
    await uploadPackage(event.dataTransfer.files[0]);
  });
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

  // 拖拽反馈只在拖入时出现：常驻虚线边框会和圆角输入框的质感冲突。
  const highlight = on => {
    form.style.transition = 'box-shadow .16s ease, background-color .16s ease';
    form.style.boxShadow = on ? '0 0 0 3px rgba(37, 99, 235, .30)' : '';
    form.style.backgroundColor = on ? 'rgba(37, 99, 235, .04)' : '';
  };
  // 上方：采集包上传区（虚线框 + 图标 + 文案），中间一条"或"，下方保留原分享链接输入。
  const zone = document.createElement('div');
  zone.dataset.ceobePackageZone = '';
  Object.assign(zone.style, {
    boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: '10px', width: '100%', borderStyle: 'dashed', borderWidth: '1.5px', borderRadius: '16px',
    color: '#475467', cursor: 'pointer',
  });
  zone.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>'
    + '<div style="text-align:center;line-height:1.6;font-size:13px"><strong style="font-weight:600;color:#344054">把采集包拖到这里</strong><span style="color:#98a2b3">，或</span> <span data-ceobe-package-pick style="color:#344054;text-decoration:underline;text-underline-offset:3px">选择 .zip 文件</span></div>';
  const setZone = on => { zone.style.borderColor = on ? '#1f2937' : '#d0d5dd'; zone.style.background = on ? '#f2f4f7' : '#fbfcfd'; };
  zone.addEventListener('click', event => { event.preventDefault(); picker.click(); });
  zone.addEventListener('dragover', event => { event.preventDefault(); setZone(true); });
  zone.addEventListener('dragleave', () => setZone(false));
  zone.addEventListener('drop', async event => {
    if (!event.dataTransfer || !event.dataTransfer.files[0]) return;
    event.preventDefault();
    setZone(false);
    await uploadPackage(event.dataTransfer.files[0]);
  });
  // 渐进披露：默认只有一行入口，点开才出现上传区，避免两个大块争夺注意力。
  const packageDetails = document.createElement('details');
  packageDetails.dataset.ceobePackageDetails = '';
  const packageSummary = document.createElement('summary');
  packageSummary.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg><span>上传采集包 <em>.zip</em></span>';
  zone.style.marginBottom = '0';
  packageDetails.append(packageSummary, zone);
  const block = document.createElement('div');
  block.dataset.ceobePackageBlock = '';
  block.append(packageDetails);

  const parent = form.parentElement;
  const description = parent.querySelector('.ceobe-import-description')
    || [...parent.querySelectorAll('div, p')].find(node => node.children.length > 0
      && !node.closest('[data-ceobe-package-block]')
      && /导入公开分享链接/.test(node.textContent || ''));
  const explainers = description ? [description] : [];
  let tail = form;
  if (explainers.length) {
    const details = document.createElement('details');
    details.dataset.ceobeImportHelp = '';
    Object.assign(details.style, { marginTop: '10px' });
    const summary = document.createElement('summary');
    summary.textContent = '导入说明';
    const body = document.createElement('div');
    Object.assign(body.style, { marginTop: '6px', fontSize: '12px', lineHeight: '1.7', color: '#98a2b3' });
    for (const node of explainers) body.append(node);
    details.append(summary, body);
    form.insertAdjacentElement('afterend', details);
    tail = details;
  }
  tail.insertAdjacentElement('afterend', block);
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
      // Turns are what the reader shows as bubbles; records also include hidden
      // system context, reasoning and tool activity kept in the archive.
      const records = Number(result.messageCount) || 0, turns = Number(result.turnCount);
      const summary = Number.isFinite(turns) && result.turnCount !== null
        ? `共 ${turns} 轮对话，归档 ${records} 条记录（含推理与工具活动）`
        : `共 ${records} 条消息`;
      showStatus(`已归档「${result.title || '会话'}」，${summary}。${missing ? `有 ${missing} 个资源未保存，可在归档报告中查看。` : '可打开会话查看保存的内容。'}`, 'success');
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
