import fs from 'node:fs'
import path from 'node:path'

const STORAGE_ERROR='旧版插件隐私文件清理失败；外发请求已禁用，请检查本机文件权限'
const RETIRE_ERROR='旧版插件独立凭据未能安全清理；外发请求已禁用，请检查本机凭据存储'
const CONFIG_ERROR='插件 API 配置无法安全读写；外发请求已锁定，请检查路径与权限'
const API_CONFIG_NAME='.dshw-companion-api.json'
const CONFIG_LIMIT=16384
const LEGACY_CONTENT_FILES=Object.freeze([
  '.dshw-companion.json',
  '.dshw-companion-last.json',
  '.dshw-companion-debug.log',
  '.dshw-companion-debug.log.previous',
  '.dshw-companion-defaults.json',
])
const TEMP_BASES=[...LEGACY_CONTENT_FILES,'.dshw-companion-api.json']
const TEMP_NAME=new RegExp('^(?:'+TEMP_BASES.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')(?:\\.[0-9]{1,12})?\\.tmp$')

// This store deliberately has no host credential or filesystem dependency.
export class VolatileCredentials {
  #entries=new Map()
  constructor({ttlMs=30*60*1000,now=()=>Date.now(),setTimeoutImpl=setTimeout,clearTimeoutImpl=clearTimeout,onExpire=()=>{}}={}){
    if(!Number.isInteger(ttlMs)||ttlMs<1||ttlMs>2147483647)throw Error('内存凭据有效期无效')
    this.onExpire=onExpire;this.ttlMs=ttlMs;this.now=now;this.setTimer=setTimeoutImpl;this.clearTimer=clearTimeoutImpl
  }
  async resolve(ref){
    const entry=this.#entries.get(ref)
    if(!entry)return undefined
    if(this.now()>=entry.expiresAt){this.#remove(ref,entry);this.onExpire();return undefined}
    return {value:entry.value}
  }
  async set(ref,value){
    if(typeof ref!=='string'||!ref||ref.length>160||typeof value!=='string')throw Error('内存凭据格式无效')
    this.#remove(ref,this.#entries.get(ref))
    const entry={value,expiresAt:this.now()+this.ttlMs,timer:null}
    entry.timer=this.setTimer(()=>{if(this.#entries.get(ref)===entry){this.#remove(ref,entry);this.onExpire()}},this.ttlMs)
    entry.timer?.unref?.();this.#entries.set(ref,entry)
  }
  async unset(ref){this.#remove(ref,this.#entries.get(ref))}
  #remove(ref,entry){
    if(!entry)return
    this.clearTimer(entry.timer);entry.value='';this.#entries.delete(ref)
  }
  clear(){for(const [ref,entry] of this.#entries)this.#remove(ref,entry)}
}

function samePath(a,b){
  const x=path.resolve(a),y=path.resolve(b)
  return process.platform==='win32'?x.toLowerCase()===y.toLowerCase():x===y
}
function safeHome(home,fsImpl){
  if(typeof home!=='string'||!home||!path.isAbsolute(home))throw Error('unsafe home')
  const absolute=path.resolve(home)
  // Reject pre-existing symlinks/junctions anywhere in the directory chain.
  let current=absolute,missing=false
  while(true){
    try{
      const stat=fsImpl.lstatSync(current,{bigint:true})
      if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('unsafe directory')
    }catch(error){
      if(error?.code!=='ENOENT'||current!==absolute&&!missing)throw error
      missing=true
    }
    const parent=path.dirname(current);if(parent===current)break;current=parent
  }
  if(missing)return {canonical:absolute,missing:true}
  const canonical=fsImpl.realpathSync(absolute)
  if(!samePath(canonical,absolute))throw Error('unsafe canonical home')
  return {canonical,stat:fsImpl.lstatSync(canonical,{bigint:true})}
}

function configFile(home,fsImpl,{allowMissing=false}={}){
  const root=safeHome(home,fsImpl)
  if(root.missing){if(allowMissing)return {...root,target:path.join(root.canonical,API_CONFIG_NAME)};throw Error('missing home')}
  const target=path.join(root.canonical,API_CONFIG_NAME)
  let stat
  try{stat=fsImpl.lstatSync(target,{bigint:true})}catch(error){if(error?.code!=='ENOENT'||!allowMissing)throw error}
  if(stat&&(stat.isSymbolicLink()||!stat.isFile()||stat.nlink>1n||stat.size>BigInt(CONFIG_LIMIT)||!samePath(fsImpl.realpathSync(target),target)))throw Error('unsafe config')
  return {...root,target,fileStat:stat}
}

// Check the directory and config before reading: a failed safety check must not
// cause the plugin to follow a junction/symlink or silently overwrite a bad file.
export function readCompanionApiConfig(home,{fsImpl=fs}={}){
  let fd
  try{
    const checked=configFile(home,fsImpl,{allowMissing:true})
    if(checked.missing||!checked.fileStat)return {ok:true,config:{},error:''}
    fd=fsImpl.openSync(checked.target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
    const actual=fsImpl.fstatSync(fd,{bigint:true})
    if(actual.dev!==checked.fileStat.dev||actual.ino!==checked.fileStat.ino||!actual.isFile()||actual.nlink>1n||actual.size>BigInt(CONFIG_LIMIT))throw Error('changed config')
    const bytes=Buffer.alloc(CONFIG_LIMIT+1),size=fsImpl.readSync(fd,bytes,0,bytes.length,0)
    if(size>CONFIG_LIMIT)throw Error('large config')
    const config=JSON.parse(bytes.subarray(0,size).toString('utf8').replace(/^\uFEFF/,''))
    if(!config||typeof config!=='object'||Array.isArray(config))throw Error('invalid config')
    return {ok:true,config,error:''}
  }catch{return {ok:false,config:{},error:CONFIG_ERROR}}
  finally{if(fd!==undefined)try{fsImpl.closeSync(fd)}catch{}}
}

export function writeCompanionApiConfig(home,value,{fsImpl=fs}={}){
  let temp,fd,ownedStat
  try{
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid config')
    const serialized=JSON.stringify(value,null,2)
    if(Buffer.byteLength(serialized)>CONFIG_LIMIT)throw Error('large config')
    const initial=configFile(home,fsImpl,{allowMissing:true})
    if(initial.missing){fsImpl.mkdirSync(initial.canonical,{recursive:true});safeHome(initial.canonical,fsImpl)}
    const checked=configFile(home,fsImpl,{allowMissing:true})
    temp=checked.target+'.'+process.pid+'.tmp'
    fd=fsImpl.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600)
    ownedStat=fsImpl.fstatSync(fd,{bigint:true})
    fsImpl.writeFileSync(fd,serialized,'utf8');fsImpl.fsyncSync(fd);fsImpl.closeSync(fd);fd=undefined
    const current=configFile(home,fsImpl,{allowMissing:true})
    if(current.stat.dev!==checked.stat.dev||current.stat.ino!==checked.stat.ino||!!current.fileStat!==!!checked.fileStat||current.fileStat&&(current.fileStat.dev!==checked.fileStat.dev||current.fileStat.ino!==checked.fileStat.ino))throw Error('changed config')
    const staged=fsImpl.lstatSync(temp,{bigint:true})
    if(staged.isSymbolicLink()||!staged.isFile()||staged.nlink!==1n||staged.dev!==ownedStat.dev||staged.ino!==ownedStat.ino||!samePath(fsImpl.realpathSync(temp),temp))throw Error('changed staged config')
    fsImpl.renameSync(temp,checked.target);temp=undefined
    return true
  }catch{return false}
  finally{
    if(fd!==undefined)try{fsImpl.closeSync(fd)}catch{}
    // Only remove our own newly created temp file; never remove an existing
    // attacker-created file when exclusive creation failed.
    if(temp&&ownedStat)try{
      const current=safeHome(home,fsImpl),leftover=fsImpl.lstatSync(temp,{bigint:true})
      if(!current.missing&&path.dirname(temp)===current.canonical&&!leftover.isSymbolicLink()&&leftover.dev===ownedStat.dev&&leftover.ino===ownedStat.ino)fsImpl.unlinkSync(temp)
    }catch{}
  }
}

// Only known plugin-owned content and precisely named atomic-write leftovers.
// Never copy sensitive content into a backup or enumerate host credentials.
export function cleanupLegacyCompanionFiles(home,{fsImpl=fs}={}){
  let removedCount=0,failed=false,root
  try{root=safeHome(home,fsImpl)}catch{return {ok:false,removedCount,error:STORAGE_ERROR}}
  if(root.missing)return {ok:true,removedCount,error:''}
  const names=new Set(LEGACY_CONTENT_FILES)
  try{for(const name of fsImpl.readdirSync(root.canonical))if(typeof name==='string'&&TEMP_NAME.test(name))names.add(name)}catch{failed=true}
  for(const name of names){
    try{
      const target=path.join(root.canonical,name)
      if(path.dirname(target)!==root.canonical||path.relative(root.canonical,target)!==name)throw Error('unsafe target')
      const current=safeHome(root.canonical,fsImpl)
      if(current.missing||!samePath(current.canonical,root.canonical)||current.stat.dev!==root.stat.dev||current.stat.ino!==root.stat.ino)throw Error('changed directory')
      const stat=fsImpl.lstatSync(target,{bigint:true})
      if(stat.isSymbolicLink()||!stat.isFile()||!samePath(fsImpl.realpathSync(target),target))throw Error('unsafe file')
      fsImpl.unlinkSync(target);removedCount++
    }catch(error){if(error?.code!=='ENOENT')failed=true}
  }
  return {ok:!failed,removedCount,error:failed?STORAGE_ERROR:''}
}

// Retirement is the sole allowed host credential operation: no secret read.
export async function retireLegacyKey(config,credentials){
  const result=(ok,retired=false)=>({ok,retired,error:ok?'':RETIRE_ERROR})
  try{
    const ref=config?.keyRef
    if(ref===undefined||ref===null||ref==='')return result(true)
    if(typeof ref!=='string'||!/^DSHW_COMPANION_[a-f0-9]{24}_(?:[a-f0-9]{24}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(ref)||typeof credentials?.unset!=='function')return result(false)
    if(await credentials.unset(ref)===false)return result(false)
    return result(true,true)
  }catch{return result(false)}
}
