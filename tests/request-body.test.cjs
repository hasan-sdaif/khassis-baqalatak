const test = require('node:test')
const assert = require('node:assert/strict')
const { readJsonLimited } = require('../.test-build/server/request-body.js')

function request(body, headers = {}) {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

test('bounded JSON reader accepts valid small JSON', async () => {
  const result = await readJsonLimited(request(JSON.stringify({ ok: true, count: 3 })), 128)
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, { ok: true, count: 3 })
})

test('bounded JSON reader rejects an oversized declared Content-Length before parsing', async () => {
  const result = await readJsonLimited(request('{}', { 'content-length': '4096' }), 32)
  assert.equal(result.ok, false)
  assert.equal(result.status, 413)
  assert.equal(result.error, 'request_too_large')
})

test('bounded JSON reader rejects chunked/unknown-length payloads above byte limit', async () => {
  const result = await readJsonLimited(request(JSON.stringify({ value: 'x'.repeat(100) })), 32)
  assert.equal(result.ok, false)
  assert.equal(result.status, 413)
  assert.equal(result.error, 'request_too_large')
})

test('bounded JSON reader rejects malformed JSON', async () => {
  const result = await readJsonLimited(request('{not-json'), 128)
  assert.equal(result.ok, false)
  assert.equal(result.status, 400)
  assert.equal(result.error, 'invalid_json')
})

test('bounded JSON reader rejects invalid UTF-8', async () => {
  const body = new Uint8Array([0xc3, 0x28])
  const result = await readJsonLimited(request(body), 128)
  assert.equal(result.ok, false)
  assert.equal(result.status, 400)
  assert.equal(result.error, 'invalid_encoding')
})
