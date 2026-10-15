import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {PersistentCredentials} from '../lib/persistent-credentials.mjs';
import {CompanionApi} from '../lib/companion-api.mjs';

// Exercise the real plugin registration and handlers without a DSH installation,
// real credentials, DPAPI, network access, or an existing user's data directory.
const localVaults = new Map();
const vaultMethods = ['initialize', 'resolve', 'set', 'unset', 'purge', 'clear'];
const originalVaultMethods = Object.fromEntries(vaultMethods.map(name => [name, PersistentCredentials.prototype[name]]));
const originalApiCall = CompanionApi.prototype.call;
PersistentCredentials.prototype.initialize = async function() {
  return localVaults.has(this.home) ? {ok: true, error: ''} : {ok: false, error: 'fixture: no vault'};
};
for (const name of ['resolve', 'set', 'unset', 'purge']) {
  PersistentCredentials.prototype[name] = async function(ref, value) {
    const vault = localVaults.get(this.home);
    assert.ok(vault, 'only the explicit in-memory fixture vault may be used');
    vault.calls.push({method: name, ref});
    if (name === 'purge') { vault.values.clear(); return; }
    assert.match(ref, /^DSHW_COMPANION_[a-f0-9]{24}_[a-f0-9]{24}$/, 'only plugin-owned references may be read');
    if (name === 'resolve') return vault.values.has(ref) ? {value: vault.values.get(ref)} : undefined;
    if (name === 'set') vault.values.set(ref, value);
    if (name === 'unset') vault.values.delete(ref);
  };
}
PersistentCredentials.prototype.clear = function() {
  localVaults.get(this.home)?.values.clear();
  return originalVaultMethods.clear.call(this);
};
CompanionApi.prototype.call = function(...args) {
  const vault = localVaults.get(this.credentials.home);
  assert.ok(vault, 'API calls must have an explicit mock transport; real network is forbidden');
  this.request = vault.request;
  return originalApiCall.apply(this, args);
};
after(() => {
  for (const name of vaultMethods) PersistentCredentials.prototype[name] = originalVaultMethods[name];
  CompanionApi.prototype.call = originalApiCall;
});
let fixtureNumber = 0;
const fixtureParent = path.dirname(fileURLToPath(import.meta.url));

const privateText = 'FIXTURE_PRIVATE_CONVERSATION_DO_NOT_PERSIST';
const privateTitle = 'FIXTURE_PRIVATE_SESSION_TITLE';
const privateAccount = 'FIXTURE_PRIVATE_ACCOUNT_ID';
const privateToken = 'FIXTURE_LOGIN_TOKEN_NOT_FOR_PLUGIN';
function readyWallets(balance = '18.60', bonus = '1.40') {
  return {
    status: 'ready',
    value: [{currency: 'CNY', balance}, {currency: 'USD', balance: '400.00'}],
    bonusWallets: [{currency: 'CNY', balance: bonus}, {currency: 'USD', balance: '500.00'}],
    token: privateToken,
  };
}

function pluginWallets(total = '20.00', recharge = '18.60', bonus = '1.40') {
  return {is_available: true, balance_infos: [{currency: 'CNY', total_balance: total, topped_up_balance: recharge, granted_balance: bonus}]};
}

