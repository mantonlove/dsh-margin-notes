import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

/**
 * Placement regression tests for the floating "＋ 批注" pill.
 *
 * Reported bug (m00648): in a better-sidebar document the pill landed exactly
 * on the host's own "Add to conversation" popup — both were anchored 8px above
 * the selection centre, so the text "Add … tion" peeked out from both sides.
 *
 * The planner is pure, so the collision rules are asserted without a DOM; the
 * browser harness (test/harness.html) covers the wiring.
 */
const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let factory = null
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(spec) {
        factory = spec.factory
      },
    },
  },
  document: {
    getElementById() {
      return null
    },
  },
  Node: { TEXT_NODE: 3 },
  console,
}
vm.createContext(sandbox)
vm.runInContext(code, sandbox)

const plugin = factory(() => {
  throw new Error('client bundle must not require host modules')
})
const { planToolbarPlacement, toolbarBox, badgeOffset, stripChipRanges, detectLength, findChip } = plugin.__test

const SIZE = { width: 96, height: 28 }
const VIEWPORT = { width: 1280, height: 800 }

/** Viewport rect of a text selection: (left, top) + 120x20. */
function selection(left, top, width = 120, height = 20) {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

/** Host popup rect, 28px tall, hanging 8px above `bottom`. */
function hostPill(left, top, width = 120, height = 28) {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

test('defaults BELOW the selection so the host pill above stays clear', () => {
  const plan = planToolbarPlacement({ rect: selection(400, 300), size: SIZE, viewport: VIEWPORT, obstacles: [] })
  assert.equal(plan.below, true)
  assert.equal(plan.top, 328) // rect.bottom (320) + gap (8)
  assert.equal(plan.left, 460) // selection centre, no clamp
})

test('a host pill above the selection does not push our pill', () => {
  // better-sidebar mounts its button at rect.top, transformed -100% - 8px.
  const obstacles = [hostPill(400, 264)]
  const plan = planToolbarPlacement({ rect: selection(400, 300), size: SIZE, viewport: VIEWPORT, obstacles })
  assert.equal(plan.below, true)
  assert.equal(plan.top, 328)
})

test('selection hugging the bottom flips above AND stacks above the host pill', () => {
  // rect.bottom 772 leaves only 20px below → no room for a 28px pill.
  const obstacles = [hostPill(400, 716)]
  const plan = planToolbarPlacement({ rect: selection(400, 752), size: SIZE, viewport: VIEWPORT, obstacles })
  assert.equal(plan.below, false)
  assert.equal(plan.top, 708) // 716 − gap 8: our pill's bottom edge
  const box = toolbarBox(plan, SIZE)
  assert.equal(box.bottom, 708)
  assert.equal(box.top, 680)
})

test('without a host pill the bottom-edge selection still flips above the text', () => {
  const plan = planToolbarPlacement({ rect: selection(400, 752), size: SIZE, viewport: VIEWPORT, obstacles: [] })
  assert.equal(plan.below, false)
  assert.equal(plan.top, 744) // rect.top (752) − gap (8)
})

test('chrome below the selection pushes our pill under it', () => {
  const obstacles = [hostPill(400, 330, 120, 28)] // sits right where we would land
  const plan = planToolbarPlacement({ rect: selection(400, 300), size: SIZE, viewport: VIEWPORT, obstacles })
  assert.equal(plan.below, true)
  assert.equal(plan.top, 368) // obstacle.bottom (358) + gap + 2
})

test('keeps the pill inside the viewport horizontally', () => {
  const leftEdge = planToolbarPlacement({ rect: selection(-100, 300, 40), size: SIZE, viewport: VIEWPORT, obstacles: [] })
  assert.equal(leftEdge.left, 60)
  const rightEdge = planToolbarPlacement({ rect: selection(1260, 300, 20), size: SIZE, viewport: VIEWPORT, obstacles: [] })
  assert.equal(rightEdge.left, VIEWPORT.width - 60)
})

test('toolbarBox follows the translate(-50%, -100%) transform', () => {
  // Cross-realm objects (vm sandbox) defeat deepStrictEqual's prototype check,
  // so assert the four edges explicitly.
  const below = toolbarBox({ left: 460, top: 328, below: true }, SIZE)
  assert.equal(below.left, 412)
  assert.equal(below.right, 508)
  assert.equal(below.top, 328)
  assert.equal(below.bottom, 356)
  const above = toolbarBox({ left: 460, top: 300, below: false }, SIZE)
  assert.equal(above.left, 412)
  assert.equal(above.right, 508)
  assert.equal(above.top, 272)
  assert.equal(above.bottom, 300)
})

test('badge keeps the window corner, 96px above the composer', () => {
  const offset = badgeOffset(VIEWPORT, SIZE)
  assert.equal(offset.right, 16)
  assert.equal(offset.bottom, 96)
})

test('badge clamps into a short viewport instead of sliding over the composer', () => {
  const tiny = badgeOffset({ width: 200, height: 120 }, SIZE)
  assert.equal(tiny.right, 16)
  assert.equal(tiny.bottom, 80) // 120 - 28 - 12
})

test('badge clamps its right offset on a narrow viewport', () => {
  const narrow = badgeOffset({ width: 100, height: 800 }, SIZE)
  assert.equal(narrow.right, 12)
  assert.equal(narrow.bottom, 96)
})

test('stripChipRanges cuts the chip projection but keeps typed text', () => {
  const block = '【批注 · 请逐条回应】\n1. 原文：「甲」\n【批注结束】'
  const draft = '前言\n' + block + '\n后记'
  const occurrences = [{ source: 'margin-notes', ref: 'mn-1', offset: 3, length: block.length }]
  assert.equal(stripChipRanges(draft, occurrences), '前言\n\n后记')
})

test('detectLength counts a chip as one placeholder character', () => {
  const draft = 'ab' + 'x'.repeat(50) + 'c'
  const occurrences = [{ source: 'margin-notes', ref: 'mn-1', offset: 2, length: 50 }]
  assert.equal(detectLength(draft, occurrences), 4)
  assert.equal(detectLength('abc', []), 3)
})

test('findChip ignores reference chips from other sources', () => {
  assert.equal(findChip([{ source: 'file', ref: 'f-1' }]), null)
  const chip = { source: 'margin-notes', ref: 'mn-1' }
  assert.equal(findChip([{ source: 'file' }, chip]), chip)
})
