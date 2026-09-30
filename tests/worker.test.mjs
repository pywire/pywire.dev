// Tests for the pywire.dev router Worker (worker/src/index.js). The Worker only
// uses web-standard fetch/Request/Response, so Node runs it as is; the Pages
// upstream is a stubbed global fetch and R2 is a tiny in-memory fake.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import router, { LANDING_CSP, DOCS_CSP, DOCS_CSP_REPORT_ONLY, CDN_CSP } from '../worker/src/index.js'

const ENV = {
  LANDING_HOST: 'pywire-landing.pages.dev',
  DOCS_HOST: 'pywire-docs.pages.dev',
  CDN_BUCKET: {
    async list({ prefix }) {
      const keys = ['tree-sitter-pywire/tree_sitter_pywire-0.1.0-py3-none-any.whl']
      return { objects: keys.filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }
    },
    async get(key) {
      return key === 'tree-sitter-pywire/tree_sitter_pywire-0.1.0-py3-none-any.whl'
        ? { body: 'wheel', httpMetadata: { contentType: 'application/zip' } }
        : null
    },
  },
}

// Stub Pages: record upstream requests, answer via `respond`.
let upstream
let respond
const realFetch = globalThis.fetch
beforeEach(() => {
  upstream = []
  respond = () => new Response('ok', { status: 200, headers: { 'Content-Type': 'text/html' } })
  globalThis.fetch = async (request) => {
    upstream.push(request)
    return respond(new URL(request.url))
  }
})
afterEach(() => {
  globalThis.fetch = realFetch
})

const get = (url, env = ENV) => router.fetch(new Request(url), env)

function assertNoPagesDev(res) {
  for (const [name, value] of res.headers) {
    assert.ok(!value.includes('pages.dev'), `${name} leaks a pages.dev host: ${value}`)
  }
}

test('http is redirected to https on the same host and path, before any upstream fetch', async () => {
  for (const [from, to] of [
    ['http://pywire.dev/install', 'https://pywire.dev/install'],
    ['http://pywire.dev/docs/', 'https://pywire.dev/docs/'],
    ['http://nightly.pywire.dev/a?b=1', 'https://nightly.pywire.dev/a?b=1'],
  ]) {
    const res = await get(from)
    assert.equal(res.status, 301, from)
    assert.equal(res.headers.get('Location'), to)
    assertNoPagesDev(res)
  }
  assert.equal(upstream.length, 0)
})

test('www is redirected to the apex over https', async () => {
  for (const from of ['https://www.pywire.dev/install?x=1', 'http://www.pywire.dev/install?x=1']) {
    const res = await get(from)
    assert.equal(res.status, 301)
    assert.equal(res.headers.get('Location'), 'https://pywire.dev/install?x=1')
  }
})

test('the landing site is proxied over https with the Pages Host header', async () => {
  const res = await get('https://pywire.dev/install')
  assert.equal(res.status, 200)
  assert.equal(upstream.length, 1)
  assert.equal(upstream[0].url, 'https://pywire-landing.pages.dev/install')
  assert.equal(upstream[0].headers.get('Host'), 'pywire-landing.pages.dev')
  assert.equal(upstream[0].redirect, 'manual')
})

test('nightly routes to the nightly branch aliases', async () => {
  await get('https://nightly.pywire.dev/')
  await get('https://nightly.pywire.dev/docs/guides/')
  assert.deepEqual(
    upstream.map((r) => r.url),
    ['https://nightly.pywire-landing.pages.dev/', 'https://nightly.pywire-docs.pages.dev/guides/'],
  )
})

test('docs are proxied with /docs stripped', async () => {
  await get('https://pywire.dev/docs')
  await get('https://pywire.dev/docs/guides/forms/?q=1')
  assert.deepEqual(
    upstream.map((r) => r.url),
    ['https://pywire-docs.pages.dev/', 'https://pywire-docs.pages.dev/guides/forms/?q=1'],
  )
})

test('docs trailing-slash redirects keep the /docs mount and never name pages.dev', async () => {
  respond = (u) => new Response(null, { status: 308, headers: { Location: `https://pywire-docs.pages.dev${u.pathname}/` } })
  const res = await get('https://pywire.dev/docs/guides/forms')
  assert.equal(res.status, 308)
  assert.equal(res.headers.get('Location'), '/docs/guides/forms/')
  assertNoPagesDev(res)

  respond = (u) => new Response(null, { status: 308, headers: { Location: `${u.pathname}/` } })
  const relative = await get('https://pywire.dev/docs/guides/forms')
  assert.equal(relative.headers.get('Location'), '/docs/guides/forms/')
})