async function fixture(t, {account = true, pluginVault = false, response = readyWallets(), rejection = null, accountState = {status: 'ready', userId: privateAccount, token: privateToken}} = {}) {
  const tempRoot = fs.mkdtempSync(path.join(fixtureParent, 'dsh-account-balance-test-'));
  const home = path.join(tempRoot, 'home');
  fs.mkdirSync(home);
  // A dormant custom registry must not be reactivated or disclosed by this change.
  const oldRegistry = JSON.stringify({version: 1, models: [{id: 'legacy-private', name: 'private-model', keyRef: 'HOST_SECRET_REF', baseUrl: 'https://unused.invalid'}]});
  fs.writeFileSync(path.join(home, '.dshw-api.json'), oldRegistry);
  const credentialCalls = [];
  const accountCalls = [];
  const titleCalls = [];
  const routes = new Map();
  const listeners = new Map();
  const disposers = [];
  const state = {response, rejection, accountState, pluginResponse: pluginWallets(), pluginTransport: null};
  const pluginCalls = [];
  const vaultCalls = [];
  if (pluginVault) localVaults.set(home, {
    values: new Map(), calls: vaultCalls,
    request: async (url, options) => {
      assert.equal(url, 'https://api.deepseek.com/user/balance');
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined, 'balance requests must not include conversation text');
      pluginCalls.push({url, ...options});
      if (state.pluginTransport) return state.pluginTransport(url, options);
      if (state.pluginResponse instanceof Error) throw state.pluginResponse;
      return state.pluginResponse;
    },
  });
  const credentials = Object.fromEntries(['resolve', 'set', 'unset'].map(method => [method, async (...args) => {
    credentialCalls.push({method, args});
    throw new Error('Host credential access forbidden in this fixture');
  }]));
  const accountService = account ? {
    getState: () => state.accountState,
    getBalance: async client => {
      accountCalls.push(client);
      if (state.response instanceof Error) throw state.response;
      return state.response;
    },
  } : null;
  const connection = {requestRejection: () => state.rejection};
  const context = {
    credentials,
    connection,
    get(name) {
      if (name === 'deepseekAccount') return accountService;
      if (name === 'connection') return connection;
      if (name === 'sessionTitle') {
        titleCalls.push(name);
        throw new Error('Session titles must stay disabled');
      }
      return undefined;
    },
    on(name, callback) {
      const entries = listeners.get(name) || new Set();
      entries.add(callback); listeners.set(name, entries);
      return () => entries.delete(callback);
    },
    effect(callback) {
      const dispose = callback();
      if (typeof dispose === 'function') disposers.push(dispose);
    },
    webServer: {
      register(route) {
        assert.equal(routes.has(route.path), false, 'route registered once');
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
      tapIndex: () => () => {},
    },
  };
  context.inject = (_dependencies, callback) => callback(context);
  const previousHome = process.env.DSH_HOME;
  try {
    process.env.DSH_HOME = home;
    const moduleUrl = new URL('../lib/index.js', import.meta.url);
    moduleUrl.searchParams.set('account-balance-fixture', String(++fixtureNumber));
    const {default: plugin} = await import(moduleUrl.href);
    plugin.apply(context);
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
  }
  t.after(() => {
    for (const dispose of disposers.reverse()) dispose();
    localVaults.delete(home);
    // Only remove the exact directory created by this fixture.
    assert.equal(path.dirname(tempRoot), fixtureParent);
    assert.ok(path.basename(tempRoot).startsWith('dsh-account-balance-test-'));
    fs.rmSync(tempRoot, {recursive: true, force: true});
    assert.deepEqual(credentialCalls, [], 'account/ledger operations must never use host credentials');
    assert.deepEqual(titleCalls, [], 'restoring accounting must not restore session-title access');
  });
  async function request(url, {method = 'GET', body, headers = {}, peer = '127.0.0.1'} = {}) {
    const pathname = new URL(url, 'http://localhost:3080').pathname;
    const route = routes.get(pathname);
    assert.ok(route, `registered route ${pathname}`);
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, {
      method, url,
      headers: {host: 'localhost:3080', origin: 'http://localhost:3080', 'sec-fetch-site': 'same-origin', ...(body === undefined ? {} : {'content-type': 'application/json'}), ...headers},
      socket: {remoteAddress: peer, encrypted: false},
    });
    const result = {status: 200, body: '', headers: {}};
    const res = {
      statusCode: 200,
      writeHead(status, values) { this.statusCode = status; result.headers = values; },
      end(data) { result.status = this.statusCode; result.body = data === undefined ? '' : String(data); },
    };
    await route.handler(req, res);
    result.json = result.body ? JSON.parse(result.body) : null;
    return result;
  }
  return {
    request, state, home, accountCalls, credentialCalls, pluginCalls, vaultCalls,
    configurePlugin(key = 'sk-fixture-only-not-a-real-key-first', model = '') {
      return request('/dsh-whale/companion-api.json', {method: 'PUT', body: {
        provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model,
        confirmEndpoint: 'https://api.deepseek.com', key,
      }});
    },
    emit(event) {
      const session = {id: 'fixture-session', title: privateTitle};
      for (const callback of listeners.get('session/event') || []) callback(session, event);
    },
    assertRegistryUntouched() { assert.equal(fs.readFileSync(path.join(home, '.dshw-api.json'), 'utf8'), oldRegistry); },
  };
}

