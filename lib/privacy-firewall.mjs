// These checks reduce accidental disclosure; they cannot identify every kind of private data.
// This module never logs matches, request content, credentials or upstream response excerpts.
const OFFICIAL=Object.freeze({
  deepseek:{baseUrl:'https://api.deepseek.com',protocols:['chat']},
  openai:{baseUrl:'https://api.openai.com/v1',protocols:['chat','responses']},
  gemini:{baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',protocols:['chat']},
  anthropic:{baseUrl:'https://api.anthropic.com/v1',protocols:['anthropic']}
})
const MODEL_ID=/^[a-zA-Z0-9][a-zA-Z0-9/_.:@+-]{0,159}$/
const LIMIT=12000
const INPUT_LIMIT=262144
function blocked(direction='outbound'){
  const e=Error(direction==='response'?'隐私防火墙已拦截疑似敏感返回内容，未显示':'隐私防火墙已拦截疑似敏感信息，未发送内容；请先删除敏感信息')
  e.code='PRIVACY_BLOCKED';e.direction=direction;return e
}
function destinationError(){const e=Error('隐私防火墙已拒绝未经确认的 API 目的地或请求');e.code='PRIVACY_DESTINATION';return e}

// A final method/path gate, separate from configuration validation and socket DNS checks.
export function assertDestination(config,relative,method){
  if(!config||typeof config!=='object'||typeof relative!=='string'||typeof method!=='string')throw destinationError()
  const {provider,baseUrl,protocol}=config,preset=OFFICIAL[provider]
  if(preset){if(baseUrl!==preset.baseUrl||!preset.protocols.includes(protocol))throw destinationError()}
  else if(provider==='custom'){
    if(config.confirmedBaseUrl!==baseUrl||!['chat','responses','anthropic'].includes(protocol))throw destinationError()
    let u;try{u=new URL(baseUrl)}catch{throw destinationError()}
    if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password||u.search||u.hash||u.href.replace(/\/$/,'')!==baseUrl||!u.hostname.includes('.')||u.hostname.endsWith('.')||u.hostname.includes(':')||/^[0-9.]+$/.test(u.hostname)||/(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)||/[\s\\%]/.test(baseUrl)||!/^[a-zA-Z0-9/_.~-]*$/.test(u.pathname))throw destinationError()
  }else throw destinationError()
  if(method==='GET'&&relative==='models')return config.baseUrl+'/models'
  if(method==='GET'&&protocol==='anthropic'&&relative.startsWith('models?after_id=')){
    const query=relative.slice('models?after_id='.length)
    let id;try{id=decodeURIComponent(query)}catch{throw destinationError()}
    if(!MODEL_ID.test(id)||encodeURIComponent(id)!==query)throw destinationError()
    return config.baseUrl+'/'+relative
  }
  const completion={chat:'chat/completions',responses:'responses',anthropic:'messages'}[protocol]
  if(method==='POST'&&relative===completion)return config.baseUrl+'/'+relative
  throw destinationError()
}

