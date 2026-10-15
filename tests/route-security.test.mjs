import assert from 'node:assert/strict'
import test from 'node:test'
import { companionRejection } from '../lib/companion-route-security.mjs'

function request({ headers = {}, peer = '127.0.0.1', method = 'GET', encrypted = false } = {}) {
  return { headers: { host: 'localhost:3080', ...headers }, socket: { remoteAddress: peer, encrypted }, method }
}

test('local same-origin requests do not require the companion marker', () => {
  for (const marker of [undefined, '1', '0', 'not-authentication']) {
    const headers = { origin: 'http://localhost:3080', 'sec-fetch-site': 'same-origin' }
    if (marker !== undefined) headers['x-dshw-companion'] = marker
    assert.equal(companionRejection(request({ headers })), null)
    assert.equal(companionRejection(request({ headers: { ...headers, 'content-type': 'application/json; charset=utf-8' }, method: 'POST' })), null)
  }
})

test('loopback requests without browser-only headers remain supported', () => {
  for (const peer of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) {
    assert.equal(companionRejection(request({ peer })), null)
  }
  assert.equal(companionRejection(request({ headers: { host: '[::1]:3080', origin: 'http://[::1]:3080' }, peer: '::1' })), null)
  assert.equal(companionRejection(request({ headers: { origin: 'https://localhost:3080' }, encrypted: true })), null)
})

test('forged marker cannot bypass peer, host, origin, or fetch-site checks', () => {
  const cases = [
    { peer: '192.168.1.2' },
    { peer: '::ffff:192.168.1.2' },
    { peer: '::ffff:127.999.0.1' },
    { headers: { host: 'attacker.example:3080' } },
    { headers: { host: 'localhost@attacker.example' } },
    { headers: { host: 'localhost:3080/path' } },
    { headers: { origin: 'https://attacker.example' } },
    { headers: { origin: 'http://localhost:3081' } },
    { headers: { origin: 'null' } },
    { headers: { origin: ['http://localhost:3080'] } },
    { headers: { 'sec-fetch-site': 'cross-site' } },
    { headers: { 'sec-fetch-site': 'same-site' } },
    { headers: { 'sec-fetch-site': '' } },
  ]
  for (const value of cases) {
    for (const marker of [undefined, '1']) {
      const headers = { ...value.headers }
      if (marker !== undefined) headers['x-dshw-companion'] = marker
      assert.equal(companionRejection(request({ ...value, headers })), 403, JSON.stringify(value))
    }
  }
})

test('forwarded headers are rejected regardless of spelling or marker', () => {
  for (const name of ['forwarded', 'Forwarded', 'x-forwarded-for', 'X-Forwarded-Host', 'x-real-ip', 'X-Real-IP']) {
    assert.equal(companionRejection(request({ headers: { [name]: '127.0.0.1', 'x-dshw-companion': '1' } })), 403)
  }
})

test('header normalization accepts valid adapters but rejects case-conflicting headers', () => {
  const req = request({ method: 'POST' })
  req.headers = { Host: 'localhost:3080', Origin: 'http://localhost:3080', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }
  assert.equal(companionRejection(req), null)
  assert.equal(companionRejection({ ...req, headers: { ...req.headers, Origin: 'https://attacker.example' } }), 403)
  assert.equal(companionRejection({ ...req, headers: { ...req.headers, origin: 'https://attacker.example' } }), 403)
  assert.equal(companionRejection({ ...req, headers: { ...req.headers, Host: ['localhost:3080'] } }), 403)
})

test('write requests still require JSON even with a companion marker', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'post']) {
    for (const value of [undefined, 'text/plain', ['application/json']]) {
      const headers = { 'x-dshw-companion': '1' }
      if (value !== undefined) headers['content-type'] = value
      assert.equal(companionRejection(request({ method, headers })), 415)
    }
    assert.equal(companionRejection(request({ method, headers: { 'content-type': 'Application/JSON' } })), null)
  }
})