test('account balance sums recharge and bonus in one currency and persists only accounting data', async t => {
  const f = await fixture(t);
  const first = await f.request('/dsh-whale/balance.json');
  assert.equal(first.status, 200);
  assert.equal(first.json.ok, true);
  assert.equal(first.json.balanceSource, 'account');
  assert.equal(first.json.currency, 'CNY');
  assert.equal(first.json.totalBalance, 20);
  assert.equal(first.json.rechargeBalance, 18.6);
  assert.equal(first.json.bonusBalance, 1.4);
  assert.equal(Object.hasOwn(first.json, 'accountTag'), false);
  assert.equal(f.accountCalls.length, 1);
  await f.request('/dsh-whale/balance.json');
  assert.equal(f.accountCalls.length, 1, 'ordinary polls reuse the balance cache');
  f.state.response = readyWallets('18.10', '1.40');
  const next = await f.request('/dsh-whale/balance.json?refresh=1');
  assert.equal(next.json.ok, true);
  assert.equal(next.json.totalBalance, 19.5);
  assert.equal(next.json.todayUsage, 0.5);
  const ledgerText = fs.readFileSync(path.join(f.home, '.dshw-usage.json'), 'utf8');
  const ledger = JSON.parse(ledgerText);
  assert.equal(ledger.accounting.version, 1);
  for (const secret of [privateToken, privateAccount, privateText, privateTitle, 'HOST_SECRET_REF']) {
    assert.equal(ledgerText.includes(secret), false);
    assert.equal(next.body.includes(secret), false);
  }
  f.assertRegistryUntouched();
});

test('missing or failing account service never falls back to the main-chat API key', async t => {
  for (const [name, options] of [
    ['missing service', {account: false}],
    ['not logged in', {response: {status: 'signed-out'}}],
    ['host failure', {response: new Error(privateToken)}],
    ['malformed wallets', {response: {status: 'ready', value: [{currency: 'CNY', balance: 'invalid'}]}}],
  ]) {
    await t.test(name, async st => {
      const f = await fixture(st, options);
      const result = await f.request('/dsh-whale/balance.json?refresh=1');
      assert.equal(result.status, 200);
      assert.equal(result.json.ok, false);
      assert.ok(result.json.error);
      assert.notEqual(result.json.code, 'NO_KEY');
      assert.equal(result.body.includes(privateToken), false);
      assert.deepEqual(f.credentialCalls, []);
    });
  }
});

test('switching accounts invalidates the old balance cache and does not count another wallet as spending', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/dsh-whale/balance.json')).json.totalBalance, 20);
  f.state.accountState = {status: 'ready', userId: 'different-fixture-account'};
  f.state.response = readyWallets('10.00', '0.00');
  const next = await f.request('/dsh-whale/balance.json');
  assert.equal(next.json.ok, true);
  assert.equal(next.json.totalBalance, 10);
  assert.equal(next.json.todayUsage, 0, 'switching accounts must not record a false ten-unit charge');
  assert.equal(f.accountCalls.length, 2);
});

