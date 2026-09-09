// Existing official picker, with an isolated draft for editing an existing project.
export function initProjectAppearance({settings,picker,getProject,isWritable,isBusy,onSaved}) {
 if(!settings||!picker)return {open(){},isSaving:()=>false};
 const trigger=settings.querySelector('[data-preview-icon]');
 const icons=JSON.parse(document.getElementById('ceobe-project-icons').textContent);
 const radios=[...picker.querySelectorAll('input[type=radio]')];
 const iconInputs=radios.filter(e=>e.name.endsWith('projectIcon'));
 const custom=picker.querySelector('[data-custom-color]');
 const hex=picker.querySelector('input[name$="project-custom-color-hex"]');
 const error=picker.querySelector('[data-color-error]');
 const finish=[...picker.querySelectorAll('button')].find(e=>e.textContent.trim()==='完成');
 const notice=document.createElement('p');notice.dataset.appearanceStatus='';notice.className='ceobe-project-status';notice.setAttribute('role','status');
 (picker.querySelector('[data-testid=dialog-dropdown-content]')||picker).append(notice);
 let draft=null,base=null,saving=false,invalid=false;
 function paintSettings(value){
  const source=iconInputs.find(e=>e.value===value.icon)||iconInputs.find(e=>e.value==='folder');
  const box=trigger.querySelector('[data-testid=project-folder-icon]');
  if(source&&box){box.replaceChildren(source.closest('label').querySelector('svg').cloneNode(true));box.style.color=value.color==='default'?'var(--icon-primary)':value.color;}
  trigger.setAttribute('aria-label','选择图标和颜色：'+(icons[value.icon]?.label||value.icon)+'，'+value.color);
 }
 function paint(){
  for(const radio of radios){radio.checked=radio.name.endsWith('projectIcon')?radio.value===draft.icon:radio.value.toLowerCase()===draft.color;radio.closest('label').dataset.state=radio.checked?'checked':'unchecked';radio.closest('label').querySelector('[class*="outline-2"]')?.classList.toggle('hidden',!radio.checked)}
  paintSettings(draft);
  for(const input of picker.querySelectorAll('input'))input.disabled=saving||!isWritable();
  finish.disabled=saving||invalid;
  picker.setAttribute('aria-busy',String(saving));
 }
 function syncHex(){custom.value=draft.color==='default'?'#808080':draft.color;hex.value=draft.color==='default'?'':draft.color;invalid=false;error.textContent='';hex.removeAttribute('aria-invalid')}
 function cancel(){if(saving)return;paintSettings(getProject());picker.close();trigger.focus()}
 function open(){
  if(saving||isBusy()||picker.open)return;
  const project=getProject();if(!project)return;
  base={id:project.id,icon:project.icon||'folder',color:project.color||'default'};
  draft={icon:icons[base.icon]?base.icon:'folder',color:base.color.toLowerCase()};
  syncHex();paint();notice.textContent=isWritable()?'选择仅预览，点击“完成”保存；Esc 或点击遮罩取消。':'当前服务只读，不能修改图标或颜色。';
  picker.showModal();(radios.find(e=>e.checked&&!e.disabled)||finish).focus();
 }
 function changed(){notice.textContent='尚未保存；点击“完成”保存，Esc 取消。';paint()}
 picker.addEventListener('change',e=>{
  if(saving||!isWritable()||!draft)return;
  if(e.target.name?.endsWith('projectIcon')){draft.icon=e.target.value;changed()}
  else if(e.target.name?.endsWith('projectColor')){draft.color=e.target.value.toLowerCase();syncHex();changed()}
 });
 custom.addEventListener('input',()=>{if(saving||!isWritable())return;draft.color=custom.value.toLowerCase();syncHex();changed()});
 hex.addEventListener('input',()=>{
  if(saving||!isWritable())return;
  invalid=!/^#[a-f0-9]{6}$/i.test(hex.value);
  hex.setAttribute('aria-invalid',String(invalid));error.textContent=invalid?'请输入 #RRGGBB 格式的颜色':'';
  if(!invalid){draft.color=hex.value.toLowerCase();custom.value=draft.color}
  changed();
 });
 finish.addEventListener('click',async e=>{
  e.preventDefault();if(saving||invalid||!draft)return;
  if(!isWritable()||draft.icon===base.icon&&draft.color===base.color){cancel();return}
  saving=true;paint();notice.textContent='正在保存图标和颜色…';
  try{
   const response=await fetch('/api/projects/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:base.id,action:'appearance',icon:draft.icon,color:draft.color,previousIcon:base.icon,previousColor:base.color}),signal:AbortSignal.timeout(30000)});
   const result=await response.json().catch(()=>null);
   if(!response.ok||!result?.project)throw Error(result?.error||'无法确认保存结果，请重新打开设置检查');
   onSaved(result);saving=false;paint();paintSettings(result.project);picker.close();trigger.focus();
   settings.querySelector('[data-preview-status]').textContent='图标和颜色已保存到本地。项目简介请单独保存；删除项目保留全部聊天。';
  }catch(err){saving=false;paint();notice.textContent='保存失败：'+err.message+'。当前选择仍保留；若发生冲突，请关闭项目设置后重新打开。';finish.focus()}
 });
 picker.addEventListener('cancel',e=>{e.preventDefault();cancel()});
 picker.addEventListener('click',e=>{if(e.target!==picker)return;const r=picker.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)cancel()});
 return {open,isSaving:()=>saving};
}
