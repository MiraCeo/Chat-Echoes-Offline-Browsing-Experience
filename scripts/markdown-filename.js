export function markdownFilename(title){
 let name=[...String(title||'聊天').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').trim().replace(/[. ]+$/g,'')].slice(0,120).join('');
 if(!name)name='聊天';if(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))name='_'+name;
 return name+'.md';
}
