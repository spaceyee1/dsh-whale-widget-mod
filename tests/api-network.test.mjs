import test from 'node:test';
import assert from 'node:assert/strict';
import {secureJSON,transportFailure,CompanionApi} from '../lib/companion-api.mjs';
test('fake IP is diagnosed before connection, without a key',async()=>{
 await assert.rejects(secureJSON('https://api.deepseek.com/models',{lookup:(host,opts,done)=>done(null,[{address:'198.18.0.43',family:4}])}),e=>e.code==='API_FAKE_IP'&&e.message.includes('Fake-IP'));
});
test('private address stays blocked and DNS failure stays identifiable',async()=>{
 await assert.rejects(secureJSON('https://api.deepseek.com/models',{lookup:(h,o,cb)=>cb(null,[{address:'127.0.0.1',family:4}])}),e=>e.code==='API_RESTRICTED_DNS');
 await assert.rejects(secureJSON('https://api.deepseek.com/models',{lookup:(h,o,cb)=>cb(Object.assign(Error('secret error'),{code:'ENOTFOUND'}))}),e=>e.code==='ENOTFOUND'&&!e.message.includes('secret'));
});
test('API client preserves only allowlisted network diagnosis',async()=>{
 const keys=new Map();const api=new CompanionApi({credentials:{set:async(k,v)=>keys.set(k,v),resolve:async k=>({value:keys.get(k)})},saveConfig:()=>true,request:async()=>{throw transportFailure('API_FAKE_IP')}});
 await api.configure({provider:'deepseek',key:'fixture-secret-12345',model:'test-model',confirmEndpoint:'https://api.deepseek.com'});
 await assert.rejects(api.models(),e=>e.code==='API_FAKE_IP');
 assert.equal(transportFailure('some secret').message.includes('some secret'),false);
});
