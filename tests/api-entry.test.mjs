import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {CompanionApi} from '../lib/companion-api.mjs';
const ui=fs.readFileSync(new URL('../assets/whale-widget.js',import.meta.url),'utf8');
test('all legacy editor IDs open companion editor without fetching balance or credentials',()=>{
 const fn=ui.slice(ui.indexOf('function openApiModelPanel('),ui.indexOf('var apiModelMaskEl',ui.indexOf('function openApiModelPanel(')));
 const calls=[];const ctx={closeApiModelPanel:()=>calls.push('close'),openCompanionApi:()=>calls.push('open'),fetch:()=>assert.fail('legacy request')};vm.createContext(ctx);vm.runInContext(fn,ctx);
 for(const id of [null,'old-model'])ctx.openApiModelPanel(id);
 assert.deepEqual(calls,['close','open','close','open']);
});
test('add model no longer requires disabled template route',()=>{
 const start=ui.indexOf("var addModelBtn = apiBtn('配置插件 API / 模型'");assert.ok(start>=0);
 const snippet=ui.slice(start,ui.indexOf('addModelBtn.style.flex',start));let click;
 vm.runInNewContext(snippet,{apiBtn:(_,cls,fn)=>{click=fn;return {}},openApiModelPanel:id=>assert.equal(id,null),loadApiModels:()=>assert.fail('blocked legacy route')});click();
});
test('confirmed independent API configuration saves without network or global credentials',async()=>{
 const keys=new Map();let saved;const api=new CompanionApi({privacyMode:true,credentials:{set:async(k,v)=>keys.set(k,v),resolve:async k=>({value:keys.get(k)}),unset:async k=>keys.delete(k)},saveConfig:c=>{saved=c;return true},request:()=>assert.fail('saving must not call API')});
 const result=await api.configure({provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'fixture-model',key:'fixture-secret-12345',confirmEndpoint:'https://api.deepseek.com'});
 assert.equal(result.configured,true);assert.equal(result.hasKey,true);assert.ok(saved.keyRef.startsWith('DSHW_COMPANION_'));assert.equal(keys.size,1);
});
test('unconfirmed destination still rejected before storing key',async()=>{
 const api=new CompanionApi({privacyMode:true,credentials:{set:()=>assert.fail('must not save')},saveConfig:()=>assert.fail('must not save')});
 await assert.rejects(api.configure({provider:'deepseek',key:'fixture-secret-12345',model:'fixture-model'}),/确认/);
});
