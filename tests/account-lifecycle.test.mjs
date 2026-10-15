import test from 'node:test'
import assert from 'node:assert/strict'
import {readAccountBalance} from '../lib/account-balance.mjs'

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