test('landing redirects to any pages.dev host are rewritten onto the public origin', async () => {
  for (const host of ['pywire-landing.pages.dev', 'abc123.pywire-landing.pages.dev']) {
    respond = () => new Response(null, { status: 301, headers: { Location: `https://${host}/install` } })
    const res = await get('https://pywire.dev/install')
    assert.equal(res.headers.get('Location'), '/install')
    assertNoPagesDev(res)
  }
})

test('redirects to unrelated hosts pass through', async () => {
  respond = () => new Response(null, { status: 302, headers: { Location: 'https://github.com/pywire' } })
  const res = await get('https://pywire.dev/somewhere')
  assert.equal(res.headers.get('Location'), 'https://github.com/pywire')
})

test('landing responses carry the security headers', async () => {
  const res = await get('https://pywire.dev/')
  assert.equal(res.headers.get('Content-Security-Policy'), LANDING_CSP)
  assert.match(LANDING_CSP, /frame-ancestors 'none'/)
  assert.equal(res.headers.get('X-Frame-Options'), 'DENY')
  assert.equal(res.headers.get('Strict-Transport-Security'), 'max-age=31536000; includeSubDomains')
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(res.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin')
  assert.match(res.headers.get('Permissions-Policy'), /camera=\(\)/)
})

test('the installer keeps its content type and gets the security headers', async () => {
  respond = () => new Response('#!/bin/sh\n', { headers: { 'Content-Type': 'application/x-install-instructions' } })
  const res = await get('https://pywire.dev/install')
  assert.equal(res.headers.get('Content-Type'), 'application/x-install-instructions')
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(res.headers.get('Content-Security-Policy'), LANDING_CSP)
  assert.equal(await res.text(), '#!/bin/sh\n')
})

test('docs enforce framing rules and report the full CSP only', async () => {
  const res = await get('https://pywire.dev/docs/tutorial/')
  assert.equal(res.headers.get('Content-Security-Policy'), DOCS_CSP)
  assert.equal(res.headers.get('Content-Security-Policy-Report-Only'), DOCS_CSP_REPORT_ONLY)
  assert.equal(res.headers.get('X-Frame-Options'), 'SAMEORIGIN')
  // The tutorial needs WebAssembly, blob: workers and jsDelivr for Pyodide.
  assert.match(DOCS_CSP_REPORT_ONLY, /'wasm-unsafe-eval'/)
  assert.match(DOCS_CSP_REPORT_ONLY, /worker-src 'self' blob:/)
  assert.match(DOCS_CSP_REPORT_ONLY, /https:\/\/cdn\.jsdelivr\.net/)
})

test('cdn serves the simple index and files with a locked-down CSP', async () => {
  const index = await get('https://pywire.dev/cdn/simple/tree-sitter-pywire/')
  assert.equal(index.status, 200)
  assert.match(await index.text(), /href="\/cdn\/tree-sitter-pywire\/tree_sitter_pywire-0\.1\.0-py3-none-any\.whl"/)
  assert.equal(index.headers.get('Access-Control-Allow-Origin'), '*')
  assert.equal(index.headers.get('Content-Security-Policy'), CDN_CSP)

  const file = await get('https://pywire.dev/cdn/tree-sitter-pywire/tree_sitter_pywire-0.1.0-py3-none-any.whl')
  assert.equal(file.status, 200)
  assert.equal(file.headers.get('Content-Type'), 'application/zip')
  assert.equal(file.headers.get('Strict-Transport-Security'), 'max-age=31536000; includeSubDomains')

  assert.equal((await get('https://pywire.dev/cdn/simple/nope/')).status, 404)
  assert.equal((await get('https://pywire.dev/cdn/nope.whl')).status, 404)
  assert.equal(upstream.length, 0)
})

test('shortcut redirects', async () => {
  const res = await get('https://pywire.dev/github')
  assert.equal(res.status, 302)
  assert.equal(res.headers.get('Location'), 'https://github.com/pywire/pywire')
  assert.equal((await get('https://pywire.dev/toString')).status, 200) // not a shortcut, proxied
})

test('missing host bindings fail closed instead of guessing a pages.dev name', async () => {
  const res = await get('https://pywire.dev/', { CDN_BUCKET: ENV.CDN_BUCKET })
  assert.equal(res.status, 500)
  assert.equal(upstream.length, 0)
})
