// Independent capabilities: account balance does not grant access to host API keys.
// These are package policy, not values accepted from a browser request.
export const CAPABILITIES = Object.freeze({
  accountBalance: true,
  ledger: true,
  apiKeyBalance: false,
  pluginApiBalance: true,
  legacyApiRegistry: false,
  codexScan: false,
  sessionTitles: false,
  localRoutesOnly: true,
})

export function capabilityRejection(route, method) {
  if (route === '/dsh-whale/balance.json') return !CAPABILITIES.accountBalance ? 403 : method === 'GET' ? null : 405
  if (route === '/dsh-whale/usage-records.json') return !CAPABILITIES.ledger ? 403 : method === 'GET' ? null : 405
  if (['/dsh-whale/usage-settings.json', '/dsh-whale/balance-adjustments.json'].includes(route)) {
    return !CAPABILITIES.ledger ? 403 : ['GET', 'POST', 'PUT'].includes(method) ? null : 405
  }
  // Writes are further restricted to numeric model settings inside the handler.
  if (route === '/dsh-whale/api-models.json') return ['GET', 'POST', 'PUT'].includes(method) ? null : 405
  return null
}
