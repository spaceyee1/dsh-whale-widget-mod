import {assertDestination,inspectOutbound,redactSecrets} from './privacy-firewall.mjs'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import {createHash,randomUUID} from 'node:crypto'

// Other widget features must not reuse or overwrite endpoint-bound interjection keys.
export function nonCompanionRef(ref){
  if(String(ref).trim().toUpperCase().startsWith('DSHW_COMPANION_'))throw Error('此凭据仅限插件 API 配置使用')
  return ref
}

export const PROVIDERS=Object.freeze({
  deepseek:{label:'DeepSeek',baseUrl:'https://api.deepseek.com',protocol:'chat',defaultModel:''},
  openai:{label:'OpenAI',baseUrl:'https://api.openai.com/v1',protocol:'chat',defaultModel:''},
  gemini:{label:'Google Gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',protocol:'chat',defaultModel:''},
  anthropic:{label:'Anthropic Claude',baseUrl:'https://api.anthropic.com/v1',protocol:'anthropic',defaultModel:''},
  custom:{label:'自定义服务（厂商未验证）',baseUrl:'',protocol:'chat',defaultModel:''}
})
export function inferProvider(key){
  if(/^sk-ant-/.test(key))return 'anthropic'
  if(/^sk-(proj|svcacct)-/.test(key))return 'openai'
  if(/^AIza[\w-]{20,}$/.test(key))return 'gemini'
  return null // A generic sk- prefix is shared by unrelated providers.
}
function assertKeyProvider(key,provider){
  const inferred=inferProvider(key)
  if(provider!=='custom'&&inferred&&inferred!==provider){
    const error=Error('Key 格式提示与所选官方服务商不一致；为避免误发，请核对服务商或使用已确认的自定义接口')
    error.code='API_PROVIDER_MISMATCH';throw error
  }
}
export function publicAddress(address){
  if(net.isIP(address)===4){
    const [a,b,c]=address.split('.').map(Number)
    return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113)
  }
  if(net.isIP(address)===6){
    const a=address.toLowerCase()
    // Only native global unicast; reject mapped/translated/tunneled IPv4 and local ranges.
    const second=parseInt(a.split(':')[1]||'0',16)
    if(!/^[23][0-9a-f]{0,3}:/.test(a)||a.startsWith('2002:')||a.startsWith('3fff:')||a.startsWith('2001:')&&(second<0x200||second===0xdb8))return false
    return true
  }
  return false
}
export function normalizeEndpoint(raw,maxLength=400){
  if(typeof raw!=='string'||raw.length>maxLength||/[\s\\%]/.test(raw))throw Error('API 地址格式无效')
  let u;try{u=new URL(raw)}catch{throw Error('请输入完整 HTTPS API 基础地址')}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port&&u.port!=='443')throw Error('API 地址仅支持 HTTPS 443，不允许账号、查询参数或片段')
  const host=u.hostname.toLowerCase();if(net.isIP(host.replace(/^\[|\]$/g,''))||!host.includes('.')||host.endsWith('.')||/(^|\.)(localhost|local|internal|test|invalid)$/.test(host))throw Error('API 地址必须是公网域名，不能使用本机或内网地址')
  if(!/^[a-zA-Z0-9/_.~-]*$/.test(u.pathname))throw Error('API 地址路径无效')
  u.pathname=u.pathname.replace(/\/+$/,'');return u.href.replace(/\/$/,'')
}
const binding=c=>createHash('sha256').update(c.provider+'\n'+c.protocol+'\n'+c.baseUrl).digest('hex').slice(0,24)
function validKey(key){if(typeof key!=='string'||key.length<8||key.length>1024||/[^\x21-\x7e]/.test(key))throw Error('API Key 格式无效');return key}
export function validateApiConfig(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('API 设置格式无效')
  const provider=input.provider||'deepseek',preset=PROVIDERS[provider];if(!preset)throw Error('请选择服务商')
  const baseUrl=normalizeEndpoint(input.baseUrl||preset.baseUrl)
  if(provider!=='custom'&&baseUrl!==preset.baseUrl)throw Error('官方服务地址不能修改；第三方接口请选择自定义')
  const protocol=provider==='custom'||provider==='openai'?(input.protocol||'chat'):preset.protocol
  if(!['chat','responses','anthropic'].includes(protocol))throw Error('请选择支持的接口协议')
  if(provider==='openai'&&protocol==='anthropic')throw Error('OpenAI 官方接口不支持 Claude Messages 协议')
  const model=input.model??preset.defaultModel
  if(typeof model!=='string'||model.length>160||model&&!/^[a-zA-Z0-9][a-zA-Z0-9/_.:@+-]*$/.test(model))throw Error('模型 ID 无效')
  const c={provider,baseUrl,protocol,model,jsonMode:input.jsonMode!==false,keyRef:input.keyRef||'',confirmedBaseUrl:input.confirmedBaseUrl===baseUrl?baseUrl:''}
  if(typeof c.keyRef!=='string'||c.keyRef&&!new RegExp('^DSHW_COMPANION_'+binding(c)+'_[a-f0-9]{24}$').test(c.keyRef))throw Error('密钥与服务地址不匹配，请重新填写 API Key')
  return c
}
function abortable(promise,signal){
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(Error('API 请求已取消'))
    signal.addEventListener('abort',abort,{once:true})
    if(signal.aborted)abort()
    Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
  })
}

