function loopback(value) {
  if (value === '::1' || value === 'localhost') return true
  const address = String(value).replace(/^::ffff:/i, '')
  return /^127(?:\.\d{1,3}){3}$/.test(address) && address.split('.').every(n => Number(n) <= 255)
}

export function companionRejection(req) {
  try {
    // Node normally lowercases headers. Normalize here too so adapters cannot
    // accidentally bypass Origin or forwarding checks with mixed-case names.
    const h = Object.create(null)
    for (const [name, value] of Object.entries(req.headers || {})) {
      const key = name.toLowerCase()
      if (Object.hasOwn(h, key)) return 403
      h[key] = value
    }
    const host = h.host, peer = req.socket?.remoteAddress || ''
    if (!loopback(peer) || typeof host !== 'string' || !host || /[\s/@\\?#]/.test(host)) return 403
    const local = new URL((req.socket?.encrypted ? 'https:' : 'http:') + '//' + host)
    if (!loopback(local.hostname.replace(/^\[|\]$/g, ''))) return 403
    if (Object.keys(h).some(k => k === 'forwarded' || k.startsWith('x-forwarded-') || k === 'x-real-ip')) return 403
    if (h.origin !== undefined && h.origin !== local.origin) return 403
    if (h['sec-fetch-site'] !== undefined && !['same-origin', 'none'].includes(h['sec-fetch-site'])) return 403
    // x-dshw-companion is only a client route marker, never authentication.
    // Its presence, absence, or value must not change the decision above.
    if (['POST', 'PUT', 'PATCH'].includes(String(req.method || '').toUpperCase()) &&
        (typeof h['content-type'] !== 'string' || !/^application\/json(?:\s*;|$)/i.test(h['content-type']))) return 415
    return null
  } catch {
    return 403
  }
}