test('a failed ledger write after switching accounts cannot show or correct the previous account ledger', async t => {
  const f = await fixture(t);
  const ledgerPath = path.join(f.home, '.dshw-usage.json');
  const fallbackDirectory = path.join(f.home, 'profiles', 'web');
  const fallbackLedgerPath = path.join(fallbackDirectory, '.dshw-usage.json');
  fs.mkdirSync(fallbackDirectory, {recursive: true});
  assert.equal((await f.request('/dsh-whale/balance.json')).json.totalBalance, 20);
  f.state.response = readyWallets('18.10', '1.40');
  const previous = await f.request('/dsh-whale/balance.json?refresh=1');
  assert.equal(previous.json.todayUsage, 0.5);
  const previousLedger = fs.readFileSync(ledgerPath, 'utf8');
  f.state.accountState = {status: 'ready', userId: 'different-fixture-account'};
  f.state.response = readyWallets('10.00', '0.00');
  const blockedDestinations = new Set([ledgerPath, fallbackLedgerPath].map(value => path.resolve(value)));
  const originalRename = fs.renameSync;
  fs.renameSync = function(source, destination) {
    if (blockedDestinations.has(path.resolve(destination))) {
      throw Object.assign(new Error('fixture ledger rename denied'), {code: 'EACCES'});
    }
    return originalRename.apply(this, arguments);
  };
  try {
    const failedWrite = await f.request('/dsh-whale/balance.json');
    assert.equal(failedWrite.json.ok, true, 'the newly fetched balance remains usable');
    assert.equal(failedWrite.json.totalBalance, 10);
    assert.equal(failedWrite.json.accounting, null);
    assert.equal(failedWrite.json.todayUsage, null);
    assert.ok(failedWrite.json.ledgerError);
    assert.ok(failedWrite.json.ledgerNotice);
    const cached = await f.request('/dsh-whale/balance.json');
    assert.equal(cached.json.totalBalance, 10);
    assert.equal(cached.json.accounting, null);
    assert.equal(cached.json.todayUsage, null);
    assert.equal(cached.json.ledgerError, failedWrite.json.ledgerError, 'a cached result must retain the write failure');
    assert.ok(cached.json.ledgerNotice);
    assert.equal(f.accountCalls.length, 3, 'the second read reuses the safe cached result');
    const projected = await f.request('/dsh-whale/api-models.json');
    assert.equal(projected.json.models[0].balance, 10);
    assert.equal(projected.json.models[0].accounting, null);
    assert.equal(projected.json.models[0].canAdjustBalance, false);
    assert.ok(projected.json.models[0].ledgerNotice);
    assert.ok(projected.json.models[0].ledgerError);
    const correction = await f.request('/dsh-whale/balance-adjustments.json?modelId=deepseek', {
      method: 'PUT', body: {modelId: 'deepseek', day: '2001-01-01'},
    });
    assert.equal(correction.status, 503);
    assert.equal(correction.json.ok, false);
    assert.equal(fs.readFileSync(ledgerPath, 'utf8'), previousLedger, 'the previous account history remains untouched');
    assert.equal(fs.existsSync(fallbackLedgerPath), false);
  } finally {
    fs.renameSync = originalRename;
  }
});

test('an account without a stable identity can display balance without recording a shared ledger baseline', async t => {
  const f = await fixture(t, {accountState: {status: 'ready'}});
  const result = await f.request('/dsh-whale/balance.json');
  assert.equal(result.json.ok, true);
  assert.equal(result.json.totalBalance, 20);
  assert.ok(result.json.ledgerNotice);
  const ledgerPath = path.join(f.home, '.dshw-usage.json');
  if (fs.existsSync(ledgerPath)) assert.equal(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).accounting, undefined);
});

test('session usage events and ledger settings work without persisting conversation text or titles', async t => {
  const f = await fixture(t);
  f.emit({type: 'user/message', data: {turn: 1, text: privateText}});
  f.emit({type: 'assistant/message', data: {
    turn: 1, text: privateText,
    message: {content: privateText, source: {model: 'deepseek-chat'}},
    usage: {inputTokens: 1000, cacheReadTokens: 300, outputTokens: 100, reasoningTokens: 30},
  }});
  f.emit({type: 'turn/end', data: {turn: 1, text: privateText}});
  const records = await f.request('/dsh-whale/usage-records.json');
  assert.equal(records.status, 200);
  assert.equal(records.json.ok, true);
  assert.equal(records.json.all.events.length, 1);
  assert.equal(records.json.all.events[0].tokens, 1400, 'reasoning tokens are already part of output tokens');
  assert.ok(records.json.all.events[0].cost > 0);
  const saved = await f.request('/dsh-whale/usage-settings.json', {method: 'PUT', body: {budget: {on: true, amount: 7}}});
  assert.equal(saved.status, 200);
  assert.equal(saved.json.ok, true);
  const settings = await f.request('/dsh-whale/usage-settings.json');
  assert.equal(settings.json.settings.budget.amount, 7);
  const ledgerText = fs.readFileSync(path.join(f.home, '.dshw-usage.json'), 'utf8');
  for (const text of [privateText, privateTitle, privateToken]) {
    assert.equal(ledgerText.includes(text), false);
    assert.equal(records.body.includes(text), false);
  }
  assert.equal(fs.existsSync(path.join(f.home, '.dshw-codex.json')), false);
  assert.equal(fs.existsSync(path.join(f.home, '.dshw-companion-last.json')), false);
  assert.equal(fs.existsSync(path.join(f.home, '.dshw-companion-debug.log')), false);
  f.assertRegistryUntouched();
});

