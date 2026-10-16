import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../assets/whale-widget.js', import.meta.url), 'utf8')
function functionSource(name) {
  const start = source.indexOf('function ' + name + '(')
  assert.notEqual(start, -1, 'missing UI function ' + name)
  const lineEnd = source.indexOf('\n', start)
  if (source.slice(start, lineEnd).endsWith('}')) return source.slice(start, lineEnd)
  return source.slice(start, source.indexOf('\n}', start) + 2)
}
class Element {
  constructor() { this.children = []; this.style = {}; this.className = ''; this.ownText = ''; this.title = ''; this.classList = {add() {}, remove() {}} }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null }
  set textContent(value) { this.ownText = String(value); this.children = [] }
  get textContent() { return this.ownText + this.children.map(c => c.textContent).join('') }
  querySelectorAll(selector) {
    const classes = selector.split(',').map(s => s.trim().slice(1))
    return this.children.flatMap(c => [...(classes.some(name => c.className.split(' ').includes(name)) ? [c] : []), ...c.querySelectorAll(selector)])
  }
}
function harness() {
  const timers = new Map(); let timerSeq = 0, response = null, draws = 0, randomPicks = 0
  const textBox = new Element(), amountEl = new Element(), hintEl = new Element(), labelEl = new Element()
  textBox.appendChild(labelEl); textBox.appendChild(amountEl); textBox.appendChild(hintEl)
  const ctx = {
    state: {balance: null, currency: 'CNY', todayUsage: null, status: 'loading', message: ''},
    shown: null, animId: null, animDelayTimer: null, settleTimer: null, busy: false,
    costBubbleActive: false, bubbleShown: true, bubbleScene: {kind: 'custom'}, bubbleRandomActive: false,
    balanceRetryLeft: 0, BALANCE_URL: '/dsh-whale/balance.json', FETCH_TIMEOUT_MS: 25000,
    ANIM_MS: 500, CHANGE_MS: 500, textBox, amountEl, hintEl, labelEl, gifEl: new Element(),
    document: {createElement: () => new Element()}, window: {},
    setTimeout(fn) { const id = ++timerSeq; timers.set(id, fn); return id }, clearTimeout(id) { timers.delete(id) },
    cancelAnimationFrame(id) { timers.delete(id) }, requestAnimationFrame(fn) { const id = ++timerSeq; timers.set(id, fn); return id },
    fetch: async () => ({json: async () => { if (response instanceof Error) throw response; return response }}),
    setHint: value => { hintEl.textContent = value }, checkUsageAlerts() {}, showBubble() {},
    applyBubbleLines() { assert.fail('balance refresh must not replace random dialogue') },
    bubbleRowsOf: mods => mods.map(m => [m]), bubbleIsImgMod: () => false, bubbleIsPeakCount: () => false,
    bubbleCountdownIsPeak: () => false, bubbleIsPeakNow: () => false, bubbleModuleFontU: () => 80,
    bubblePickLine() { randomPicks++; return 0 }, bubbleMarqueeDur: () => '2000ms', bubbleRgbSchemeOk: () => false,
    bubblePeakRowRegister() {}, bubbleCountdownRegister() {}, apiModelBalanceText: () => 'other', apiModelTodayText: () => 'other',
  }
  vm.createContext(ctx)
  for (const name of ['fmt', 'bubbleAmountText', 'bubbleIsModelMod', 'bubbleContentTokenMap', 'bubbleContentText',
    'bubbleRowContentOf', 'bubbleRowsTo', 'bubbleRenderModules', 'render', 'refresh', 'balanceRetryLater', 'animateAmount']) {
    vm.runInContext(functionSource(name), ctx)
  }
  for (const name of ['bubbleRefreshBalanceRows', 'balanceRefreshFailed']) {
    if (source.includes('function ' + name + '(')) vm.runInContext(functionSource(name), ctx)
  }
  const draw = ctx.bubbleRowsTo
  ctx.bubbleRowsTo = (...args) => { draws++; return draw(...args) }
  return {
    ctx, timers, textBox,
    open(mods) { ctx.bubbleRenderModules(mods); return textBox.querySelectorAll('.dshwv-trow') },
    async refresh(value) { response = value; ctx.refresh(true); await new Promise(resolve => setImmediate(resolve)) },
    get draws() { return draws }, get randomPicks() { return randomPicks },
  }
}
const ok = (balance, todayUsage = 0.02) => ({ok: true, totalBalance: balance, currency: 'CNY', todayUsage, usageLabel: '今日已用'})

