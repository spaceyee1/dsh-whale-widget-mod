import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {createHash,randomBytes} from 'node:crypto'

const FAILURE='本机加密凭据无法安全读写；请求未发送，请检查本机文件权限'
const KEY_DIRECTORY='.dshw-companion-keys'
const REF=/^DSHW_COMPANION_[a-f0-9]{24}_[a-f0-9]{24}$/
const OWNED_FILE=/^(DSHW_COMPANION_[a-f0-9]{24}_[a-f0-9]{24})\.dpapi(?:\.[0-9]{1,12}\.[a-f0-9]{16}\.tmp)?$/
const LIMIT=16384
const POWERSHELL='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
// The command is fixed. Neither a key nor a caller-provided string is evaluated
// as PowerShell code; the small JSON request is supplied exclusively on stdin.
const DPAPI_SCRIPT=String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$bytes=$null;$result=$null;$entropy=$null
try {
  Add-Type -AssemblyName System.Security
  $raw=[Console]::In.ReadToEnd()
  if($raw.Length -gt 12000){throw 'invalid'}
  $request=ConvertFrom-Json -InputObject $raw
  if($request.ref -cnotmatch '^DSHW_COMPANION_[a-f0-9]{24}_[a-f0-9]{24}$'){throw 'invalid'}
  $bytes=[Convert]::FromBase64String($request.data)
  $entropy=[Text.Encoding]::UTF8.GetBytes('DSHW_COMPANION_DPAPI_V1:'+ $request.ref)
  if($request.operation -ceq 'protect'){
    $result=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  }elseif($request.operation -ceq 'unprotect'){
    $result=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  }else{throw 'invalid'}
  [Console]::Out.Write([Convert]::ToBase64String($result))
}catch{[Console]::Error.Write('DPAPI failed');exit 1}
finally{
  if($bytes){[Array]::Clear($bytes,0,$bytes.Length)}
  if($result){[Array]::Clear($result,0,$result.Length)}
  if($entropy){[Array]::Clear($entropy,0,$entropy.Length)}
  $raw=$null;$request=$null
}`

function fail(){return Error(FAILURE)}
function validRef(ref){if(typeof ref!=='string'||!REF.test(ref))throw fail();return ref}
function validKey(value){if(typeof value!=='string'||value.length<8||value.length>1024||/[^\x21-\x7e]/.test(value))throw fail();return value}
function samePath(a,b){const x=path.resolve(a),y=path.resolve(b);return process.platform==='win32'?x.toLowerCase()===y.toLowerCase():x===y}
function sameIdentity(a,b){return a.dev===b.dev&&a.ino===b.ino}
function digest(bytes){return createHash('sha256').update(bytes).digest('hex')}
function safeDirectory(directory,fsImpl,{allowMissing=false}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw fail()
  const absolute=path.resolve(directory);let current=absolute,missing=false
  while(true){
    try{const stat=fsImpl.lstatSync(current,{bigint:true});if(stat.isSymbolicLink()||!stat.isDirectory())throw fail()}
    catch(error){if(error?.code!=='ENOENT'||!allowMissing||current!==absolute&&!missing)throw fail();missing=true}
    const parent=path.dirname(current);if(parent===current)break;current=parent
  }
  if(missing)return {canonical:absolute,missing:true}
  const canonical=fsImpl.realpathSync(absolute)
  if(!samePath(canonical,absolute))throw fail()
  const stat=fsImpl.lstatSync(canonical,{bigint:true})
  if(stat.isSymbolicLink()||!stat.isDirectory())throw fail()
  return {canonical,stat}
}
function fileInfo(filename,fsImpl,{allowMissing=false}={}){
  let stat
  try{stat=fsImpl.lstatSync(filename,{bigint:true})}catch(error){if(error?.code==='ENOENT'&&allowMissing)return undefined;throw fail()}
  if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1n||stat.size>BigInt(LIMIT)||!samePath(fsImpl.realpathSync(filename),filename))throw fail()
  return stat
}
function readFile(filename,fsImpl,expected){
  let fd
  try{
    const checked=fileInfo(filename,fsImpl)
    if(expected&&!sameIdentity(checked,expected))throw fail()
    fd=fsImpl.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
    const actual=fsImpl.fstatSync(fd,{bigint:true})
    if(!sameIdentity(actual,checked)||!actual.isFile()||actual.nlink!==1n||actual.size>BigInt(LIMIT))throw fail()
    const bytes=Buffer.alloc(Number(actual.size)+1);let count=0
    while(count<bytes.length){const n=fsImpl.readSync(fd,bytes,count,bytes.length-count,count);if(!n)break;count+=n}
    const after=fsImpl.fstatSync(fd,{bigint:true})
    if(count!==Number(actual.size)||!sameIdentity(after,actual)||after.size!==actual.size||after.mtimeNs!==actual.mtimeNs||after.ctimeNs!==actual.ctimeNs||after.nlink!==1n)throw fail()
    return {bytes:bytes.subarray(0,count),stat:after}
  }finally{if(fd!==undefined)try{fsImpl.closeSync(fd)}catch{}}
}
function decodeBase64(value){
  if(typeof value!=='string'||!value||value.length>LIMIT||!(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).test(value))throw fail()
  const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value)throw fail();return bytes
}

function runDpapi(operation,ref,bytes,{spawnImpl,timeoutMs,signal}){
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(fail());return}
    let child,timer,settled=false,size=0,stderrSize=0;const chunks=[]
    const input=Buffer.from(JSON.stringify({operation,ref,data:bytes.toString('base64')}),'utf8')
    const finish=(error,result)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);input.fill(0)
      for(const chunk of chunks)chunk.fill(0);chunks.length=0
      if(error){try{child?.kill()}catch{};reject(fail())}else resolve(result)
    }
    const abort=()=>finish(fail())
    try{
      child=spawnImpl(POWERSHELL,['-NoLogo','-NoProfile','-NonInteractive','-Command',DPAPI_SCRIPT],{windowsHide:true,stdio:['pipe','pipe','pipe'],cwd:'C:\\Windows\\System32',env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows'}})
      signal.addEventListener('abort',abort,{once:true})
      timer=setTimeout(()=>finish(fail()),timeoutMs);timer.unref?.()
      child.on('error',()=>finish(fail()))
      child.stdin.on('error',()=>finish(fail()))
      child.stdout.on('error',()=>finish(fail()));child.stderr.on('error',()=>finish(fail()))
      child.stdout.on('data',value=>{if(settled)return;size+=value.length;if(size>LIMIT){finish(fail());return}chunks.push(Buffer.from(value))})
      child.stderr.on('data',value=>{if(settled)return;stderrSize+=value.length;if(stderrSize>1024)finish(fail())})
      child.on('close',code=>{
        if(settled)return
        if(code!==0||stderrSize){finish(fail());return}
        try{const result=decodeBase64(Buffer.concat(chunks).toString('utf8'));finish(null,result)}catch{finish(fail())}
      })
      child.stdin.end(input,()=>input.fill(0))
      if(signal.aborted)abort()
    }catch{finish(fail())}
  })
}

// DPAPI protects the files for the current Windows account. It does not promise
// secrecy from code already executing with that account's rights or from an
// administrator; JavaScript strings and Windows paging are outside our control.
export class PersistentCredentials {
  #cache=new Map();#controllers=new Set();#tail=Promise.resolve();#epoch=0;#ready=false;#closed=false;#homeStat;#directoryStat
  constructor({home,fsImpl=fs,spawnImpl=spawn,timeoutMs=15000}={}){
    if(typeof home!=='string'||!path.isAbsolute(home)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw fail()
    this.home=path.resolve(home);this.directory=path.join(this.home,KEY_DIRECTORY);this.fs=fsImpl;this.spawn=spawnImpl;this.timeoutMs=timeoutMs
  }
  async initialize(){
    try{
      if(process.platform!=='win32'||this.#closed)throw fail()
      const original=safeDirectory(this.home,this.fs,{allowMissing:true})
      if(original.missing)this.fs.mkdirSync(this.home,{recursive:true,mode:0o700})
      const home=safeDirectory(this.home,this.fs)
      const originalDirectory=safeDirectory(this.directory,this.fs,{allowMissing:true})
      if(originalDirectory.missing)this.fs.mkdirSync(this.directory,{mode:0o700})
      const directory=safeDirectory(this.directory,this.fs),after=safeDirectory(this.home,this.fs)
      if(!sameIdentity(home.stat,after.stat)||!samePath(path.dirname(directory.canonical),home.canonical))throw fail()
      if(this.#ready&&(!sameIdentity(home.stat,this.#homeStat)||!sameIdentity(directory.stat,this.#directoryStat)))throw fail()
      this.#homeStat=home.stat;this.#directoryStat=directory.stat;this.#ready=true
      return {ok:true,error:''}
    }catch{this.#ready=false;this.clear();return {ok:false,error:FAILURE}}
  }
  #checkedDirectory(){
    if(!this.#ready||this.#closed)throw fail()
    const home=safeDirectory(this.home,this.fs),directory=safeDirectory(this.directory,this.fs)
    if(!sameIdentity(home.stat,this.#homeStat)||!sameIdentity(directory.stat,this.#directoryStat)||!samePath(path.dirname(directory.canonical),home.canonical))throw fail()
    return directory
  }
  #filename(ref){return path.join(this.directory,validRef(ref)+'.dpapi')}
  #forget(ref){const entry=this.#cache.get(ref);if(entry)entry.value='';this.#cache.delete(ref)}
  #enqueue(action){
    const epoch=this.#epoch,operation=this.#tail.then(async()=>{if(epoch!==this.#epoch)throw fail();this.#checkedDirectory();return action(epoch)})
    this.#tail=operation.catch(()=>{});return operation.catch(()=>{throw fail()})
  }
  async #crypt(operation,ref,bytes,epoch){
    const controller=new AbortController();this.#controllers.add(controller)
    try{const result=await runDpapi(operation,ref,bytes,{spawnImpl:this.spawn,timeoutMs:this.timeoutMs,signal:controller.signal});if(epoch!==this.#epoch){result.fill(0);throw fail()}return result}
    finally{this.#controllers.delete(controller)}
  }
  async resolve(ref){
    return this.#enqueue(async epoch=>{
      const filename=this.#filename(ref)
      try{
        if(!fileInfo(filename,this.fs,{allowMissing:true})){this.#forget(ref);return undefined}
        const {bytes,stat}=readFile(filename,this.fs);this.#checkedDirectory()
        const signature=[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs,digest(bytes)].join(':')
        const cached=this.#cache.get(ref);if(cached?.signature===signature)return {value:cached.value}
        this.#forget(ref)
        const envelope=JSON.parse(bytes.toString('utf8'))
        if(envelope?.version!==1||envelope.scope!=='CurrentUser'||envelope.ref!==ref||Object.keys(envelope).sort().join(',')!=='ciphertext,ref,scope,version')throw fail()
        const encrypted=decodeBase64(envelope.ciphertext),decrypted=await this.#crypt('unprotect',ref,encrypted,epoch)
        let value
        try{value=validKey(decrypted.toString('utf8'))}finally{decrypted.fill(0)}
        const latest=readFile(filename,this.fs);this.#checkedDirectory()
        if(!sameIdentity(stat,latest.stat)||!bytes.equals(latest.bytes))throw fail()
        this.#cache.set(ref,{value,signature});return {value}
      }catch{this.#forget(ref);throw fail()}
    })
  }
  async set(ref,value){
    validRef(ref);validKey(value)
    return this.#enqueue(async epoch=>{
      const plain=Buffer.from(value,'utf8');let encrypted
      try{encrypted=await this.#crypt('protect',ref,plain,epoch)}finally{plain.fill(0)}
      this.#checkedDirectory()
      const filename=this.#filename(ref),previous=fileInfo(filename,this.fs,{allowMissing:true})
      const bytes=Buffer.from(JSON.stringify({version:1,scope:'CurrentUser',ref,ciphertext:encrypted.toString('base64')}),'utf8');encrypted.fill(0)
      if(bytes.length>LIMIT)throw fail()
      const temp=filename+'.'+process.pid+'.'+randomBytes(8).toString('hex')+'.tmp';let fd,owned,committed=false
      try{
        fd=this.fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600)
        owned=this.fs.fstatSync(fd,{bigint:true})
        if(!owned.isFile()||owned.nlink!==1n)throw fail()
        this.fs.writeFileSync(fd,bytes);this.fs.fsyncSync(fd);this.fs.closeSync(fd);fd=undefined
        this.#checkedDirectory()
        const current=fileInfo(filename,this.fs,{allowMissing:true})
        if(!!previous!==!!current||current&&!sameIdentity(previous,current))throw fail()
        const staged=readFile(temp,this.fs,owned);if(!bytes.equals(staged.bytes))throw fail()
        this.#checkedDirectory();if(epoch!==this.#epoch)throw fail()
        this.fs.renameSync(temp,filename);committed=true
        const saved=readFile(filename,this.fs,owned);this.#checkedDirectory()
        if(!bytes.equals(saved.bytes))throw fail()
        const stat=saved.stat,signature=[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs,digest(saved.bytes)].join(':')
        this.#forget(ref);this.#cache.set(ref,{value,signature})
      }finally{
        if(fd!==undefined)try{this.fs.closeSync(fd)}catch{}
        if(!committed&&owned)try{this.#checkedDirectory();const leftover=fileInfo(temp,this.fs);if(sameIdentity(owned,leftover))this.fs.unlinkSync(temp)}catch{}
      }
    })
  }
  async unset(ref){
    validRef(ref);this.#forget(ref)
    return this.#enqueue(()=>{
      const filename=this.#filename(ref),previous=fileInfo(filename,this.fs,{allowMissing:true})
      if(!previous)return
      this.#checkedDirectory();const current=fileInfo(filename,this.fs)
      if(!sameIdentity(previous,current))throw fail()
      this.fs.unlinkSync(filename);this.#forget(ref)
    })
  }
  // Invoked only for an explicit user deletion. Also remove orphaned encrypted
  // files from a failed configuration transaction, never unrelated file names.
  async purge(){
    return this.#enqueue(()=>{
      const names=this.fs.readdirSync(this.directory);let failed=false
      for(const name of names){
        if(typeof name!=='string'||!OWNED_FILE.test(name))continue
        const ref=OWNED_FILE.exec(name)[1];this.#forget(ref)
        try{
          this.#checkedDirectory();const filename=path.join(this.directory,name),before=fileInfo(filename,this.fs)
          this.#checkedDirectory();const current=fileInfo(filename,this.fs)
          if(!sameIdentity(before,current))throw fail()
          this.fs.unlinkSync(filename)
        }catch{failed=true}
      }
      if(failed)throw fail()
    })
  }
  clear(){this.#closed=true;this.#epoch++;for(const controller of this.#controllers)controller.abort();for(const ref of this.#cache.keys())this.#forget(ref)}
}
