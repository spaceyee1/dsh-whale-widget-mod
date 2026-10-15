import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {PersistentCredentials} from '../lib/persistent-credentials.mjs';

// Exercise the real plugin registration and handlers without a DSH installation,
// real credentials, DPAPI, network access, or an existing user's data directory.
const originalInitialize = PersistentCredentials.prototype.initialize;
PersistentCredentials.prototype.initialize = async () => ({ok: false, error: 'fixture: no vault'});
after(() => { PersistentCredentials.prototype.initialize = originalInitialize; });
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

async function fixture(t, {account = true, response = readyWallets(), rejection = null, accountState = {status: 'ready', userId: privateAccount, token: privateToken}} = {}) {
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
  const state = {response, rejection, accountState};
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
    request, state, home, accountCalls, credentialCalls,
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