test('API model list projects only the account model and rejects legacy credential actions', async t => {
  const f = await fixture(t);
  const projected = await f.request('/dsh-whale/api-models.json');
  assert.equal(projected.status, 200);
  assert.equal(projected.json.ok, true);
  assert.equal(projected.json.models.length, 1);
  assert.equal(projected.json.models[0].id, 'deepseek');
  assert.equal(projected.json.models[0].balance, 20);
  for (const text of ['HOST_SECRET_REF', 'legacy-private', 'keyRef', 'balanceDesc', privateToken]) assert.equal(projected.body.includes(text), false);
  for (const action of ['save', 'delete', 'set-key', 'delete-key', 'probe']) {
    const denied = await f.request('/dsh-whale/api-models.json', {method: 'POST', body: {action, id: 'deepseek', keyValue: 'FIXTURE_KEY_NOT_TO_STORE'}});
    assert.equal(denied.status, 403, action);
    assert.equal(denied.json.ok, false);
  }
  const allowed = await f.request('/dsh-whale/api-models.json', {method: 'POST', body: {action: 'model-settings', id: 'deepseek', budget: {on: true, amount: 8}}});
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json.ok, true);
  const settings = await f.request('/dsh-whale/usage-settings.json');
  assert.equal(settings.json.settings.models.deepseek.budget.amount, 8);
  const visualAlert = {on: true, below: 5, autoClose: true, ttlSec: 12, lines: [{type: 'text', text: '请留意账户余额', size: 12, bold: true, color: '#ffeeaa'}]};
  const visualSaved = await f.request('/dsh-whale/api-models.json', {method: 'POST', body: {action: 'model-settings', id: 'deepseek', alert: visualAlert}});
  assert.equal(visualSaved.status, 200);
  assert.equal(visualSaved.json.ok, true);
  const visualRead = await f.request('/dsh-whale/usage-settings.json');
  for (const [field, value] of Object.entries(visualAlert)) assert.deepEqual(visualRead.json.settings.models.deepseek.alert[field], value);
  const mixed = await f.request('/dsh-whale/api-models.json', {method: 'POST', body: {action: 'model-settings', id: 'deepseek', budget: {on: true}, keyValue: 'FIXTURE_KEY_NOT_TO_STORE'}});
  assert.ok([400, 403].includes(mixed.status));
  assert.equal(fs.readFileSync(path.join(f.home, '.dshw-usage.json'), 'utf8').includes('FIXTURE_KEY_NOT_TO_STORE'), false);
  f.assertRegistryUntouched();
});

test('balance adjustment is available only for the built-in account and retains the ledger', async t => {
  const f = await fixture(t);
  const allowed = await f.request('/dsh-whale/balance-adjustments.json?modelId=deepseek');
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json.ok, true);
  assert.equal(allowed.json.fresh, true);
  assert.ok(allowed.json.days.length > 0);
  for (const query of ['', '?modelId=legacy-private', '?modelId=deepseek&modelId=deepseek']) {
    const denied = await f.request('/dsh-whale/balance-adjustments.json' + query);
    assert.equal(denied.status, 403);
  }
});

test('real route security accepts local requests without a marker and preserves host authentication', async t => {
  const f = await fixture(t);
  const status = await f.request('/dsh-whale/companion-status.json');
  assert.equal(status.status, 200, 'the marker header must not be an authentication requirement');
  for (const override of [
    {peer: '192.0.2.10', headers: {'x-dshw-companion': '1'}},
    {headers: {origin: 'https://evil.invalid', 'x-dshw-companion': '1'}},
    {headers: {'x-forwarded-for': '127.0.0.1', 'x-dshw-companion': '1'}},
  ]) {
    assert.equal((await f.request('/dsh-whale/balance.json', override)).status, 403);
  }
  f.state.rejection = 401;
  for (const url of ['/dsh-whale/balance.json', '/dsh-whale/usage-records.json', '/dsh-whale/companion-status.json']) {
    assert.equal((await f.request(url)).status, 401, 'host login rejection must remain authoritative');
  }
});

test('read-only balance and ledger routes reject write methods before invoking the account service', async t => {
  const f = await fixture(t);
  for (const url of ['/dsh-whale/balance.json', '/dsh-whale/usage-records.json']) {
    const denied = await f.request(url, {method: 'POST', body: {}});
    assert.equal(denied.status, 405);
  }
  assert.equal(f.accountCalls.length, 0);
});