// Resolve and validate every address on the actual socket lookup; no separate check/connect race.
// https.request bypasses automatic HTTP(S)_PROXY handling and never follows redirects.
const TRANSPORT_MESSAGES=Object.freeze({
 API_FAKE_IP:'API 域名被解析为代理 Fake-IP（198.18/15），插件已拦截。请在代理软件中将 API 域名设为返回真实 IP（Fake-IP 排除规则），然后重试；不要关闭证书验证。',
 API_RESTRICTED_DNS:'API 域名解析到本机或受限网络地址，插件已拦截；请检查 DNS 或代理配置。',
 ENOTFOUND:'API 域名无法解析，请检查地址与 DNS 设置。',
 EAI_AGAIN:'API 域名解析暂时失败，请检查网络后重试。',
 ECONNREFUSED:'API 连接被拒绝，请检查网络与代理设置。',
 ECONNRESET:'API 连接被中断，请检查网络与代理设置。',
 ETIMEDOUT:'API 连接超时，请检查网络与代理设置。',
 CERT_HAS_EXPIRED:'API 证书已过期，请检查系统时间并联系接口服务商。',
 DEPTH_ZERO_SELF_SIGNED_CERT:'API 使用不受信任的自签名证书，请检查接口或网络代理。',
 UNABLE_TO_VERIFY_LEAF_SIGNATURE:'API 证书链无法验证，请检查接口证书或网络代理。',
 ERR_TLS_CERT_ALTNAME_INVALID:'API 证书域名不匹配，请核对接口地址与网络代理。',
 API_INVALID_JSON:'API 返回的内容不是有效 JSON，可能访问到了网页或代理拦截页；请核对 API 基础地址。'
});
export function transportFailure(code){return Object.assign(Error(TRANSPORT_MESSAGES[code]||'API 连接失败，请检查网络、地址和证书'),{code:TRANSPORT_MESSAGES[code]?code:'API_NETWORK'})}
export function secureJSON(url,{method='GET',headers={},body,signal,lookup=dns.lookup}={}){
  return new Promise((resolve,reject)=>{
    if(typeof url!=='string')throw Error('API 地址格式无效')
    const u=new URL(url)
    // Validate the original URL rather than dropping userinfo, fragments or encoded paths.
    if(u.hash||u.username||u.password)throw Error('API 地址格式无效')
    normalizeEndpoint(url.split('?')[0],1024)
    if(u.search){let cursor;try{cursor=decodeURIComponent(u.search.slice('?after_id='.length))}catch{}
      if(!u.search.startsWith('?after_id=')||typeof cursor!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9/_.:@+-]{0,159}$/.test(cursor)||'?after_id='+encodeURIComponent(cursor)!==u.search)throw Error('API 地址参数无效')}
    if(signal?.aborted)throw Error('API 请求已取消')
    let serialized
    try{if(body!==undefined)serialized=JSON.stringify(body)}catch{throw Error('API 请求内容格式无效')}
    let req,response,settled=false,ended=false
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(deadline);if(error){response?.destroy?.();req?.destroy?.();reject(error)}else resolve(value)}
    const fail=error=>finish(transportFailure(error?.code))
    // Socket inactivity alone does not bound a stalled DNS lookup.
    const deadline=setTimeout(()=>fail({code:'ETIMEDOUT'}),60000);deadline.unref?.()
    try{req=https.request(u,{method,headers,signal,rejectUnauthorized:true,agent:false,lookup:(hostname,options,callback)=>{
      lookup(hostname,{all:true,verbatim:true},(error,records)=>{
        if(error)return callback(error)
        if(!records?.length)return callback(transportFailure('ENOTFOUND'))
        if(records.some(r=>/^198\.(18|19)\./.test(r.address)))return callback(transportFailure('API_FAKE_IP'))
        if(records.some(r=>!publicAddress(r.address)))return callback(transportFailure('API_RESTRICTED_DNS'))
        const list=options.family?records.filter(r=>r.family===options.family):records;if(!list.length)return callback(Error('地址族不可用'))
        if(options.all)callback(null,list);else callback(null,list[0].address,list[0].family)
      })
    }},res=>{
      response=res
      res.on('error',fail);res.on('aborted',fail);res.on('close',()=>{if(!ended)fail()})
      if(res.statusCode<200||res.statusCode>=300){finish(Error('API 请求失败（HTTP '+res.statusCode+'）；请核对地址、Key、模型及协议'));return}
      let bytes=0;const chunks=[]
      res.on('data',part=>{if(settled)return;bytes+=part.length;if(bytes>2*1024*1024)finish(Error('API 响应超过大小限制'));else chunks.push(part)})
      res.on('end',()=>{ended=true;if(settled)return;try{finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{finish(transportFailure('API_INVALID_JSON'))}})
    });req.on('error',fail);req.setTimeout(60000,()=>fail({code:'ETIMEDOUT'}));if(settled){req.destroy?.();return}if(serialized!==undefined)req.write(serialized);req.end()}catch{fail()}
  })
}

