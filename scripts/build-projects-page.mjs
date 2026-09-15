import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { htmlSafeSvg } from './serialize-html.mjs';
import { prepareLocalSidebar } from './local-sidebar.mjs';
import { createProjectStore } from './project-store.mjs';
export async function buildProjectsPage(root) {
 const replay=join(root,'replay');
 const frozen=JSON.parse(await readFile(join(root,'official-templates/projects.json'),'utf8'));
 const create=JSON.parse(await readFile(join(root,'official-templates/new-project.json'),'utf8'));
 const d=parseHTML(await readFile(join(replay,'import.html'),'utf8')).document;
 const main=parseHTML(frozen.main).document.querySelector('main');d.querySelector('main').replaceWith(main);
 d.body.removeAttribute('data-ceobe-import-page');d.body.dataset.ceobeProjectsPage='';d.title='项目 · CEOBE';prepareLocalSidebar(d,'projects');
 const group=main.querySelector('[data-page-table-row-group]');
 const row=group.firstElementChild.cloneNode(true);
 for(const e of row.querySelectorAll('[role=gridcell]'))e.replaceChildren();
 row.removeAttribute('tabindex');row.removeAttribute('aria-selected');
 group.replaceChildren();group.dataset.projectRows='';
 const tpl=d.createElement('template');tpl.id='ceobe-project-row';tpl.innerHTML=row.outerHTML;d.body.append(tpl);
 for(const b of main.querySelectorAll('button')){
  b.type='button';const text=b.textContent.trim();
  if(text==='新建'){b.dataset.projectNew='';b.disabled=true;}
  else if(['全部','由你创建','与你共享'].includes(text))b.dataset.projectFilter=text==='与你共享'?'shared':text==='全部'?'all':'owned';
 }
 const search=main.querySelector('input');search.dataset.projectSearch='';
 const empty=d.createElement('p');empty.dataset.projectEmpty='';empty.className='ceobe-project-empty';group.after(empty);
 const status=d.createElement('p');status.dataset.projectStatus='';status.setAttribute('role','status');status.className='ceobe-project-status';group.before(status);
 const modal=parseHTML(create.modal).document.querySelector('dialog');modal.dataset.projectModal='';modal.id='ceobe-create-project';
 const form=modal.querySelector('form');const name=form.querySelector('#project-name');name.maxLength=80;name.setAttribute('maxlength','80');name.setAttribute('aria-describedby','project-form-error');
 form.querySelector('aside p').textContent='创建本地项目，用名称、图标和颜色整理聊天，聊天中的附件会自动汇总。不支持手动上传、AI 记忆或云端共享。';
 const memory=form.querySelector('[data-testid="project-memory-scope-trigger"]');memory.textContent='本地项目';memory.disabled=true;memory.removeAttribute('aria-haspopup');memory.removeAttribute('aria-controls');memory.title='仅保存到当前工作区，不启用 AI 记忆';
 for(const e of form.querySelectorAll('[popover]'))e.remove();
 const err=d.createElement('p');err.id='project-form-error';err.setAttribute('role','alert');err.className='ceobe-project-error';form.querySelector('input').closest('.mb-2').append(err);
 const picker=parseHTML(create.picker).document.querySelector('dialog');picker.dataset.projectPicker='';
 const customButton=[...picker.querySelectorAll('button')].find(e=>e.textContent.trim()==='自定义颜色');
 const custom=customButton.parentElement;custom.replaceChildren();custom.className='ceobe-project-custom-color';
 custom.innerHTML='<label>自定义颜色 <input type="color" data-custom-color aria-label="选择自定义颜色" value="#3b82f6"></label><input name="project-custom-color-hex" aria-label="十六进制颜色" maxlength="7" placeholder="#3B82F6" value="#3b82f6"><span data-color-error role="status"></span>';
 for(const radio of picker.querySelectorAll('fieldset[aria-label="颜色"] input'))radio.name='projectColor';
 for(const radio of picker.querySelectorAll('fieldset[aria-label="图标"] input'))radio.name='projectIcon';
 d.body.append(modal,picker);
 const icons=d.createElement('script');icons.id='ceobe-project-icons';icons.type='application/json';icons.textContent=JSON.stringify(create.icons).replaceAll('<','\\u003c');d.body.append(icons);
 const projects=await createProjectStore(join(root,'data/private/projects.ceobe.json')).list();
 const initial=d.createElement('script');initial.id='ceobe-projects-data';initial.type='application/json';initial.textContent=JSON.stringify(projects).replaceAll('<','\\u003c');d.body.append(initial);
 for(const use of d.querySelectorAll('main use,dialog use')){
  const href=use.getAttribute('href')||'',id=href.split('#')[1];if(id)use.setAttribute('href',`./cdn/assets/${href.includes('sprites-shell')?'sprites-shell-097001e7.svg':'sprites-core-26c3f2d4.svg'}#${id}`);
 }
 for(const asset of new Set([...frozen.stylesheets,...create.stylesheets])){
  if([...d.querySelectorAll('link[rel=stylesheet]')].some(e=>e.getAttribute('href')===`./assets/${asset}`))continue;
  const l=d.createElement('link');l.rel='stylesheet';l.href=`./assets/${asset}`;d.head.append(l);
 }
 for(const file of ['projects.js','projects.css']){
  const content=await readFile(join(root,'scripts',file));await writeFile(join(replay,file),content);
  const url=`./${file}?v=${createHash('sha256').update(content).digest('hex').slice(0,12)}`;
  if(file.endsWith('.js')){const e=d.createElement('script');e.type='module';e.src=url;d.body.append(e)}else{const e=d.createElement('link');e.rel='stylesheet';e.href=url;d.head.append(e)}
 }
 await writeFile(join(replay,'projects.html'),'<!DOCTYPE html>\n'+htmlSafeSvg(d.documentElement.outerHTML));
 console.log('Built local projects page:',projects.length,'saved projects; official create dialog and icon picker.');
}
