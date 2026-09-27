// Tests for the `curl -fsSL https://pywire.dev/install.sh | sh` installer.
// Each test runs the real script under `sh` with a sandboxed HOME and a PATH
// of fake `uv`/`uvx`/`curl` binaries that log how they were called.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PUBLIC = new URL('../site/public/', import.meta.url).pathname
const SCRIPT = join(PUBLIC, 'install.sh')
const SYSTEM_PATH = '/usr/bin:/bin'

function exe(path, body) {
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

// A fake uv: `uv tool run ...`/`uvx ...` log their argv and whether stdin is a TTY.
function fakeUv(dir, log) {
  const body = `printf '%s\\n' "$(basename "$0") $*" >> ${log}
if [ -t 0 ]; then echo stdin=tty >> ${log}; else echo stdin=notty >> ${log}; fi
exit \${FAKE_UV_EXIT:-0}`
  exe(join(dir, 'uv'), body)
  exe(join(dir, 'uvx'), body)
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'pywire-install-'))
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  mkdirSync(home)
  mkdirSync(bin)
  return { root, home, bin, log: join(root, 'calls.log') }
}

function calls(box) {
  return existsSync(box.log) ? readFileSync(box.log, 'utf8').trim().split('\n') : []
}

// Like `curl -fsSL https://pywire.dev/install.sh | sh -s -- ARGS`: script on stdin.
function runPiped(box, args = [], env = {}) {
  return spawnSync('sh', ['-s', '--', ...args], {
    input: readFileSync(SCRIPT),
    env: { HOME: box.home, PATH: `${box.bin}:${SYSTEM_PATH}`, ...env },
    encoding: 'utf8',
  })
}

test('install.sh is served, and the old /install path still works', () => {
  assert.ok(existsSync(SCRIPT), 'site/public/install.sh must exist')
  const redirects = readFileSync(join(PUBLIC, '_redirects'), 'utf8')
  assert.match(redirects, /^\/install\s+\/install\.sh\s+301$/m)
  assert.ok(!existsSync(join(PUBLIC, 'install')), 'the old copy is replaced by the redirect')
})

test('with uv installed, launches the latest create-pywire-app and passes args through', () => {
  const box = sandbox()
  fakeUv(box.bin, box.log)
  const r = runPiped(box, ['my-app', '--yes'])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(calls(box).includes('uvx create-pywire-app@latest my-app --yes'), calls(box).join('\n'))
})

test('without uv, installs uv first and then launches create-pywire-app', () => {
  const box = sandbox()
  // The fake astral installer (fetched by curl) drops uv into ~/.local/bin.
  const fakeUvDir = join(box.root, 'uv-dist')
  mkdirSync(fakeUvDir)
  fakeUv(fakeUvDir, box.log)
  exe(
    join(box.bin, 'curl'),
    `echo "curl $*" >> ${box.log}
cat <<'EOF'
mkdir -p "$HOME/.local/bin"
cp ${fakeUvDir}/uv ${fakeUvDir}/uvx "$HOME/.local/bin/"
EOF`,
  )
  const r = runPiped(box, ['my-app'])
  assert.equal(r.status, 0, r.stderr)
  const log = calls(box)
  assert.ok(log.includes('curl -LsSf https://astral.sh/uv/install.sh'), log.join('\n'))
  assert.ok(log.includes('uvx create-pywire-app@latest my-app'), log.join('\n'))
  // The new shell has no uv on PATH until it is restarted, so say how to get it.
  assert.match(r.stdout, /restart your shell/i)
})

test('fails loudly when uv cannot be installed', () => {
  const box = sandbox()
  exe(join(box.bin, 'curl'), 'exit 22')
  const r = runPiped(box)
  assert.notEqual(r.status, 0)
  assert.match(r.stdout + r.stderr, /docs\.astral\.sh\/uv/)
})

test('propagates the create-pywire-app exit code', () => {
  const box = sandbox()
  fakeUv(box.bin, box.log)
  const r = runPiped(box, [], { FAKE_UV_EXIT: '3' })
  assert.equal(r.status, 3)
})

test('works without a terminal (CI, containers, agents)', () => {
  const box = sandbox()
  fakeUv(box.bin, box.log)
  const r = spawnSync('setsid', ['sh', '-s'], {
    input: readFileSync(SCRIPT),
    env: { HOME: box.home, PATH: `${box.bin}:${SYSTEM_PATH}` },
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(calls(box).includes('stdin=notty'), calls(box).join('\n'))
})

test('reattaches the terminal when piped to sh, so the wizard can prompt', () => {
  const box = sandbox()
  fakeUv(box.bin, box.log)
  // `script` gives the command a real controlling terminal; the installer
  // itself still arrives on a pipe, exactly like `curl ... | sh`.
  const r = spawnSync('script', ['-qec', `cat ${SCRIPT} | sh`, '/dev/null'], {
    env: { HOME: box.home, PATH: `${box.bin}:${SYSTEM_PATH}` },
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(calls(box).includes('stdin=tty'), calls(box).join('\n'))
})
