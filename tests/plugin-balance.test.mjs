import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {CompanionApi} from '../lib/companion-api.mjs'
import {assertDestination} from '../lib/privacy-firewall.mjs'

const official='https://api.deepseek.com'
const fixtureKey='fixture-balance-key-one'
const wallet=(currency='CNY',total='12.50',recharge='10.00',bonus='2.50')=>({currency,total_balance:total,topped_up_balance:recharge,granted_balance:bonus})
const response=(...rows)=>({is_available:true,balance_infos:rows.length?rows:[wallet()]})
function fixture(request=async()=>response()){
  const values=new Map(),calls=[],resolved=[]
  const api=new CompanionApi({
    credentials:{set:async(ref,key)=>values.set(ref,key),resolve:async ref=>{resolved.push(ref);return {value:values.get(ref)}},unset:async ref=>values.delete(ref)},
    saveConfig:()=>true,privacyMode:true,
    request:async(url,options)=>{calls.push({url,options});return request(url,options)}
  })
  const configure=(overrides={})=>api.configure({provider:'deepseek',key:fixtureKey,model:'',confirmEndpoint:official,...overrides})
  return {api,values,calls,resolved,configure}
}

test('plugin balance uses only confirmed official GET and projects CNY wallet without needing a model',async()=>{
  const f=fixture(async()=>({...response(wallet('USD','1.00','1.00','0.00'),wallet()),extra:'server metadata'}))
  await f.configure()
  assert.equal(f.api.canReadBalance(),true)
  const data=await f.api.balance()
  assert.deepEqual({...data,updatedAt:'time',accountTag:'tag'},{ok:true,currency:'CNY',totalBalance:12.5,rechargeBalance:10,bonusBalance:2.5,balanceSource:'plugin-api',updatedAt:'time',accountTag:'tag'})
  assert.equal(data.accountTag,createHash('sha256').update('dsh-plugin-key:'+f.api.config.keyRef).digest('hex').slice(0,24))
  assert.ok(Number.isFinite(Date.parse(data.updatedAt)))
  assert.equal(JSON.stringify(data).includes(fixtureKey),false)
  assert.equal(JSON.stringify(data).includes(f.api.config.keyRef),false)
  assert.equal(f.calls.length,1)
  assert.equal(f.calls[0].url,official+'/user/balance')
  assert.equal(f.calls[0].options.method,'GET')
  assert.equal(f.calls[0].options.body,undefined)
  assert.equal(f.calls[0].options.headers.Authorization,'Bearer '+fixtureKey)
  assert.ok(f.resolved.every(ref=>ref.startsWith('DSHW_COMPANION_')))
})

test('zero balance is valid even when is_available is false, and USD is supported',async()=>{
  const f=fixture(async()=>({is_available:false,balance_infos:[wallet('USD','0.00','0.00','0.00')]}))
  await f.configure()
  const data=await f.api.balance()
  assert.equal(data.ok,true)
  assert.equal(data.totalBalance,0)
  assert.equal(data.currency,'USD')
})

test('balance rejects malformed amount strings and response shapes without returning server data',async()=>{
  let payload=response()
  const f=fixture(async()=>payload)
  await f.configure()
  for(const value of ['',null,true,12,' 12.00','12.00 ','1e2','0x10','Infinity','NaN','01.00','1.','+1','9007199254740992','1.0000000000001']){
    payload=response(wallet('CNY',value))
    await assert.rejects(f.api.balance(),error=>error.code==='PLUGIN_BALANCE_INVALID')
  }
  for(const invalid of [{is_available:true,balance_infos:[]}, {is_available:true,balance_infos:[wallet('EUR')]},response(wallet(),wallet()),{balance_infos:[wallet()]},response({...wallet(),currency:{}})]){
    payload=invalid
    await assert.rejects(f.api.balance())
  }
  for(const field of ['topped_up_balance','granted_balance']){
    payload=response({...wallet(),[field]:'wrong-value'})
    await assert.rejects(f.api.balance(),error=>error.code==='PLUGIN_BALANCE_INVALID'&&!error.message.includes('wrong-value'))
  }
})

