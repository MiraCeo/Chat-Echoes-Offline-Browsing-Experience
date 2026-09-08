import {readFile,writeFile,cp} from 'node:fs/promises';
import {resolve,dirname,join,basename} from 'node:path';
import {parseArgs} from 'node:util';
import {parseHTML} from 'linkedom';
import {htmlSafeSvg} from './serialize-html.mjs';
const {values}=parseArgs({options:{input:{type:'string'}}});
if(!values.input)throw new Error('Pass --input <saved-new-project.html>');
const root=resolve(import.meta.dirname,'..'),file=resolve(values.input);
const d=parseHTML(await readFile(file,'utf8')).document;
const modal=d.querySelector('[data-testid="modal-new-project-enhanced"]')?.closest('dialog');
if(!modal)throw new Error('Official new-project modal missing');
const picker=modal.querySelector('dialog');
picker.remove();
const icons={};
for(const label of picker.querySelectorAll('fieldset[aria-label="图标"] label')){
 const input=label.querySelector('input'),svg=label.querySelector('svg');
 icons[input.value]={label:label.textContent.trim(),svg:htmlSafeSvg(svg.outerHTML)};
}
for(const node of [modal,picker]){
 node.removeAttribute('open');
 for(const e of node.querySelectorAll('script,iframe,object,embed'))e.remove();
 for(const e of [node,...node.querySelectorAll('*')])for(const a of e.getAttributeNames())if(/^on/i.test(a))e.removeAttribute(a);
}
const stylesheets=[];
for(const link of d.querySelectorAll('link[rel=stylesheet]')){
 const href=link.getAttribute('href');if(!href||/^(https?:|\/\/)/.test(href))continue;
 const source=resolve(dirname(file),decodeURIComponent(href));let name=basename(source);
 const bytes=await readFile(source);let old;try{old=await readFile(join(root,'official-templates/assets',name))}catch{}
 if(old&&!old.equals(bytes))name='new-project-ref-'+name;
 if(!old||!old.equals(bytes))await cp(source,join(root,'official-templates/assets',name));
 if(!stylesheets.includes(name))stylesheets.push(name);
}
await writeFile(join(root,'official-templates/new-project.json'),JSON.stringify({version:1,source_mode:'frozen_package',modal:htmlSafeSvg(modal.outerHTML),picker:htmlSafeSvg(picker.outerHTML),icons,stylesheets},null,2));
console.log('Frozen create-project dialog and',Object.keys(icons).length,'icon choices.');