function secretForms(key){
  if(typeof key!=='string'||!key)return []
  const forms=new Set([key,encodeURIComponent(key),Buffer.from(key).toString('base64'),Buffer.from(key).toString('base64url')])
  let escaped=key
  for(let i=0;i<3;i++){escaped=JSON.stringify(escaped).slice(1,-1);forms.add(escaped)}
  return [...forms].filter(Boolean).sort((a,b)=>b.length-a.length)
}
function luhn(value){
  const digits=value.replace(/[ -]/g,'')
  if(!/^\d{13,19}$/.test(digits)||new Set(digits).size<2)return false
  let sum=0,twice=false
  for(let i=digits.length-1;i>=0;i--){let n=Number(digits[i]);if(twice){n*=2;if(n>9)n-=9}sum+=n;twice=!twice}
  return sum%10===0
}
function commonSensitive(text){
  if(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/i.test(text))return true
  if(/\b(?:sk-(?:(?:ant|proj|svcacct)-)?[a-zA-Z0-9_-]{16,}|AIza[a-zA-Z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|glpat-[a-zA-Z0-9_-]{16,}|xox[baprs]-[a-zA-Z0-9-]{16,}|[sr]k_live_[a-zA-Z0-9]{16,}|npm_[a-zA-Z0-9]{20,})\b/.test(text))return true
  if(/\b(?:Bearer\s+[a-zA-Z0-9._~+\/-]{8,}={0,2}|Basic\s+[a-zA-Z0-9+/]{12,}={0,2})/i.test(text))return true
  if(/(?:\b(?:api[ _-]?key|password|passwd|pwd|(?:access|refresh|auth)[ _-]?token|client[ _-]?secret|secret[ _-]?key|session[ _-]?(?:token|cookie))\b|密码|密钥|银行卡号|银行账号)\s*["']?\s*(?:=|:|：|是|为)\s*["']?[^\s"',;}{]{4,}/i.test(text))return true
  if(/\beyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/.test(text))return true
  if(/(?<!\d)1[3-9]\d(?:[ -]?\d){8}(?!\d)/.test(text))return true
  if(/(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/.test(text))return true
  if(/(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/.test(text))return true
  if(/(?:social security|SSN|社会保障号)\s*["']?\s*[:=：]?\s*["']?\d{9}(?!\d)/i.test(text))return true
  // Bound each local part/label and avoid quadratic retries on long ordinary text.
  if(text.includes('@')&&/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/.test(text))return true
  if(/[\p{Script=Han}]{2,20}(?:街|路|巷|道)\s*\d{1,6}\s*(?:号|弄|栋|室)/u.test(text))return true
  if(/\b\d{1,6}\s+(?:[a-zA-Z][a-zA-Z.'-]*\s+){1,6}(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Lane|Ln\.?|Boulevard|Blvd\.?|Drive|Dr\.?)\b/i.test(text))return true
  if(/(?:[a-zA-Z]:[\\/]Users[\\/][^\\/\s]+|\/(?:Users|home)\/[^/\s]+)/.test(text))return true
  for(const match of text.matchAll(/(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g))if(luhn(match[0]))return true
  return false
}
function variants(text){
  const list=new Set(),queue=[],states=new Map();let total=0,overflow=false
  // Encodings can be combined with fullwidth characters or invisible separators.
  const add=(value,uriDepth=0,base64Depth=0)=>{
    for(const variant of new Set([value,value.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g,'')])){
      if(!list.has(variant)){list.add(variant);total+=variant.length}
      if(list.size>64||total>8*1024*1024){overflow=true;return}
      const counts=states.get(variant)||new Set(),state=uriDepth+':'+base64Depth
      if(!counts.has(state)){counts.add(state);states.set(variant,counts);queue.push({value:variant,uriDepth,base64Depth})}
    }
  }
  add(text)
  // At most two URI decodes and one base64 decode per branch, with global budgets.
  for(let i=0;i<queue.length&&!overflow;i++){
    const {value,uriDepth,base64Depth}=queue[i]
    if(uriDepth<2)try{const decoded=decodeURIComponent(value);if(decoded!==value)add(decoded,uriDepth+1,base64Depth)}catch{}
    if(base64Depth<1)for(const match of value.matchAll(/(?<![a-zA-Z0-9+/_-])[a-zA-Z0-9+/_-]{24,8192}={0,2}(?![a-zA-Z0-9+/_-])/g)){
      const decoded=Buffer.from(match[0],'base64').toString('utf8')
      if(decoded.length>=8&&!/[^\x09\x0a\x0d\x20-\x7e\u0080-\uffff]/.test(decoded)&&!decoded.includes('\ufffd'))add(decoded,uriDepth,1)
      if(overflow)break
    }
  }
  return {values:list,overflow}
}
function sensitive(text,forms,depth=0){
  const {values,overflow}=variants(text);if(overflow)return true
  for(const value of values){
    if(forms.some(secret=>value.includes(secret))||commonSensitive(value))return true
    if(depth<6){
      let decoded;try{decoded=JSON.parse(value)}catch{continue}
      const parts=[],stack=[{value:decoded,level:0}];let visits=0
      while(stack.length){
        const {value:v,level}=stack.pop();if(++visits>20000||level>32)return true
        if(typeof v==='string')parts.push(v)
        else if(v&&typeof v==='object')for(const [k,item] of Object.entries(v)){parts.push(k);stack.push({value:item,level:level+1})}
      }
      if(parts.some(part=>part!==text&&sensitive(part,forms,depth+1)))return true
    }
  }
  return false
}
function scanMessages(messages,key){
  if(!Array.isArray(messages)||messages.length>64)throw blocked()
  const forms=secretForms(key),strings=[];let bytes=0
  for(const m of messages){
    if(!m||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string')throw blocked()
    bytes+=m.content.length;if(bytes>INPUT_LIMIT)throw blocked()
    if(sensitive(m.content,forms))throw blocked()
    strings.push(m.content)
    // JSON input can encode sensitive values with unicode escapes.
    try{const decoded=JSON.parse(m.content);if(decoded&&typeof decoded==='object'&&sensitive(JSON.stringify(decoded),forms))throw blocked()}catch(error){if(error.code==='PRIVACY_BLOCKED')throw error}
  }
  if(sensitive(strings.join(''),forms))throw blocked()
}
function safeSlice(text,length){return text.slice(0,Math.max(0,length)).replace(/[\uD800-\uDBFF]$/,'')}
function minimizePayload(content,budget){
  let source;try{source=JSON.parse(content)}catch{return safeSlice(content,budget)}
  if(!source||!Array.isArray(source.recentDialogue))return safeSlice(content,budget)
  const recent=source.recentDialogue.slice(-2).map(m=>{
    if(!m||!['user','assistant'].includes(m.role)||typeof m.text!=='string')throw blocked()
    return {role:m.role,text:safeSlice(m.text,3000)}
  })
  const payload={trigger:source.trigger==='idle_companion'?'idle_companion':'dialogue_check',preference:safeSlice(typeof source.preference==='string'?source.preference:'',2000),recentDialogue:recent,recentRemarks:[],alreadyGreeted:source.alreadyGreeted===true}
  let serialized=JSON.stringify(payload)
  while(serialized.length>budget){
    if(payload.preference.length)payload.preference=safeSlice(payload.preference,Math.max(0,payload.preference.length-(serialized.length-budget)))
    else {const longest=recent.reduce((a,m)=>!a||m.text.length>a.text.length?m:a,null);if(!longest?.text.length)throw blocked();longest.text=safeSlice(longest.text,Math.max(0,longest.text.length-(serialized.length-budget)))}
    serialized=JSON.stringify(payload)
  }
  return serialized
}

// Scan all original context before discarding history or shortening any content.
// DSH's JSON envelope gets at most two latest dialogue entries and no previous remarks.
export function inspectOutbound(messages,key=''){
  scanMessages(messages,key)
  const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n')
  const dialogue=messages.filter(m=>m.role!=='system').slice(-2)
  const out=system?[{role:'system',content:safeSlice(system,4000)}]:[]
  let remaining=LIMIT-out.reduce((n,m)=>n+m.content.length,0)
  for(let i=0;i<dialogue.length;i++){
    const m=dialogue[i],budget=Math.floor(remaining/(dialogue.length-i))
    const content=m.role==='user'?minimizePayload(m.content,budget):safeSlice(m.content,budget)
    out.push({role:m.role,content});remaining-=content.length
  }
  return out
}

// Work on decoded strings, rather than replacing bytes inside JSON serialization.
// Exact echoes are masked; other sensitive server output is rejected before display.
export function redactSecrets(decodedValue,key=''){
  const forms=secretForms(key),strings=[];let nodes=0,total=0
  const scrub=(value,depth=0,collect=true)=>{
    if(++nodes>20000||depth>32)throw blocked('response')
    if(typeof value==='string'){
      total+=value.length;if(total>2*1024*1024)throw blocked('response')
      let text=value;for(const form of forms)text=text.split(form).join('[redacted]')
      if(sensitive(text,forms))throw blocked('response')
      if(collect)strings.push(text);return text
    }
    if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value
    if(Array.isArray(value))return value.map(v=>scrub(v,depth+1))
    if(value&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value))){
      const out={}
      for(const [name,v] of Object.entries(value)){const safeName=scrub(name,depth+1,false);Object.defineProperty(out,safeName,{value:scrub(v,depth+1),enumerable:true,writable:true,configurable:true})}
      return out
    }
    throw blocked('response')
  }
  const clean=scrub(decodedValue)
  // Do not let separated content parts reconstruct a known key or common token.
  if(sensitive(strings.join(''),forms))throw blocked('response')
  return clean
}