test('an open balance bubble replaces the loading text after an asynchronous balance response without rebuilding other rows', async () => {
  const h = harness()
  const rows = h.open([{type: 'balance', tpl: '余额 {balance_ds}'}, {type: 'today', tpl: '今日 {expense_ds}'}, {type: 'random', lines: [{t: 'keep this greeting'}]}])
  assert.equal(rows[0].textContent, '余额 …')
  await h.refresh(ok(12.34))
  assert.equal(rows[0].textContent, '余额 ¥ 12.34')
  assert.equal(rows[1].textContent, '今日 ¥ 0.02')
  assert.equal(rows[2].textContent, 'keep this greeting')
  assert.equal(h.draws, 1)
  assert.equal(h.randomPicks, 1)
  assert.equal(h.ctx.amountEl.style.display, 'none')
})

test('a failed balance request is visible instead of remaining a loading ellipsis', async () => {
  const h = harness(), [row] = h.open([{type: 'balance', tpl: '{balance_ds}'}])
  await h.refresh({ok: false, code: 'ACCOUNT_CHANGED', error: '账户已变化，请重新刷新余额。'})
  assert.match(row.textContent, /失败|不可用/)
  assert.match(row.title, /账户已变化/)
})

test('a failed or changed account clears previously displayed balance and usage, including pending amount animation', async () => {
  for (const failure of [{ok: false, code: 'ACCOUNT_CHANGED', error: '账户已变化'}, new Error('network unavailable')]) {
    const h = harness()
    await h.refresh(ok(99, 1.23))
    const [row, today] = h.open([{type: 'balance'}, {type: 'today'}])
    assert.equal(row.textContent, '¥ 99.00')
    h.ctx.animId = 777; h.timers.set(777, () => assert.fail('stale balance animation must be cancelled'))
    await h.refresh(failure)
    assert.equal(h.ctx.shown, null)
    assert.equal(h.ctx.state.balance, null)
    assert.equal(h.ctx.state.todayUsage, null)
    assert.equal(h.timers.has(777), false)
    assert.match(row.textContent, /失败|不可用/)
    assert.doesNotMatch(today.textContent, /1\.23/)
  }
})

test('zero and negative balances render normally and a successful retry clears the error title', async () => {
  for (const value of [0, -0.5]) {
    const h = harness(), [row] = h.open([{type: 'balance', bg: '#fff', tpl: '剩余 {balance_ds}'}])
    await h.refresh({ok: false, error: '请重试'})
    await h.refresh(ok(value, 0))
    assert.equal(row.textContent, '剩余 ¥ ' + value.toFixed(2))
    assert.equal(row.title, '')
  }
})

test('a later balance change reaches the visible module when the existing number animation finishes', async () => {
  const h = harness()
  await h.refresh(ok(12.34))
  const [row] = h.open([{type: 'balance', tpl: '{balance_ds}'}])
  await h.refresh(ok(12.3))
  let step = h.timers.get(h.ctx.animId)
  step(0)
  step = h.timers.get(h.ctx.animId)
  step(500)
  assert.equal(row.textContent, '¥ 12.30')
  assert.equal(h.draws, 1)
})

test('editor previews stay unchanged and a completed balance update does not replace a cost bubble', async () => {
  const h = harness(), preview = new Element()
  h.ctx.bubbleRowsTo(preview, [{type: 'balance'}])
  const [row] = h.open([{type: 'balance'}])
  h.ctx.costBubbleActive = true
  await h.refresh(ok(3))
  assert.equal(preview.textContent, '…')
  assert.equal(row.textContent, '…')
  assert.equal(h.draws, 2)
})