test('a saved plugin DeepSeek Key provides balance, model projection and accounting without a host account service or model selection', async t => {
  const f = await fixture(t, {account: false, pluginVault: true});
  const key = 'sk-fixture-only-not-a-real-key-first';
  const saved = await f.configurePlugin(key);
  assert.equal(saved.status, 200);
  assert.equal(saved.json.hasKey, true);
  assert.equal(saved.json.privacy.ready, true);
  assert.equal(saved.json.model, '', 'balance does not require a chat model');
  assert.equal(f.pluginCalls.length, 0, 'saving does not probe a remote API');
  const first = await f.request('/dsh-whale/balance.json');
  assert.equal(first.status, 200);
  assert.equal(first.json.ok, true);
  assert.equal(first.json.balanceSource, 'plugin-api');
  assert.equal(first.json.totalBalance, 20);
  assert.equal(first.json.rechargeBalance, 18.6);
  assert.equal(first.json.bonusBalance, 1.4);
  assert.equal(first.json.currency, 'CNY');
  assert.equal(Object.hasOwn(first.json, 'accountTag'), false);
  const models = await f.request('/dsh-whale/api-models.json');
  assert.equal(models.status, 200);
  assert.equal(models.json.models.length, 1);
  assert.equal(models.json.models[0].balanceSource, 'plugin-api');
  assert.equal(models.json.models[0].balance, 20);
  assert.equal(models.json.models[0].name, 'DeepSeek 插件 API 余额');
  assert.equal(f.pluginCalls.length, 1, 'the model panel shares the balance cache');
  f.state.pluginResponse = pluginWallets('19.50', '18.10', '1.40');
  const refreshed = await f.request('/dsh-whale/balance.json?refresh=1');
  assert.equal(refreshed.json.ok, true);
  assert.equal(refreshed.json.totalBalance, 19.5);
  assert.equal(refreshed.json.todayUsage, 0.5);
  const records = await f.request('/dsh-whale/usage-records.json');
  assert.equal(records.status, 200);
  assert.equal(records.json.ok, true);
  const adjustments = await f.request('/dsh-whale/balance-adjustments.json?modelId=deepseek');
  assert.equal(adjustments.status, 200);
  assert.equal(adjustments.json.ok, true);
  assert.ok(adjustments.json.days.length);
  for (const file of ['.dshw-usage.json', '.dshw-companion-api.json']) {
    const text = fs.readFileSync(path.join(f.home, file), 'utf8');
    assert.equal(text.includes(key), false, 'Key is never written to an ordinary JSON file');
    assert.equal(text.includes(privateToken), false);
    assert.equal(text.includes(privateText), false);
  }
  for (const result of [saved, first, models, refreshed, records, adjustments]) assert.equal(result.body.includes(key), false);
  assert.ok(f.vaultCalls.some(call => call.method === 'resolve'));
  assert.deepEqual(f.accountCalls, []);
  f.assertRegistryUntouched();
});

test('concurrent plugin balance and model requests share one in-flight request and subsequent cache', async t => {
  const f = await fixture(t, {account: false, pluginVault: true});
  assert.equal((await f.configurePlugin()).status, 200);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  f.state.pluginTransport = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const balance = f.request('/dsh-whale/balance.json');
  await started;
  const models = f.request('/dsh-whale/api-models.json');
  const refresh = f.request('/dsh-whale/balance.json?refresh=1');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.pluginCalls.length, 1);
  release(pluginWallets());
  const [a, b, c] = await Promise.all([balance, models, refresh]);
  assert.equal(a.json.totalBalance, 20);
  assert.equal(b.json.models[0].balance, 20);
  assert.equal(c.json.totalBalance, 20);
  await f.request('/dsh-whale/balance.json');
  await f.request('/dsh-whale/api-models.json');
  assert.equal(f.pluginCalls.length, 1);
  assert.deepEqual(f.accountCalls, []);
});