test('unconfirmed, missing or invalid key references and storage/config failures disable balance',async()=>{
  const f=fixture()
  assert.equal(f.api.canReadBalance(),false)
  await assert.rejects(f.api.balance(),{code:'PLUGIN_BALANCE_UNAVAILABLE'})
  await f.configure()
  const good={...f.api.config}
  for(const changed of [{confirmedBaseUrl:''},{keyRef:''},{keyRef:'DEEPSEEK_API_KEY'},{provider:'custom'},{baseUrl:'https://api.deepseek.com.evil.example'}]){
    f.api.config={...good,...changed}
    assert.equal(f.api.canReadBalance(),false)
    await assert.rejects(f.api.balance(),{code:'PLUGIN_BALANCE_UNAVAILABLE'})
  }
  f.api.config=good
  for(const property of ['storageFault','error']){
    f.api[property]='storage unavailable'
    assert.equal(f.api.canReadBalance(),false)
    await assert.rejects(f.api.balance(),{code:'PLUGIN_BALANCE_UNAVAILABLE'})
    f.api[property]=''
  }
  f.values.clear()
  await assert.rejects(f.api.balance(),/API Key/)
  assert.equal(f.calls.length,0)
})

test('other providers and a custom provider on the same hostname cannot reuse a key for balance',async()=>{
  for(const selection of [{provider:'openai',baseUrl:'https://api.openai.com/v1'},{provider:'custom',baseUrl:official},{provider:'custom',baseUrl:'https://proxy.example.com'}]){
    const f=fixture()
    await f.configure({...selection,confirmEndpoint:selection.baseUrl})
    assert.equal(f.api.canReadBalance(),false)
    await assert.rejects(f.api.balance(),{code:'PLUGIN_BALANCE_UNAVAILABLE'})
    assert.equal(f.calls.length,0)
    assert.throws(()=>assertDestination(f.api.config,'user/balance','GET'),{code:'PRIVACY_DESTINATION'})
  }
})

test('balance destination allowlist permits no path, method or confirmation variants',()=>{
  const config={provider:'deepseek',baseUrl:official,protocol:'chat',confirmedBaseUrl:official}
  assert.equal(assertDestination(config,'user/balance','GET'),official+'/user/balance')
  for(const relative of ['user/balance/','user/balance?x=1','/user/balance','user/balance/other','../user/balance','user%2Fbalance'])assert.throws(()=>assertDestination(config,relative,'GET'))
  for(const method of ['POST','PUT','DELETE','get'])assert.throws(()=>assertDestination(config,'user/balance',method))
  assert.throws(()=>assertDestination({...config,confirmedBaseUrl:''},'user/balance','GET'))
})

test('changing a plugin key cancels an old balance request and does not return its wallet',async()=>{
  let release,started
  const requestStarted=new Promise(resolve=>{started=resolve})
  let first=true
  const f=fixture(async()=>{
    if(first){first=false;started();return new Promise(resolve=>{release=resolve})}
    return response(wallet('CNY','9.00','9.00','0.00'))
  })
  await f.configure()
  const oldRef=f.api.config.keyRef
  const rejected=assert.rejects(f.api.balance(),/取消|更换/)
  await requestStarted
  await f.configure({key:'fixture-balance-key-two'})
  await rejected
  assert.equal(f.calls[0].options.signal.aborted,true)
  release(response(wallet('CNY','888.00','888.00','0.00')))
  const data=await f.api.balance()
  assert.equal(data.totalBalance,9)
  assert.equal(f.values.has(oldRef),false)
  assert.equal(f.calls[1].options.headers.Authorization,'Bearer fixture-balance-key-two')
  assert.notEqual(data.accountTag,createHash('sha256').update('dsh-plugin-key:'+oldRef).digest('hex').slice(0,24))
  assert.equal(JSON.stringify(data).includes('fixture-balance-key'),false)
})

test('balance waits for queued configuration and uses the committed plugin key',async()=>{
  const f=fixture()
  const configuration=f.configure()
  const balance=f.api.balance()
  await configuration
  assert.equal((await balance).ok,true)
  assert.equal(f.calls.length,1)
})
