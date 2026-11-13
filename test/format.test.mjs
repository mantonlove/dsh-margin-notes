import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

/**
 * Load the shipped client bundle (client.js) inside a VM sandbox that fakes the
 * DSH module loader, then exercise the pure helpers it exposes through
 * `exports.__test`. This keeps the tests pointed at the real artifact instead of
 * a copy of its logic.
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

assert.ok(typeof factory === 'function', 'client.js must register a factory with window.__ModuleLoader__')

const plugin = factory(() => {
  throw new Error('client bundle must not require host modules')
})

const { buildBlock, hasBlock, summarizeQuote, resourcePathFromUrl, docLabelFromUrl, basename, noteOrDefault } = plugin.__test

const ITEMS = [
  { quote: '第一段：这个结论的证据不足，需要补充对照组。', note: '这里的文献引用不对，换成 2023 年那篇。', doc: 'draft.md' },
  { quote: '第二段：样本量偏小。', note: '', doc: 'draft.md' },
]

test('buildBlock renders a numbered zh block with header and footer', () => {
  const block = buildBlock(ITEMS, 'draft.md', 'zh', false)
  const lines = block.split('\n')
  assert.equal(lines[0], '【批注 · 请逐条回应】文档：draft.md')
  assert.match(block, /1\. 原文：「第一段/)
  assert.match(block, /批注：这里的文献引用不对/)
  assert.match(block, /2\. 原文：「第二段：样本量偏小。」/)
  assert.match(block, /批注：（无文字，仅标记此段）/)
  assert.match(block, /请按「Annotation 1：…」逐条回应/)
  assert.ok(block.endsWith('【批注结束】'))
  assert.ok(!block.includes('【我的提问】'))
})

test('buildBlock appends the question marker only when the draft has text', () => {
  const withQuestion = buildBlock(ITEMS.slice(0, 1), 'draft.md', 'zh', true)
  assert.ok(withQuestion.includes('【我的提问】'))
  assert.ok(withQuestion.indexOf('【我的提问】') < withQuestion.indexOf('【批注结束】'))
})

test('buildBlock switches to en strings', () => {
  const block = buildBlock(ITEMS, 'draft.md', 'en', false)
  assert.match(block, /^\[Annotations — respond one by one\]Document: draft\.md/)
  assert.match(block, /Text: “/)
  assert.match(block, /Note: /)
  assert.ok(block.endsWith('[Annotations end]'))
})

test('buildBlock tolerates an empty list and a missing document label', () => {
  const block = buildBlock([], '', 'zh', false)
  assert.match(block, /文档：当前文档/)
  assert.ok(block.endsWith('【批注结束】'))
})

test('hasBlock detects zh and en blocks only', () => {
  assert.equal(hasBlock('【批注 · 请逐条回应】文档：a.md\n……'), true)
  assert.equal(hasBlock('[Annotations — respond one by one]Document: a.md'), true)
  assert.equal(hasBlock('你好，帮我看看这一段'), false)
  assert.equal(hasBlock(''), false)
  assert.equal(hasBlock(undefined), false)
})

test('summarizeQuote collapses whitespace and truncates with an ellipsis', () => {
  assert.equal(summarizeQuote('  a\n\n b\t c  '), 'a b c')
  const long = 'x'.repeat(50)
  const out = summarizeQuote(long, 10)
  assert.equal(out.length, 10)
  assert.ok(out.endsWith('…'))
  assert.equal(summarizeQuote(null), '')
})

test('resourcePathFromUrl extracts the decoded path', () => {
  assert.equal(
    resourcePathFromUrl('dsh-resource://file/session/abc-123/docs/报告%20v2.md#L3'),
    'docs/报告 v2.md',
  )
  assert.equal(resourcePathFromUrl('dsh-resource://file/session/abc-123/a.md'), 'a.md')
  assert.equal(resourcePathFromUrl('https://example.com/a.md'), '')
  assert.equal(resourcePathFromUrl(''), '')
})

test('docLabelFromUrl prefers the basename', () => {
  assert.equal(docLabelFromUrl('dsh-resource://file/session/abc/docs/报告%20v2.md'), '报告 v2.md')
  assert.equal(docLabelFromUrl(''), '')
})

test('basename handles posix and windows separators', () => {
  assert.equal(basename('a/b/c.md'), 'c.md')
  assert.equal(basename('C:\\work\\draft.docx'), 'draft.docx')
  assert.equal(basename('dir/'), 'dir')
  assert.equal(basename(''), '')
})

test('noteOrDefault maps an empty note to the placeholder', () => {
  assert.equal(noteOrDefault(''), '（无文字，仅标记此段）')
  assert.equal(noteOrDefault('   '), '（无文字，仅标记此段）')
  assert.equal(noteOrDefault('改一下'), '改一下')
  assert.equal(noteOrDefault('多行\n批注'), '多行 批注')
})

test('buildBlock labels a chat-only batch as a reply source', () => {
  const chat = [{ quote: '助手回复第一段：这个研究方向值得继续。', note: '这句太绝对', doc: 'DSH 回复 · 第 2 轮', kind: 'chat' }]
  const block = buildBlock(chat, 'DSH 回复 · 第 2 轮', 'zh', false)
  assert.equal(block.split('\n')[0], '【批注 · 请逐条回应】来源：DSH 回复 · 第 2 轮')
  assert.match(block, /1\. 原文：「助手回复第一段/)
  assert.ok(!block.includes('1. 来源：'), JSON.stringify(block))
})

test('buildBlock tags every item when documents and replies are mixed', () => {
  const mixed = [
    { quote: '文档里的一段', note: '改这里', doc: 'draft.md' },
    { quote: '回复里的一段', note: '这句太绝对', doc: 'DSH 回复 · 第 2 轮', kind: 'chat' },
  ]
  const block = buildBlock(mixed, 'draft.md', 'zh', false)
  assert.equal(block.split('\n')[0], '【批注 · 请逐条回应】')
  assert.match(block, /1\. 来源：draft\.md\n   原文：「文档里的一段」/)
  assert.match(block, /2\. 来源：DSH 回复 · 第 2 轮\n   原文：「回复里的一段」/)
})

test('buildBlock still renders legacy entries without kind/doc', () => {
  const block = buildBlock([{ quote: '旧条目', note: '以前存的' }], 'notes.md', 'zh', false)
  assert.equal(block.split('\n')[0], '【批注 · 请逐条回应】文档：notes.md')
})