test('replacing the plugin Key invalidates cached and pending balances without mixing wallet ledgers', async t => {
  const f = await fixture(t, {account: false, pluginVault: true});
  const firstKey = 'sk-fixture-only-not-a-real-key-first';
  const secondKey = 'sk-fixture-only-not-a-real-key-second';
  assert.equal((await f.configurePlugin(firstKey)).status, 200);
  assert.equal((await f.request('/dsh-whale/balance.json')).json.totalBalance, 20);
  let entered, releaseOld;
  const started = new Promise(resolve => { entered = resolve; });
  f.state.pluginTransport = (_url, options) => {
    if (options.headers.Authorization === 'Bearer ' + firstKey) {
      entered();
      // Deliberately ignore abort to simulate a late response from the old socket.
      return new Promise(resolve => { releaseOld = resolve; });
    }
    assert.equal(options.headers.Authorization, 'Bearer ' + secondKey);
    return pluginWallets('8.00', '8.00', '0.00');
  };
  const pendingOld = f.request('/dsh-whale/balance.json?refresh=1');
  await started;
  assert.equal((await f.configurePlugin(secondKey)).status, 200);
  const fresh = await f.request('/dsh-whale/balance.json');
  assert.equal(fresh.json.ok, true);
  assert.equal(fresh.json.totalBalance, 8);
  assert.equal(fresh.json.todayUsage, 0, 'a different Key starts a separate balance baseline');
  releaseOld(pluginWallets('18.00', '18.00', '0.00'));
  const stale = await pendingOld;
  assert.equal(stale.json.ok, false);
  assert.equal(stale.json.totalBalance, undefined, 'the late balance must never reach the caller');
  assert.equal((await f.request('/dsh-whale/balance.json')).json.totalBalance, 8);
  assert.equal(f.pluginCalls.length, 3, 'the old completion does not replace or invalidate the new cache');
  f.state.pluginTransport = null;
  f.state.pluginResponse = pluginWallets('7.50', '7.50', '0.00');
  const next = await f.request('/dsh-whale/balance.json?refresh=1');
  assert.equal(next.json.todayUsage, 0.5);
  const ledger = fs.readFileSync(path.join(f.home, '.dshw-usage.json'), 'utf8');
  assert.equal(ledger.includes(firstKey), false);
  assert.equal(ledger.includes(secondKey), false);
  assert.deepEqual(f.accountCalls, []);
});

test('a failed plugin balance request never falls back to a different host account or its old cached balance', async t => {
  const f = await fixture(t, {pluginVault: true});
  assert.equal((await f.request('/dsh-whale/balance.json')).json.totalBalance, 20);
  assert.equal(f.accountCalls.length, 1);
  const key = 'sk-fixture-only-not-a-real-key-first';
  assert.equal((await f.configurePlugin(key)).status, 200);
  f.state.pluginResponse = new Error('fixture HTTP 401 ' + key);
  const failed = await f.request('/dsh-whale/balance.json');
  assert.equal(failed.status, 200);
  assert.equal(failed.json.ok, false);
  assert.equal(failed.json.totalBalance, undefined);
  assert.equal(failed.body.includes(key), false);
  assert.equal(f.accountCalls.length, 1, 'plugin failure must not use the logged-in host account');
  const projected = await f.request('/dsh-whale/api-models.json');
  assert.equal(projected.json.models[0].balance, null);
  assert.equal(projected.json.models[0].canAdjustBalance, false);
  assert.equal(f.accountCalls.length, 1);
  assert.deepEqual(f.credentialCalls, []);
});

test('a failed forced plugin balance refresh retires the successful cache and retains the plugin source', async t => {
  const f = await fixture(t, {pluginVault: true});
  assert.equal((await f.configurePlugin()).status, 200);
  const first = await f.request('/dsh-whale/balance.json');
  assert.equal(first.json.ok, true);
  assert.equal(first.json.totalBalance, 20);
  assert.equal(f.pluginCalls.length, 1);
  f.state.pluginResponse = new Error('fixture HTTP 401');
  const failed = await f.request('/dsh-whale/balance.json?refresh=1');
  assert.equal(failed.json.ok, false);
  assert.equal(failed.json.balanceSource, 'plugin-api');
  assert.equal(failed.json.totalBalance, undefined);
  assert.equal(f.pluginCalls.length, 2);
  const ordinary = await f.request('/dsh-whale/balance.json');
  assert.equal(ordinary.json.ok, false, 'an ordinary poll must not resurrect the pre-failure balance');
  assert.equal(ordinary.json.balanceSource, 'plugin-api');
  assert.equal(ordinary.json.totalBalance, undefined);
  assert.equal(f.pluginCalls.length, 3, 'the failed refresh invalidates the previous successful cache');
  const projected = await f.request('/dsh-whale/api-models.json');
  assert.equal(projected.json.models[0].balance, null);
  assert.equal(projected.json.models[0].balanceSource, 'plugin-api');
  assert.equal(projected.json.models[0].name, 'DeepSeek 插件 API 余额');
  assert.equal(projected.json.models[0].canAdjustBalance, false);
  assert.equal(f.pluginCalls.length, 4);
  assert.deepEqual(f.accountCalls, [], 'failed plugin requests never touch the available host account');
  assert.deepEqual(f.credentialCalls, []);
});
