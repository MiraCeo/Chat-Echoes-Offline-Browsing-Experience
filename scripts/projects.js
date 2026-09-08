(() => {
const main=document.querySelector('main'),rows=main.querySelector('[data-project-rows]'),template=document.getElementById('ceobe-project-row');
const modal=document.querySelector('[data-project-modal]'),picker=document.querySelector('[data-project-picker]'),form=modal.querySelector('form'),input=form.querySelector('#project-name'),submit=form.querySelector('[type=submit]'),error=form.querySelector('#project-form-error');
const search=main.querySelector('[data-project-search]'),status=main.querySelector('[data-project-status]')||document.getElementById('ceobe-chat-status'),icons=JSON.parse(document.getElementById('ceobe-project-icons').textContent);
let projects=JSON.parse(document.getElementById('ceobe-projects-data').textContent),writable=false,busy=false,filter='all',color='default',icon='folder',opener,requestId,conversationId;
const iconButton=form.querySelector('[data-testid=project-modal-trigger]');
function svg(name){return picker.querySelector(`input[name="projectIcon"][value="${icons[name]?name:'folder'}"]`).closest('label').querySelector('svg').cloneNode(true)}
function render(){
 if(!rows)return;
 const query=search.value.trim().toLocaleLowerCase();const shown=projects.filter(p=>filter!=='shared'&&p.name.toLocaleLowerCase().includes(query));
 rows.replaceChildren();for(const project of shown){
  const row=template.content.firstElementChild.cloneNode(true);row.dataset.projectId=project.id;row.tabIndex=0;row.setAttribute('aria-label','打开项目 '+project.name);row.addEventListener('click',()=>location.href='./project.html?id='+encodeURIComponent(project.id));row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();row.click()}});
  const cells=row.querySelectorAll('[role=gridcell]');const image=document.createElement('span');image.className='ceobe-project-icon';image.style.color=project.color==='default'?'var(--text-primary)':project.color;image.append(svg(project.icon));
  const name=document.createElement('span');name.className='ceobe-project-name';name.textContent=project.name;name.title=project.name;cells[0].append(image,name);
  cells[1].textContent=new Date(project.updated_at).toLocaleDateString('zh-CN');cells[1].title=project.updated_at;
  cells[2].textContent='本地';cells[2].classList.add('ceobe-project-local');rows.append(row);
 }
 const empty=main.querySelector('[data-project-empty]');empty.hidden=shown.length>0;empty.textContent=filter==='shared'?'本地项目暂不支持共享。':projects.length?'没有找到匹配的项目。':'还没有本地项目，点击“新建”开始。';
 for(const b of main.querySelectorAll('[data-project-filter]')){const active=b.dataset.projectFilter===filter;b.setAttribute('aria-pressed',String(active));b.classList.toggle('ceobe-project-tab-active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
}
function update(){submit.disabled=busy||!input.value.trim();submit.classList.toggle('cursor-not-allowed',submit.disabled);submit.toggleAttribute('data-visually-disabled',submit.disabled);form.setAttribute('aria-busy',String(busy));input.readOnly=busy;iconButton.disabled=busy;modal.querySelector('[data-testid=close-button]').disabled=busy;submit.querySelector('div').textContent=busy?'正在创建…':'创建项目';}
function paintIcon(){const wrapper=iconButton.querySelector('[data-testid=project-folder-icon]');wrapper.replaceChildren(svg(icon));wrapper.style.color=color==='default'?'var(--text-primary)':color;iconButton.setAttribute('aria-label',`选择图标和颜色：${icons[icon].label}，${color}`);
 for(const radio of picker.querySelectorAll('input[type=radio]')){radio.checked=radio.name==='projectIcon'?radio.value===icon:radio.value===color;radio.closest('label').dataset.state=radio.checked?'checked':'unchecked';const ring=radio.closest('label').querySelector('[class*="outline-2"]');if(ring)ring.classList.toggle('hidden',!radio.checked);}
}
function close(){if(busy)return;if(picker.open)picker.close();modal.close();opener?.focus()}
async function openProject(button,id=null){
 if(!writable)await load();if(!writable)return;opener=button;conversationId=id;form.reset();color='default';icon='folder';requestId=crypto.randomUUID();error.textContent='';input.removeAttribute('aria-invalid');paintIcon();update();modal.showModal();input.focus();
}
for(const button of main.querySelectorAll('[data-project-new]'))button.addEventListener('click',()=>openProject(button));
document.addEventListener('ceobe:open-project',e=>openProject(e.detail.opener,e.detail.conversationId));
modal.querySelector('[data-testid=close-button]').addEventListener('click',close);
modal.addEventListener('cancel',e=>{e.preventDefault();close()});
iconButton.addEventListener('click',()=>{paintIcon();picker.showModal();picker.querySelector('input:checked')?.focus()});
const finish=[...picker.querySelectorAll('button')].find(b=>b.textContent.trim()==='完成');finish.addEventListener('click',()=>{picker.close();iconButton.focus()});
picker.addEventListener('cancel',e=>{e.preventDefault();picker.close();iconButton.focus()});
picker.addEventListener('change',e=>{if(e.target.name==='projectIcon')icon=e.target.value;if(e.target.name==='projectColor'){color=e.target.value;picker.querySelector('[data-color-error]').textContent=''}paintIcon()});
const custom=picker.querySelector('[data-custom-color]'),hex=picker.querySelector('[name=project-custom-color-hex]');
custom.addEventListener('input',()=>{color=custom.value;hex.value=color;picker.querySelector('[data-color-error]').textContent='';paintIcon()});
hex.addEventListener('input',()=>{if(/^#[a-f0-9]{6}$/i.test(hex.value)){color=hex.value.toLowerCase();custom.value=color;picker.querySelector('[data-color-error]').textContent='';paintIcon()}else picker.querySelector('[data-color-error]').textContent='请输入 #RRGGBB 格式的颜色';});
input.addEventListener('input',()=>{error.textContent='';input.removeAttribute('aria-invalid');update()});
form.addEventListener('submit',async e=>{
 e.preventDefault();if(busy)return;const name=input.value.trim().normalize('NFC');
 if(!name||[...name].length>80||/[\x00-\x1f\x7f]/.test(name)){error.textContent='请输入 1–80 个字符的有效项目名称';input.setAttribute('aria-invalid','true');input.focus();return}
 busy=true;update();error.textContent='';
 try{
  const response=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,color,icon,requestId})});
  const result=await response.json().catch(()=>null);if(!response.ok||!result?.project)throw new Error(result?.error||'本地服务不可用，未创建项目');
  if(conversationId){const moved=await fetch('/api/projects/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId,projectId:result.project.id})});const value=await moved.json().catch(()=>null);if(!moved.ok)throw new Error('项目已创建，但聊天移入失败。可重试本次提交：'+(value?.error||'服务不可用'))}
  projects=[result.project,...projects.filter(p=>p.id!==result.project.id)];if(search)search.value='';filter='all';render();status.textContent=`已创建“${result.project.name}”，已保存到本地。`;busy=false;close();document.dispatchEvent(new CustomEvent('ceobe:project-created',{detail:{project:result.project,conversationId}}));
 }catch(e){error.textContent=e instanceof TypeError?'连接中断，可重试；同一次提交不会重复创建。':e.message;input.setAttribute('aria-invalid','true');}
 finally{busy=false;update()}
});
search?.addEventListener('input',render);
for(const b of main.querySelectorAll('[data-project-filter]'))b.addEventListener('click',()=>{filter=b.dataset.projectFilter;render()});
async function load(){try{const r=await fetch('/api/projects',{cache:'no-store'});const result=await r.json();if(!r.ok||!Array.isArray(result.projects))throw new Error();projects=result.projects;writable=result.writable===true;status.textContent='项目保存在本地工作区；可通过聊天菜单关联项目；暂未接入附件或共享。';}catch{writable=false;status.textContent='当前为只读快照。新建项目请使用本地 npm run dev 或 npm run preview 服务。';}for(const b of main.querySelectorAll('[data-project-new]')){b.disabled=!writable;b.title=writable?'创建本地项目':'当前服务只读';}render()}
render();load();

})();