export class CompanionApi {
  constructor({config={},credentials,saveConfig,request=secureJSON,onChange=()=>{},beforeRequest=async()=>{},afterRemove=async()=>{},privacyMode=false,privacyStatus=()=>({enabled:privacyMode,ready:true})}){
    this.beforeRequest=beforeRequest;this.afterRemove=afterRemove;this.privacyMode=privacyMode;this.privacyStatus=privacyStatus;this.credentials=credentials;this.saveConfig=saveConfig;this.request=request;this.onChange=onChange;this.queue=Promise.resolve();this.controllers=new Set();this.revision=0;this.modelCache=null;this.storageFault=''
    try{this.config=validateApiConfig(config);this.error=''}catch{this.config=validateApiConfig({});this.error='API 设置无效，请重新保存；原文件保留'}
  }
  async status(){
    const snapshot=this.config
    let keyState='empty'
    if(snapshot.keyRef){
      try{const value=(await this.credentials.resolve(snapshot.keyRef))?.value
        if(value===undefined||value===null||value==='')keyState='missing'
        else{validKey(value);assertKeyProvider(value,snapshot.provider);keyState='saved'}
      }catch{keyState='unreadable'}
    }
    if(snapshot!==this.config)return this.status()
    const keyError=keyState==='missing'?'本地已保存的 API Key 文件不存在，外发已停止；请删除插件 Key 后重新填写':keyState==='unreadable'?'本地已保存的 API Key 无法安全读取，外发已停止；请删除插件 Key 后重新填写':''
    const {keyRef,...config}=snapshot,hasKey=keyState==='saved',privacy={...this.privacyStatus()}
    const error=this.storageFault||this.error||keyError
    const destinationConfirmed=!this.privacyMode||config.confirmedBaseUrl===config.baseUrl
    const requestAvailable=hasKey&&!!config.model&&destinationConfirmed&&(!this.privacyMode||privacy.ready===true)&&!error
    privacy.egressEnabled=requestAvailable
    if(!privacy.notice&&keyError)privacy.notice=keyError
    return {ok:true,...config,privacy,providerLabel:PROVIDERS[config.provider].label,hasKey,keyState,error,providers:PROVIDERS,configured:requestAvailable,requestAvailable}
  }
  lock(fn){const result=this.queue.then(fn);this.queue=result.catch(()=>{});return result}
  invalidate(){this.revision++;this.modelCache=null;for(const c of this.controllers)c.abort();this.onChange()}
  configure(input){return this.lock(async()=>{
    if(this.storageFault)throw Error(this.storageFault)
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('API 设置格式无效')
    if(this.privacyMode)await this.beforeRequest()
    const key=typeof input.key==='string'?input.key.trim():''
    let provider=input.provider||this.config.provider
    if(provider==='auto'){provider=inferProvider(key);if(!provider)throw Error('仅凭此 Key 无法确定服务商，请手动选择；没有发送探测请求')}
    const candidate=validateApiConfig({provider,baseUrl:input.baseUrl,protocol:input.protocol,model:input.model,jsonMode:input.jsonMode})
    const same=binding(candidate)===binding(this.config)
    const confirmation=typeof input.confirmEndpoint==='string'&&input.confirmEndpoint?normalizeEndpoint(input.confirmEndpoint):''
    if(!same&&!key)throw Error('更换服务商、协议或地址后必须重新填写 Key，不能转发旧 Key')
    if(candidate.provider==='custom'&&(!same||key)&&confirmation!==candidate.baseUrl)throw Error('请确认自定义地址；此服务器会收到填写的 Key 和对话内容')
    if(key){validKey(key);assertKeyProvider(key,provider)}
    if(!key&&!this.config.keyRef)throw Error('请填写此插件使用的 API Key')
    const confirmed=confirmation===candidate.baseUrl
    if(this.privacyMode&&(!same||key||!this.config.confirmedBaseUrl)&&!confirmed)throw Error('请确认所选 API 将接收经隐私检查的近期对话')
    candidate.confirmedBaseUrl=confirmed||same&&this.config.confirmedBaseUrl?candidate.baseUrl:''
    inspectOutbound([{role:'user',content:candidate.baseUrl+'\n'+candidate.model}],key)
    if(this.config.keyRef){const old=(await this.credentials.resolve(this.config.keyRef))?.value;if(old)inspectOutbound([{role:'user',content:candidate.baseUrl+'\n'+candidate.model}],old)}
    this.invalidate();const previous=this.config
    candidate.keyRef=key?'DSHW_COMPANION_'+binding(candidate)+'_'+randomUUID().replaceAll('-','').slice(0,24):previous.keyRef
    if(key){try{await this.credentials.set(candidate.keyRef,key)}catch{
      try{await this.credentials.unset(candidate.keyRef)}catch{this.storageFault='本地 Key 保存及清理失败，外发已锁定；请手动删除插件 Key 后重新保存'}
      throw Error(this.storageFault||'独立 API Key 保存失败')
    }}
    try{if(this.saveConfig(candidate)===false)throw Error('save')}catch{
      if(key)try{await this.credentials.unset(candidate.keyRef)}catch{this.storageFault='本地 Key 存储清理失败，外发已锁定；请手动删除插件 Key 后重新保存'}
      throw Error(this.storageFault||'API 配置保存失败，旧配置未更换')
    }
    this.config=candidate;this.error=''
    if(key&&previous.keyRef&&previous.keyRef!==candidate.keyRef)try{await this.credentials.unset(previous.keyRef)}catch{this.storageFault='旧本地 Key 存储清理失败，外发已锁定；请手动删除插件 Key 后重新保存'}
    return this.status()
  })}
  remove(){return this.lock(async()=>{
    this.invalidate();const ref=this.config.keyRef
    try{if(typeof this.credentials.purge==='function')await this.credentials.purge();else if(ref)await this.credentials.unset(ref)}catch{this.storageFault='本地插件 Key 删除失败，外发已锁定；请检查存储权限后重试';throw Error(this.storageFault)}
    const next={...this.config,keyRef:''}
    try{if(this.saveConfig(next)===false)throw Error('save')}catch{throw Error('Key 已删除，但配置状态保存失败')}
    this.config=next;this.error=''
    try{await this.afterRemove(next)}catch{this.storageFault='本地存储安全检查未通过，外发已锁定；请检查 Windows 账户、路径与权限';throw Error(this.storageFault)}
    this.storageFault='';return this.status()
  })}
  async call(config,relative,{body,signal,method='GET'}={}){
    if(this.storageFault)throw Error(this.storageFault)
    config=validateApiConfig(config)
    const url=assertDestination(config,relative,method)
    if(this.privacyMode&&config.confirmedBaseUrl!==config.baseUrl)throw Error('隐私防火墙：请先确认此 API 目的地')
    if(['provider','baseUrl','protocol','model','jsonMode','keyRef','confirmedBaseUrl'].some(k=>config[k]!==this.config[k]))throw Error('API 配置已更换，请重新请求')
    const revision=this.revision,controller=new AbortController();this.controllers.add(controller)
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()
    const timer=setTimeout(abort,60000);timer.unref?.()
    try{
      if(controller.signal.aborted)throw Error('API 请求已取消')
      await abortable(this.beforeRequest(),controller.signal)
      if(controller.signal.aborted||revision!==this.revision)throw Error('API 请求已取消')
      let key;try{key=(await abortable(this.credentials.resolve(config.keyRef),controller.signal))?.value}catch{throw Error('本地已保存的 API Key 无法安全读取，外发已停止；请删除插件 Key 后重新填写')}
      if(!key||!config.keyRef)throw Error(config.keyRef?'本地已保存的 API Key 文件不存在，外发已停止；请删除插件 Key 后重新填写':'请先在“插件 API”中填写自己的 API Key')
      validKey(key);assertKeyProvider(key,config.provider);if(controller.signal.aborted||revision!==this.revision)throw Error('API 请求已取消')
      if(body)inspectOutbound([{role:'user',content:JSON.stringify(body)}],key)
      const headers=config.protocol==='anthropic'?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{Authorization:'Bearer '+key}
      let data
      try{data=await abortable(this.request(url,{method,headers:{...headers,'Content-Type':'application/json'},body,signal:controller.signal}),controller.signal)}
      catch(error){if(controller.signal.aborted)throw Error('API 请求超时或已取消');if(TRANSPORT_MESSAGES[error?.code])throw transportFailure(error.code);const http=/HTTP (\d{3})/.exec(String(error.message));throw Error(http?'API 请求失败（HTTP '+http[1]+'）；请检查 Key、模型、额度和协议':'API 请求失败；请检查地址、网络、证书及响应格式')}
      if(controller.signal.aborted||revision!==this.revision)throw Error('API 请求已取消')
      return redactSecrets(data,key)
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.controllers.delete(controller)}
  }
  models(){
    if(this.modelsPending?.revision===this.revision)return this.modelsPending.promise
    const pending={revision:this.revision};this.modelsPending=pending
    pending.promise=this.listModels().finally(()=>{if(this.modelsPending===pending)this.modelsPending=null})
    return pending.promise
  }
  async listModels(){
    await this.queue;const config={...this.config},revision=this.revision
    const models=[],seen=new Set();let suffix='models',truncated=false
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);timer.unref?.()
    this.controllers.add(controller)
    try{
    await abortable(this.beforeRequest(),controller.signal)
    const state=await abortable(this.status(),controller.signal)
    if(controller.signal.aborted||revision!==this.revision)throw Error('API 配置已更换，请重新获取模型')
    if(!state.hasKey||state.error)throw Error(state.error||'请先在“插件 API”中填写自己的 API Key')
    if(this.privacyMode&&config.confirmedBaseUrl!==config.baseUrl)throw Error('隐私防火墙：请先确认此 API 目的地')
    if(this.modelCache&&Date.now()-this.modelCache.at<30000)return this.modelCache.value
    for(let page=0;page<5;page++){
      const result=await this.call(config,suffix,{signal:controller.signal});if(!Array.isArray(result.data))throw Error('接口未提供可用模型列表，请手动填写模型 ID')
      for(const row of result.data){const id=row?.id;if(typeof id==='string'&&id.length<=160&&/^[a-zA-Z0-9][a-zA-Z0-9/_.:@+-]*$/.test(id)&&!seen.has(id)){
        if(models.length===1000){truncated=true;break}
        seen.add(id);models.push({id})
      }}
      if(truncated)break
      if(config.protocol!=='anthropic'||!result.has_more)break
      if(models.length===1000){truncated=true;break}
      if(typeof result.last_id!=='string'||result.last_id.length>160)throw Error('模型列表分页字段无效')
      suffix='models?after_id='+encodeURIComponent(result.last_id);truncated=page===4
    }
    if(revision!==this.revision)throw Error('API 配置已更换，请重新获取模型')
    const value={ok:true,models,truncated,model:config.model,baseUrl:config.baseUrl,provider:config.provider};this.modelCache={at:Date.now(),value};return value
    }finally{clearTimeout(timer);this.controllers.delete(controller)}
  }
  async complete({messages,maxTokens,signal}){
    await this.queue;const c={...this.config};validateApiConfig(c)
    if(!c.model)throw Error('请先选择或填写插件使用的模型')
    messages=inspectOutbound(messages)
    let body,relative
    if(c.protocol==='anthropic'){
      relative='messages';body={model:c.model,max_tokens:maxTokens,stream:false,system:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),messages:messages.filter(m=>m.role!=='system')}
    }else if(c.protocol==='responses'){
      relative='responses';body={model:c.model,input:messages,max_output_tokens:maxTokens,store:false,...(c.jsonMode?{text:{format:{type:'json_object'}}}:{})}
    }else{
      relative='chat/completions';body={model:c.model,messages,stream:false,...(c.provider==='openai'?{max_completion_tokens:maxTokens}:{max_tokens:maxTokens}),...(c.jsonMode?{response_format:{type:'json_object'}}:{}),...(c.provider==='deepseek'?{thinking:{type:'disabled'}}:{})}
    }
    const data=await this.call(c,relative,{method:'POST',body,signal})
    let content,finishReason
    if(c.protocol==='anthropic'){content=data.content?.filter(p=>p.type==='text').map(p=>p.text).join('');finishReason=data.stop_reason==='end_turn'?'stop':data.stop_reason}
    else if(c.protocol==='responses'){content=data.output?.filter(p=>p.type==='message').flatMap(p=>p.content||[]).filter(p=>p.type==='output_text').map(p=>p.text).join('');finishReason=data.status==='completed'?'stop':data.status}
    else{content=data.choices?.[0]?.message?.content;finishReason=data.choices?.[0]?.finish_reason}
    if(typeof content==='string')content=content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/,'$1')
    return {content,finishReason,model:typeof data.model==='string'&&/^[\w/_.:@+-]{1,160}$/.test(data.model)?data.model:c.model}
  }
}
