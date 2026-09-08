import {mkdir,open,unlink,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
export async function acquireMutation(root){
 for(const part of ['data','data/private']){try{if((await lstat(join(root,part))).isSymbolicLink())throw new Error('拒绝通过符号链接写入私有数据')}catch(e){if(e.code!=='ENOENT')throw e}}
 const jobs=await readdir(join(root,'data/private/delete-jobs')).catch(e=>{if(e.code==='ENOENT')return [];throw e});if(jobs.length)throw Object.assign(new Error('存在未完成的删除任务，请检查恢复记录后再操作'),{status:409});
 const dir=join(root,'data/private');await mkdir(dir,{recursive:true});const path=join(dir,'mutation.lock');
 let file;try{file=await open(path,'wx')}catch(e){if(e.code==='EEXIST')throw Object.assign(new Error('工作区正在写入或有未完成的操作，请稍后重试；异常退出后请检查 mutation.lock'),{status:409});throw e}
 await file.writeFile(JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));await file.close();
 return ()=>unlink(path);
}
