import test from 'node:test'
import assert from 'node:assert/strict'
import {readAccountBalance} from '../lib/account-balance.mjs'

// Cordis creates a new contextual proxy on each service lookup. Only its
// cordis.original symbol identifies the underlying service instance.
function cordisContext(currentService) {
  const credentialCalls=[]
  return {
    credentialCalls,
    credentials:{resolve:()=>{credentialCalls.push('resolve');throw Error('host keys must not be read')}},
    get(name) {
      assert.equal(name,'deepseekAccount')
      const service=currentService()
      return new Proxy(service,{get(target,key,receiver) {
        if(key===Symbol.for('cordis.original'))return target
        return Reflect.get(target,key,receiver)
      }})
    },
  }
}

test('fresh Cordis proxies for one account accept its balance and share concurrent requests', async()=>{
  let calls=0,resolve
  const response=new Promise(r=>{resolve=r})
  const service={getState:()=>({userId:'alice',status:'ready'}),getBalance:()=>{calls++;return response}}
  const ctx=cordisContext(()=>service)
  assert.notEqual(ctx.get('deepseekAccount'),ctx.get('deepseekAccount'),'fixture must return fresh proxies')
  const first=readAccountBalance(ctx),second=readAccountBalance(ctx)
  await Promise.resolve()
  resolve({status:'ready',value:[{currency:'CNY',balance:'18.60'}],bonusWallets:[{currency:'CNY',balance:'1.40'}]})
  const results=await Promise.all([first,second])
  for(const result of results) {
    assert.equal(result.ok,true,JSON.stringify(result))
    assert.equal(result.totalBalance,20)
    assert.equal(result.balanceSource,'account')
  }
  assert.equal(calls,1,'fresh context proxies must reuse the same underlying request')
  assert.deepEqual(ctx.credentialCalls,[])
})

test('Cordis proxy timeouts retain one uncancellable request until it settles', async()=>{
  let calls=0,resolve
  const response=new Promise(r=>{resolve=r})
  const service={getState:()=>({userId:'alice',status:'ready'}),getBalance:()=>{calls++;return response}}
  const ctx=cordisContext(()=>service)
  for(let i=0;i<3;i++)assert.equal((await readAccountBalance(ctx,{timeoutMs:3})).code,'ACCOUNT_REQUEST_FAILED')
  const timedOutCalls=calls
  resolve({status:'ready',value:[{currency:'CNY',balance:'20'}]})
  await new Promise(r=>setImmediate(r))
  assert.equal(timedOutCalls,1,'timeouts must not accumulate host calls under new proxy identities')
  service.getBalance=async()=>({status:'ready',value:[{currency:'CNY',balance:'19'}]})
  assert.equal((await readAccountBalance(ctx)).totalBalance,19,'settlement permits the next fresh request')
  assert.deepEqual(ctx.credentialCalls,[])
})

test('real account changes through Cordis proxies still reject a late wallet response', async()=>{
  let id='alice',resolve
  const service={getState:()=>({userId:id,status:'ready'}),getBalance:()=>new Promise(r=>{resolve=r})}
  const ctx=cordisContext(()=>service)
  const pending=readAccountBalance(ctx)
  await Promise.resolve();id='bob'
  resolve({status:'ready',value:[{currency:'CNY',balance:'20'}],token:'HOST_TOKEN'})
  const result=await pending
  assert.equal(result.code,'ACCOUNT_CHANGED')
  assert.equal(result.totalBalance,undefined)
  assert.equal(JSON.stringify(result).includes('HOST_TOKEN'),false)
  service.getBalance=async()=>({status:'ready',value:[{currency:'CNY',balance:'7'}]})
  assert.equal((await readAccountBalance(ctx)).totalBalance,7)
  assert.deepEqual(ctx.credentialCalls,[])
})

test('a genuinely replaced Cordis service with the same account ID rejects the old response', async()=>{
  let resolve
  let service={getState:()=>({userId:'alice',status:'ready'}),getBalance:()=>new Promise(r=>{resolve=r})}
  const ctx=cordisContext(()=>service)
  const pending=readAccountBalance(ctx)
  await Promise.resolve()
  service={getState:()=>({userId:'alice',status:'ready'}),getBalance:async()=>({status:'ready',value:[{currency:'CNY',balance:'9'}]})}
  const fresh=await readAccountBalance(ctx)
  resolve({status:'ready',value:[{currency:'CNY',balance:'20'}]})
  const old=await pending
  assert.equal(old.code,'ACCOUNT_CHANGED','matching user IDs must not hide replacement of the actual service')
  assert.equal(old.totalBalance,undefined)
  assert.equal(fresh.totalBalance,9)
  assert.deepEqual(ctx.credentialCalls,[])
})

test('account switching rejects a late response without exposing host extras', async () => {
  let id='alice',resolve
  const service={getState:()=>({userId:id,status:'ready'}),getBalance:()=>new Promise(r=>{resolve=r})}
  const ctx={get:()=>service}
  const pending=readAccountBalance(ctx)
  await Promise.resolve();id='bob'
  resolve({status:'ready',value:[{currency:'CNY',balance:'20'}],token:'HOST_TOKEN'})
  const result=await pending
  assert.equal(result.code,'ACCOUNT_CHANGED')
  assert.equal(JSON.stringify(result).includes('HOST_TOKEN'),false)
})

test('timeouts do not accumulate uncancellable host requests', async () => {
  let calls=0,resolve
  const service={getState:()=>({userId:'alice'}),getBalance:()=>{calls++;return new Promise(r=>{resolve=r})}}
  const ctx={get:()=>service}
  for(let i=0;i<3;i++)assert.equal((await readAccountBalance(ctx,{timeoutMs:3})).code,'ACCOUNT_REQUEST_FAILED')
  assert.equal(calls,1)
  resolve({status:'ready',value:[{currency:'CNY',balance:'20'}]})
  await new Promise(r=>setImmediate(r))
  service.getBalance=async()=>({status:'ready',value:[{currency:'CNY',balance:'19'}]})
  assert.equal((await readAccountBalance(ctx)).totalBalance,19)
})

test('invalid numeric wallets do not become zero balances', async()=>{
  for(const balance of [null,'',false,'nan',undefined]) {
    const service={getState:()=>({userId:'alice'}),getBalance:async()=>({status:'ready',value:[{currency:'CNY',balance}]})}
    assert.equal((await readAccountBalance({get:()=>service})).ok,false)
  }
})
