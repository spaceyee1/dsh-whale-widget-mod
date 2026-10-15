import {createHash} from 'node:crypto'
import {sumMoney} from './accounting.mjs'

export function accountContext(ctx) {
  let service, state
  try { service = ctx.get?.('deepseekAccount'); state = service?.getState?.() } catch {}
  const rawId = state?.userId ?? state?.profile?.userId
  const id = (typeof rawId === 'string' || typeof rawId === 'number') && String(rawId).trim() ? String(rawId) : null
  return {service, id, state: String(state?.status || '')}
}
export function sameAccount(a, b) { return !!a && !!b && a.service === b.service && a.id === b.id && a.state === b.state }
const failure = (code, error) => ({ok: false, code, error, balanceSource: 'account'})
const pendingAccounts = new WeakMap()

// Only the host service handles its account login grant. No credentials service,
// environment API key, URL, request header or raw host error is read or returned here.
export async function readAccountBalance(ctx, {timeoutMs = 8000} = {}) {
  const before = accountContext(ctx)
  if (typeof before.service?.getBalance !== 'function') return failure('ACCOUNT_UNAVAILABLE', '当前 DSH 未提供账户余额服务；可在“插件 API → 配置 API”选择 DeepSeek 官方服务，填写自己的 Key、确认地址并保存后刷新余额。不会读取主聊天 Key。')
  let pending = pendingAccounts.get(before.service)
  if (pending && !sameAccount(pending.context, before)) return failure('ACCOUNT_BUSY', '旧账户查询尚未结束，请稍后刷新。')
  if (!pending) {
    pending = {context: before}
    pending.promise = Promise.resolve().then(() => before.service.getBalance({version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || 'unknown'), locale: String(process.env.DSH_LOCALE || 'zh_CN'), timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60}))
      .finally(() => { if (pendingAccounts.get(before.service) === pending) pendingAccounts.delete(before.service) })
    pendingAccounts.set(before.service, pending)
  }
  let result, timer
  try {
    result = await Promise.race([
      pending.promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('timeout')), timeoutMs) }),
    ])
  } catch { return failure('ACCOUNT_REQUEST_FAILED', 'DSH 账户余额暂时不可用，请检查宿主的账户登录状态或稍后重试。未读取主聊天 API Key。') }
  finally { clearTimeout(timer) }
  if (!sameAccount(before, accountContext(ctx))) return failure('ACCOUNT_CHANGED', '账户在查询期间发生变化，请重新刷新余额。')
  if (result?.status !== 'ready' || !Array.isArray(result.value)) return failure('ACCOUNT_UNAVAILABLE', 'DSH 账户余额不可用，请先在宿主登录 DeepSeek 账户。不会回退读取主聊天 API Key。')
  const valid = w => w && typeof w.balance !== 'boolean' && w.balance !== null && String(w.balance).trim() !== '' && Number.isFinite(Number(w.balance)) && /^[A-Z]{3}$/.test(String(w.currency || '').toUpperCase())
  const wallets = result.value.filter(valid), bonuses = (Array.isArray(result.bonusWallets) ? result.bonusWallets : []).filter(valid)
  if (!wallets.length) return failure('ACCOUNT_WALLET_UNAVAILABLE', 'DSH 账户未返回有效余额钱包。')
  const currency = wallets.some(w => String(w.currency).toUpperCase() === 'CNY') ? 'CNY' : String(wallets[0].currency).toUpperCase()
  const sum = values => sumMoney(values.filter(w => String(w.currency).toUpperCase() === currency).map(w => Number(w.balance)))
  try {
    const rechargeBalance = sum(wallets), bonusBalance = sum(bonuses)
    return {ok: true, totalBalance: sumMoney([rechargeBalance, bonusBalance]), rechargeBalance, bonusBalance, currency,
      balanceSource: 'account', updatedAt: new Date().toISOString(),
      accountTag: before.id === null ? null : createHash('sha256').update('dsh-account:' + before.id).digest('hex').slice(0, 24),
      ...(before.id === null ? {ledgerNotice: '宿主未提供稳定账户标识；余额可显示，暂不按余额差记账，避免串账。'} : {})}
  } catch { return failure('ACCOUNT_WALLET_UNAVAILABLE', 'DSH 账户返回的金额超出可记账范围。') }
}
