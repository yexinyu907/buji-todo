const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {normalizeImage}=require('./reminder-avatar');
const LIMIT=50;
class ReminderGallery {
  constructor(directory,decode,builtins,legacyEnabled=()=>false){this.directory=path.join(directory,'reminder-gallery');this.manifest=path.join(this.directory,'gallery.json');this.legacy=path.join(directory,'reminder-avatar.png');this.decode=decode;this.builtins=builtins;this.legacyEnabled=legacyEnabled;}
  defaults(){return Array.from({length:6},(_,i)=>({id:'cat-'+(i+1),kind:'builtin',name:'小猫 '+(i+1)}));}
  file(entry){return entry.kind==='builtin'?path.join(this.builtins,'cat'+entry.id.slice(4)+'.png'):path.join(this.directory,entry.id+'.png');}
  persist(entries){fs.mkdirSync(this.directory,{recursive:true});fs.writeFileSync(this.manifest+'.tmp',JSON.stringify({version:1,entries},null,2),{mode:0o600});fs.renameSync(this.manifest+'.tmp',this.manifest);this.entries=entries;}
  load(){
    if(this.entries)return this.entries;
    try{const d=JSON.parse(fs.readFileSync(this.manifest,'utf8'));const ids=new Set();
      if(d.version!==1||!Array.isArray(d.entries)||!d.entries.length||d.entries.length>LIMIT)throw Error('invalid gallery');
      for(const e of d.entries){if(!e||typeof e.name!=='string'||e.name.length>100||ids.has(e.id)||!(e.kind==='builtin'&&/^cat-[1-6]$/.test(e.id)||e.kind==='custom'&&/^[a-f0-9-]{36}$/.test(e.id)))throw Error('invalid gallery');ids.add(e.id);}
      this.entries=d.entries;return this.entries;
    }catch(error){if(error.code!=='ENOENT')throw new Error('提醒图库无法读取，原文件已保留。');}
    const initial=this.defaults();let copied;
    try{
      if(this.legacyEnabled()&&fs.existsSync(this.legacy)){const id=crypto.randomUUID(),entry={id,kind:'custom',name:'之前上传的形象'};const png=normalizeImage(fs.readFileSync(this.legacy),this.decode);fs.mkdirSync(this.directory,{recursive:true});copied=this.file(entry);fs.writeFileSync(copied,png,{flag:'wx',mode:0o600});initial.push(entry);}
      this.persist(initial);return this.entries;
    }catch(error){if(copied&&fs.existsSync(copied))fs.unlinkSync(copied);throw error;}
  }
  describe(entry){
    const bytes=fs.readFileSync(this.file(entry)),image=this.decode(bytes);if(image.isEmpty())throw new Error('提醒图片无法读取。');
    const bitmap=image.toBitmap();let framed=true;for(let i=3;i<bitmap.length;i+=4)if(bitmap[i]<255){framed=false;break;}
    return {...entry,src:'data:image/png;base64,'+bytes.toString('base64'),framed};
  }
  list(){return this.load().map(e=>this.describe(e));}
  summary(){const entries=this.load();return {count:entries.length,avatar:this.describe(entries[0])};}
  pick(random=Math.random){const entries=this.load(),pool=entries.length>1?entries.filter(e=>e.id!==this.lastPicked):entries;const chosen=pool[Math.min(pool.length-1,Math.max(0,Math.floor(random()*pool.length)))];this.lastPicked=chosen.id;return this.describe(chosen);}
  canAdd(count){if(!Number.isInteger(count)||count<1||this.load().length+count>LIMIT)throw new Error('图库最多保留 50 个形象，请先删减后再上传。');}
  add(items){
    if(!Array.isArray(items))throw new Error('图片列表无效。');this.canAdd(items.length);
    const prepared=items.map(item=>({entry:{id:crypto.randomUUID(),kind:'custom',name:typeof item.name==='string'?item.name.slice(0,100):'上传图片'},bytes:normalizeImage(item.bytes,this.decode)}));
    const written=[];
    try{for(const {entry,bytes}of prepared){const file=this.file(entry);fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});written.push(file);}this.persist([...this.load(),...prepared.map(p=>p.entry)]);}
    catch(error){for(const file of written)if(fs.existsSync(file))fs.unlinkSync(file);throw error;}
    return this.list();
  }
  remove(ids){
    const before=this.load();if(!Array.isArray(ids)||ids.some(id=>!before.some(e=>e.id===id)))throw new Error('请选择图库中的形象。');
    const selected=new Set(ids),next=before.filter(e=>!selected.has(e.id));if(!next.length)throw new Error('请至少保留一个形象。');
    this.persist(next);for(const e of before)if(selected.has(e.id)&&e.kind==='custom'){try{fs.unlinkSync(this.file(e));}catch(error){if(error.code!=='ENOENT')throw error;}}
    return this.list();
  }
  addDefaults(){const entries=this.load(),extra=this.defaults().filter(e=>!entries.some(old=>old.id===e.id));if(!extra.length)return this.list();this.canAdd(extra.length);this.persist([...entries,...extra]);return this.list();}
}
module.exports={ReminderGallery,LIMIT};
