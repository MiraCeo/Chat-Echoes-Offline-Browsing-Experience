// A project file is a library resource referenced by at least one current member chat.
// Legacy manual source_refs intentionally do not participate.
export function projectFiles(catalog,project,chats){
 if(!project)return [];
 const chatMap=new Map(chats.map(c=>[c.id,c])),members=new Set(project.conversation_ids||[]);
 return catalog.flatMap(item=>{
  const sources=(item.sources||[]).filter(s=>members.has(s.id)&&chatMap.has(s.id)).map(s=>({...s,title:chatMap.get(s.id).title||s.title}));
  if(!sources.length)return [];
  const names=[...new Set(sources.flatMap(s=>s.names?.length?s.names:[s.name||item.name]))];
  return [{...item,name:sources[0].name||names[0]||item.name,names,sources,date:sources.map(s=>s.date||item.date).sort().at(-1)}];
 });
}
