import{marked,Lexer,Tokenizer}from'marked';import{parseHTML}from'linkedom';
// Keep Markdown layout and literal code; resource-bearing syntax becomes readable text.
export function markdownTextOnly(source,resources=[],depth=0){
 let text=String(source),prefix='CEOBEPLAINTEXTTOKEN';while(text.includes(prefix))prefix+='X';const saved=[];
 const pattern=raw=>new RegExp(raw.split('\n').map(line=>line.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\n[ \\t>]*'),'g');
 const replace=(raw,value)=>{text=text.includes(raw)?text.replaceAll(raw,()=>value):text.replace(pattern(raw),()=>value)};
 const protect=raw=>{const save=actual=>{const key=prefix+saved.length+'END';saved.push([key,actual]);return key};text=text.includes(raw)?text.replaceAll(raw,()=>save(raw)):text.replace(pattern(raw),match=>save(match))};
 marked.walkTokens(marked.lexer(text,{gfm:true}),t=>{if(t.type==='code'||t.type==='codespan')protect(t.raw)});
 for(const m of text.matchAll(/\\\[[\s\S]*?\\\]|\\\([^\n]*?\\\)/g))protect(m[0]);
 const definitions=[];class DefinitionTracker extends Tokenizer{def(src){const token=super.def(src);if(token)definitions.push(token.raw);return token}}
 const tokens=new Lexer({gfm:true,tokenizer:new DefinitionTracker()}).lex(text),edits=[];
 marked.walkTokens(tokens,t=>{
  if(t.type==='link'||t.type==='image'){
   let label=String(t.text||'');if(depth<12&&!(t.type==='link'&&t.text===t.href))label=markdownTextOnly(label,[],depth+1);
   // Bare URLs are retained as literal text, not auto-linkable dependencies.
   if(t.type==='link'&&t.text===t.href)label='`'+t.text.replaceAll('`','')+'`';
   edits.push([t.raw,label]);
  }else if(t.type==='html'){
   const d=parseHTML('<html><body></body></html>').document,h=d.createElement('div');h.innerHTML=t.raw;
   for(const e of h.querySelectorAll('script,style,iframe,object,embed,link,svg,source'))e.remove();
   for(const e of h.querySelectorAll('img'))e.replaceWith(d.createTextNode(e.getAttribute('alt')||''));
   for(const e of h.querySelectorAll('br'))e.replaceWith(d.createTextNode('\n'));
   edits.push([t.raw,h.textContent]);
  }
 });
 for(const raw of definitions)replace(raw,'');
 for(const [raw,value]of edits.sort((a,b)=>b[0].length-a[0].length))replace(raw,value);
 for(const resource of resources)for(const pointer of [...(resource.pointers||[]),resource.local_path].filter(p=>typeof p==='string'&&p.length>=8&&/[:/]/.test(p)))text=text.replaceAll(pointer,()=>resource.name||'');
 for(const [key,raw]of saved.reverse())text=text.replaceAll(key,()=>raw);
 return text;
}
