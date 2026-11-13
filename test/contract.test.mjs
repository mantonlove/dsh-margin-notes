/**
 * Contract tests: can the current DSH App load this package at all?
 *
 * These assertions mirror the rules the App's own loader enforces, read out of
 * DSH 0.2.1-rc.3 (app.asar):
 *
 *   @deepseek-ai/dsh-client-modules/lib/index.js
 *     :65  dsh.client.platform must be a string
 *     :68  dsh.client.inject must be a string array
 *     :733 decl is ignored unless platform === 'web'
 *     :739 dsh.client without exports["./client"] throws
 *     :172 clientExportOf: string or { default: string }
 *   @deepseek-ai/dsh-client-modules/lib/client.js
 *     :703 register(): duplicate id throws; id comes from the registration
 *     :777 arriveGraphRow(): row.inject dependencies arrive first
 *     :748 a bundle that loads without registering "<id>" is a hard error
 *   @deepseek-ai/dsh-package-manifest/README.md
 *     dsh.manifestVersion / engines.dsh are declarative only (not enforced)
 *
 * Everything here is static: no App, no browser, no install.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const exists = (rel) => existsSync(path.join(root, rel))

const pkg = JSON.parse(read('package.json'))
const client = read('lib/client.js')
const host = read('lib/index.js')
const patch = read('cordis.patch.yml')

/** Strip block and line comments so "top-level code" checks only see code. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const clientRel = (() => {
  const entry = pkg.exports?.['./client']
  if (typeof entry === 'string') return entry
  if (entry && typeof entry.default === 'string') return entry.default
  return undefined
})()

test('package identity', () => {
  assert.equal(typeof pkg.name, 'string')
  assert.ok(pkg.name.length > 0)
  assert.match(pkg.version, /^\d+\.\d+\.\d+/)
  assert.equal(pkg.name.startsWith('dsh-') || pkg.name.includes('/'), true)
})

test('dsh.client declares the web platform and a string[] inject list', () => {
  const decl = pkg.dsh?.client
  assert.ok(decl, 'dsh.client missing — the loader would ignore the package entirely')
  assert.equal(typeof decl.platform, 'string')
  assert.equal(decl.platform, 'web', 'only platform "web" is served to the GUI')
  assert.ok(Array.isArray(decl.inject), 'dsh.client.inject must be a string array')
  for (const name of decl.inject) {
    assert.equal(typeof name, 'string')
    assert.equal(name.includes('/'), true, `inject entry "${name}" should be a package name`)
  }
  assert.equal(new Set(decl.inject).size, decl.inject.length, 'duplicate inject entries')
  assert.ok(!decl.inject.includes(pkg.name), 'a row must not declare its own package in dsh.client.inject')
})

test('exports["./client"] resolves to a real bundle', () => {
  assert.ok(clientRel, 'dsh.client without exports["./client"] throws in the App loader')
  assert.equal(typeof clientRel, 'string')
  assert.ok(clientRel.startsWith('./'), 'client export should be package-relative')
  assert.ok(exists(clientRel), `client entry missing on disk: ${clientRel}`)
})

test('dsh.bundle.patch points at an existing patch file', () => {
  const patchRel = pkg.dsh?.bundle?.patch
  assert.equal(typeof patchRel, 'string')
  assert.ok(exists(patchRel), `bundle patch missing on disk: ${patchRel}`)
  assert.equal(path.normalize(patchRel), path.normalize('cordis.patch.yml'))
})

test('manifest format identifier is declared', () => {
  // Declarative only (not enforced by the installer), but required by the
  // published manifest shape for anything shared or installed later.
  assert.equal(pkg.dsh?.manifestVersion, 1)
})

test('client bundle registers exactly one factory under the package name', () => {
  const registrations = stripComments(client).match(/__ModuleLoader__\.load\(/g) ?? []
  assert.equal(registrations.length, 1, 'a bundle executes its registration once; a second one throws')
  // The id may be a literal or a module-scope constant; resolve both forms.
  const literal = client.match(/__ModuleLoader__\.load\(\{\s*\n\s*id:\s*'([^']+)'/)
  const ref = client.match(/__ModuleLoader__\.load\(\{\s*\n\s*id:\s*([A-Za-z_$][\w$]*)/)
  let id
  if (literal !== null) {
    id = literal[1]
  } else {
    assert.ok(ref, 'registration must pass an id')
    const decl = client.match(new RegExp('var\\s+' + ref[1] + "\\s*=\\s*'([^']+)'"))
    assert.ok(decl, `id constant ${ref[1]} must be a string literal in this file`)
    id = decl[1]
  }
  assert.equal(id, pkg.name, 'registration id must equal the package name')
})

test('client bundle only registers at load time (no DOM or network side effects)', () => {
  const start = client.indexOf('__ModuleLoader__')
  assert.ok(start > 0)
  const before = stripComments(client.slice(0, start))
  // An IIFE wrapper plus a package-name constant is fine; doing work is not.
  assert.equal(/document\.|addEventListener|fetch\(|XMLHttpRequest/.test(before), false, 'bundle bodies stay inside the factory')
  assert.equal(/\brequire\(/.test(before), false)
  assert.match(before, /function\s*\(/, 'expected only the registration wrapper before __ModuleLoader__.load')
})

test('client module exports a Cordis plugin and waits on the four services it uses', () => {
  // The harness loads the real file through a stubbed loader and asserts the
  // same thing at runtime; this is the cheap static half.
  assert.match(client, /exports\.name\s*=\s*PKG|exports\.name\s*=\s*'dsh-batch-annotations'/)
  assert.match(client, /exports\.apply\s*=\s*(function\s*)?apply\b/)

  // Service names, as registered in DSH 0.2.1-rc.3 (app.asar):
  //   sessions     dsh-api-session-controller/lib/client.js  provide("sessions", this)
  //   conversation dsh-client-ui-conversation/lib/client.js   super(ctx, "conversation")
  //   locale       dsh-client-locale/lib/client.js            provide("locale", locale)
  //   uiSession    dsh-client-ui-session/lib/client.js        super(ctx, "uiSession")
  // A wrong name here means apply() waits forever and the feature never mounts.
  const injected = client
    .match(/exports\.inject\s*=\s*\[([^\]]*)\]/)[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter((s) => s.length > 0)
  assert.deepEqual(injected.sort(), ['conversation', 'locale', 'sessions', 'uiSession'])
})

test('client bundle requires no host package (nothing to resolve at materialization)', () => {
  const factoryBody = client.slice(client.indexOf('__ModuleLoader__'))
  assert.equal(/require\(\s*['"]/.test(factoryBody), false, 'no require() calls in the factory body')
})

test('host half exports a plugin row the bundle patch can insert', () => {
  // Derive from package.json: a rename must not need a test edit.
  assert.match(host, new RegExp("export const name = '" + pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'"))
  assert.match(host, /export function apply\(/)
  assert.equal(/export default/.test(host), false, 'cordis reads name/apply named exports')
})

test('bundle patch inserts this package under a stable row id', () => {
  assert.match(patch, /^-\s*insert:/m, 'patch must be a delta with an insert list')
  assert.match(patch, new RegExp('-\\s*id:\\s*' + pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(patch, new RegExp("name:\\s*'" + pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'"))
  assert.equal(/^\s{0,2}(remove|update|disable):/m.test(patch), false, 'never mutate foreign rows')
})

test('package ships the files the loader reads', () => {
  const files = pkg.files ?? []
  for (const required of ['lib/', 'cordis.patch.yml', 'README.md']) {
    assert.ok(files.includes(required), `files[] should ship ${required}`)
  }
  assert.ok(!(pkg.files ?? []).some((f) => f.startsWith('test/')), 'tests stay out of the published file set')
})
