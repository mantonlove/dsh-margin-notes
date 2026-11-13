/**
 * dsh-margin-notes — browser half.
 *
 * Goal: while reading a document in the DSH right sidebar (or in a fullscreen
 * preview), select text, attach a short note, collect any number of such
 * annotations, then push all of them into the composer draft with one click
 * and send once.
 *
 * Strategy: stay outside the rendering pipeline. We listen for text selection
 * in the DOM, anchor on the container that holds the document (the host's
 * preview attrs when present, otherwise the sidebar panel host that
 * dsh-better-sidebar mounts, otherwise the fullscreen overlay), keep the
 * annotations in localStorage, and paste a single Markdown-ish block into the
 * composer through the public client API:
 *
 *   const scoped = ctx.sessions.scope(sessionId)
 *   const shell  = ctx.conversation.input.for(scoped)
 *   shell.state.getSnapshot().draft   // current draft
 *   shell.setDraft(text)              // replace draft
 *
 * Everything is defensive: if a service or a DOM anchor is missing we degrade
 * (badge still works, send reports a toast) instead of throwing into the app.
 */

;(function () {
  'use strict'

  var PKG = 'dsh-margin-notes'

  window.__ModuleLoader__.load({
    id: PKG,
    factory: function (require) {
      var module = { exports: {} }
      var exports = module.exports

      // ---------------------------------------------------------------------
      // constants
      // ---------------------------------------------------------------------

      var STYLE_ID = 'dsba-style'
      var Z_BASE = 1200
      var MAX_QUOTE_INPUT = 4000
      var MAX_QUOTE_IN_BLOCK = 400
      var STORAGE_PREFIX = 'dsh-margin-notes:v1:'
      // Renamed from dsh-batch-annotations; a queue saved under the old key is
      // adopted on first load instead of silently disappearing.
      var LEGACY_STORAGE_PREFIX = 'dsh-batch-annotations:v1:'
      var BLOCK_MARK = '【批注 · 请逐条回应】'
      var BLOCK_MARK_EN = '[Annotations — respond one by one]'
      var ROOT_CLASS = 'dsba-root'
      // Selection-pill geometry shared with the placement planner. The host's
      // own pill (better-sidebar "Add to conversation") hinges 8px above the
      // selection at the selection's centre — so ours defaults to BELOW it.
      var TOOLBAR_GAP = 8
      var TOOLBAR_FALLBACK_WIDTH = 96
      var TOOLBAR_FALLBACK_HEIGHT = 28
      // Anchors observed in DSH 0.2.1-rc.3 + dsh-better-sidebar 0.28.0.
      // Host previews expose data-textpreview-url; better-sidebar mounts its own
      // panes under data-dsh-panel-host / data-sidebar-right-panel; the native
      // right sidebar uses data-sidebar-right-panel too.
      var DOC_ROOT_SELECTOR = [
        '[data-textpreview-url]',
        '[data-resource-url]',
        '[data-dsh-panel-host]',
        '[data-sidebar-right-panel]',
        '[data-dsh-native-tab-host]',
        '[data-fullscreen-preview]',
      ].join(',')
      // Assistant turns in the conversation. `data-chat-flow-kind` is written by
      // @deepseek-ai/dsh-client-ui-chat on every rendered flow row (App
      // 0.2.1-rc.3: `"data-chat-flow-kind": routedNode.kind`); the kinds that
      // carry answer / reasoning prose are assistant-step (one step of a reply)
      // and turn-process (folded process rows).
      var CHAT_ROOT_SELECTOR = '[data-chat-flow-kind="assistant-step"], [data-chat-flow-kind="turn-process"]'

      // ---------------------------------------------------------------------
      // i18n
      // ---------------------------------------------------------------------

      var STRINGS = {
        zh: {
          annotate: '＋ 批注',
          popoverTitle: '添加批注',
          placeholder: '这条批注想说什么？（可留空，只标位置）',
          save: '保存',
          cancel: '取消',
          savedOne: '已加入批注清单',
          saved: function (n) {
            return '已加入批注清单（' + n + ' 条）'
          },
          badge: function (n) {
            return '批注 ' + n
          },
          panelTitle: '批注清单',
          empty: '选中文档里的文字，点浮出的「＋ 批注」。',
          emptyNote: '（无文字，仅标记此段）',
          send: '发送到输入框',
          clear: '清空',
          clearConfirm: '清空全部批注？',
          sent: '批注已放入输入框，可补一句提问后回车发送。',
          noSession: '找不到当前会话，批注未放入输入框。',
          already: '输入框里已有批注块，未重复追加。',
          slash: '输入框里是斜杠命令草稿，批注未拼入。可先清空命令再试。',
          fail: '放入输入框失败：',
          remove: '删除',
          jump: '定位',
          undo: '撤销',
          removed: '已删除一条批注',
          edit: '编辑',
          editTitle: '编辑这条批注',
          editPlaceholder: '这条批注想说什么？（可留空，只标位置）',
          editSave: '保存修改',
          editCancel: '取消',
          updated: '批注已更新',
          editHint: '⌘Enter 保存 · Esc 取消',
          hint: '选中文字 → ＋批注；攒够后一次性发送',
        },
        en: {
          annotate: '＋ Annotate',
          popoverTitle: 'Add annotation',
          placeholder: 'What is wrong here? (optional)',
          save: 'Save',
          cancel: 'Cancel',
          savedOne: 'Annotation added',
          saved: function (n) {
            return 'Annotation added (' + n + ')'
          },
          badge: function (n) {
            return 'Annotations ' + n
          },
          panelTitle: 'Annotations',
          empty: 'Select text in the document, then press “＋ Annotate”.',
          emptyNote: '(no text, position only)',
          send: 'Send to composer',
          clear: 'Clear',
          clearConfirm: 'Clear all annotations?',
          sent: 'Annotations are in the composer — press Enter to send.',
          noSession: 'No active session; annotations were not inserted.',
          already: 'The draft already contains an annotation block.',
          slash: 'The draft starts with a slash command; annotations were not inserted.',
          fail: 'Could not insert into the composer: ',
          remove: 'Delete',
          jump: 'Go to',
          undo: 'Undo',
          removed: 'Annotation removed',
          edit: 'Edit',
          editTitle: 'Edit this annotation',
          editPlaceholder: 'What is wrong here? (optional)',
          editSave: 'Save changes',
          editCancel: 'Cancel',
          updated: 'Annotation updated',
          editHint: '⌘Enter to save · Esc to cancel',
          hint: 'Select text → ＋Annotate; send once when done',
        },
      }

      var lang = 'zh'

      function t(key) {
        var table = STRINGS[lang] || STRINGS.zh
        var val = table[key]
        if (val === undefined) return key
        return val
      }

      // ---------------------------------------------------------------------
      // pure helpers (exported through __test for unit tests)
      // ---------------------------------------------------------------------

      function stripHash(url) {
        var i = url.indexOf('#')
        return i >= 0 ? url.slice(0, i) : url
      }

      function decodeMaybe(value) {
        try {
          return decodeURIComponent(value)
        } catch (err) {
          return value
        }
      }

      /** dsh-resource://file/session/<id>/<relpath> → "<relpath>" ("" if unknown). */
      function resourcePathFromUrl(url) {
        if (typeof url !== 'string' || url === '') return ''
        var clean = stripHash(url)
        var m = /^dsh-resource:\/\/file\/session\/[^/]+\/(.+)$/.exec(clean)
        if (m) return decodeMaybe(m[1])
        var m2 = /^dsh-resource:\/\/file\/(.+)$/.exec(clean)
        if (m2) return decodeMaybe(m2[1].replace(/^session\/[^/]+\//, ''))
        return ''
      }

      function basename(path) {
        if (typeof path !== 'string' || path === '') return ''
        var clean = path.replace(/[\\/]+$/, '')
        var i = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
        return i >= 0 ? clean.slice(i + 1) : clean
      }

      /** Human label for a document: prefer the file name, fall back to the path. */
      function docLabelFromUrl(url) {
        var path = resourcePathFromUrl(url)
        if (path !== '') return basename(path) || path
        if (typeof url === 'string' && url !== '') return basename(stripHash(url)) || url
        return ''
      }

      /** Collapse whitespace and cut to `max` characters for prompt blocks. */
      function summarizeQuote(text, max) {
        var limit = typeof max === 'number' && max > 0 ? max : MAX_QUOTE_IN_BLOCK
        if (typeof text !== 'string') return ''
        var flat = text.replace(/\s+/g, ' ').trim()
        if (flat.length <= limit) return flat
        return flat.slice(0, limit - 1) + '…'
      }

      function noteOrDefault(note) {
        var trimmed = typeof note === 'string' ? note.trim() : ''
        return trimmed === '' ? t('emptyNote') : trimmed.replace(/\s*\n\s*/g, ' ').trim()
      }

      /**
       * Render the batch block. `items` entries: { quote, note, doc, kind }.
       * A single source keeps the compact header (`文档：x` / `来源：x`); when
       * annotations come from several places (documents, chat turns) each item
       * carries its own `来源：` line instead.
       * `hasQuestion` appends the question marker so the user's own draft text
       * (appended after the block) reads as a separate ask.
       */
      function buildBlock(items, docLabel, currentLang, hasQuestion) {
        var list = Array.isArray(items) ? items : []
        var zh = currentLang !== 'en'
        var head = zh ? BLOCK_MARK : BLOCK_MARK_EN
        var labels = []
        var onlyDocs = true
        for (var k = 0; k < list.length; k++) {
          var entry = list[k] || {}
          var entryDoc = typeof entry.doc === 'string' ? entry.doc.trim() : ''
          if (entryDoc !== '' && labels.indexOf(entryDoc) < 0) labels.push(entryDoc)
          if (entry.kind === 'chat') onlyDocs = false
        }
        var headerLabel = labels.length === 1 ? labels[0] : ''
        if (headerLabel === '' && labels.length === 0) {
          headerLabel = docLabel && docLabel.trim() !== '' ? docLabel.trim() : zh ? '当前文档' : 'current document'
        }
        var origin = onlyDocs ? (zh ? '文档：' : 'Document: ') : (zh ? '来源：' : 'Source: ')
        var lines = [head + (headerLabel !== '' ? origin + headerLabel : ''), '']
        // Several sources mixed in one batch → say where every item came from.
        var showSource = labels.length > 1

        for (var i = 0; i < list.length; i++) {
          var item = list[i] || {}
          var quote = summarizeQuote(item.quote, MAX_QUOTE_IN_BLOCK)
          if (quote === '') quote = zh ? '（未能取到原文）' : '(text unavailable)'
          var itemDoc = typeof item.doc === 'string' ? item.doc.trim() : ''
          if (showSource) {
            lines.push(i + 1 + '. ' + (zh ? '来源：' : 'Source: ') + (itemDoc !== '' ? itemDoc : zh ? '未知位置' : 'unknown'))
            lines.push('   ' + (zh ? '原文：「' : 'Text: “') + quote + (zh ? '」' : '”'))
          } else {
            lines.push(i + 1 + '. ' + (zh ? '原文：「' : 'Text: “') + quote + (zh ? '」' : '”'))
          }
          lines.push('   ' + (zh ? '批注：' : 'Note: ') + noteOrDefault(item.note))
          lines.push('')
        }

        lines.push(zh ? '请按「Annotation 1：…」逐条回应，不要遗漏。' : 'Answer each item as “Annotation 1: …”, one by one.')

        if (hasQuestion) {
          lines.push('')
          lines.push(zh ? '【我的提问】' : '[My question]')
          lines.push('')
        }

        lines.push(zh ? '【批注结束】' : '[Annotations end]')
        return lines.join('\n')
      }

      /** True when a draft already carries an annotation block (avoid double paste). */
      function hasBlock(draft) {
        if (typeof draft !== 'string' || draft === '') return false
        return draft.indexOf(BLOCK_MARK) >= 0 || draft.indexOf(BLOCK_MARK_EN) >= 0
      }

      function formatClock(ts) {
        try {
          var d = new Date(ts)
          return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
        } catch (err) {
          return ''
        }
      }

      // ---------------------------------------------------------------------
      // plugin state
      // ---------------------------------------------------------------------

      var ctx = null
      var items = []
      var activeDoc = null // { root, key, label }
      var storageKeyCache = ''
      var toolbar = null
      var toolbarPlan = null
      var popover = null
      var badge = null
      var panel = null
      var toastTimer = 0
      var showTimer = 0
      var repositionTimers = []
      var repositionObserver = null
      var anchorRect = null
      var lastSelection = null
      var panelOpen = false
      var editingId = null
      var disposers = []
      // After saving/cancelling, a stale document selection must not resurrect
      // the pill: wait for a fresh pointerdown inside the document.
      var suppressed = false
      var selCheckTimer = 0
      var HOST_KEY = '__dshBatchAnnotationsHost__'
      var hostRecord = null

      // ---------------------------------------------------------------------
      // session / composer bridge
      // ---------------------------------------------------------------------

      function readSessionId() {
        // 1) official host observable — 0.2.x binding carries `.key`
        try {
          var adapter = ctx !== null && ctx.uiSession !== undefined ? ctx.uiSession.adapter : undefined
          var current = adapter !== undefined && adapter !== null ? adapter.current : undefined
          if (current !== undefined && current !== null && typeof current.getSnapshot === 'function') {
            var binding = current.getSnapshot()
            if (binding !== undefined && binding !== null) {
              if (typeof binding.key === 'string' && binding.key !== '') return binding.key
              if (typeof binding.sessionId === 'string' && binding.sessionId !== '') return binding.sessionId
            }
          }
        } catch (err) {
          /* fall through */
        }

        // 2) legacy localStorage key written by the shell
        try {
          var raw = window.localStorage.getItem('dsh.sessions.current')
          if (raw !== null && raw !== '') {
            var parsed = JSON.parse(raw)
            if (parsed !== null && typeof parsed === 'object' && typeof parsed.sessionId === 'string' && parsed.sessionId !== '') {
              return parsed.sessionId
            }
          }
        } catch (err) {
          /* fall through */
        }

        // 3) sessions service snapshot
        try {
          if (ctx !== null && ctx.sessions !== undefined && typeof ctx.sessions.list === 'function') {
            var snap = ctx.sessions.list.getSnapshot()
            if (snap !== undefined && snap !== null) {
              if (typeof snap.current === 'string' && snap.current !== '') return snap.current
              if (Array.isArray(snap.items)) {
                for (var i = 0; i < snap.items.length; i++) {
                  if (snap.items[i] !== null && snap.items[i].current === true) return snap.items[i].id
                }
              }
            }
          }
        } catch (err) {
          /* fall through */
        }

        return ''
      }

      function storageKey() {
        var sid = readSessionId()
        var key = STORAGE_PREFIX + (sid !== '' ? sid : 'unknown')
        if (key !== storageKeyCache) {
          storageKeyCache = key
        }
        return key
      }

      function loadItems() {
        try {
          var raw = window.localStorage.getItem(storageKey())
          if (raw === null || raw === '') {
            var legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_PREFIX + storageKey().slice(STORAGE_PREFIX.length))
            if (legacyRaw !== null && legacyRaw !== '') {
              raw = legacyRaw
              window.localStorage.setItem(storageKey(), legacyRaw)
            }
          }
          var parsed = raw === null || raw === '' ? [] : JSON.parse(raw)
          items = Array.isArray(parsed)
            ? parsed
                .filter(function (it) {
                  return it !== null && typeof it === 'object' && typeof it.quote === 'string'
                })
                .map(function (it) {
                  // Older entries predate chat annotations and have no `kind`.
                  return {
                    id: typeof it.id === 'string' ? it.id : '',
                    quote: it.quote,
                    note: typeof it.note === 'string' ? it.note : '',
                    doc: typeof it.doc === 'string' ? it.doc : '',
                    kind: it.kind === 'chat' ? 'chat' : 'doc',
                    at: typeof it.at === 'number' ? it.at : Date.now(),
                  }
                })
            : []
        } catch (err) {
          items = []
        }
      }

      function persistItems() {
        try {
          window.localStorage.setItem(storageKey(), JSON.stringify(items))
        } catch (err) {
          /* storage full / disabled: annotations stay in memory */
        }
      }

      function addItem(quote, note, doc, kind) {
        items.push({
          id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          quote: quote,
          note: typeof note === 'string' ? note.trim() : '',
          doc: doc !== null && typeof doc === 'object' ? doc.label || '' : '',
          kind: kind === 'chat' ? 'chat' : 'doc',
          at: Date.now(),
        })
        persistItems()
      }

      function removeItem(id) {
        items = items.filter(function (it) {
          return it.id !== id
        })
        persistItems()
      }

      /** Rewrite a queued annotation's note; returns false when the id is gone. */
      function updateItemNote(id, note) {
        for (var i = 0; i < items.length; i++) {
          if (items[i].id !== id) continue
          items[i].note = typeof note === 'string' ? note.trim() : ''
          persistItems()
          return true
        }
        return false
      }

      function startEdit(id) {
        editingId = id
        renderPanel()
      }

      /** Insert the block into the current draft; returns an error string or ''. */
      function sendToComposer() {
        if (items.length === 0) return ''
        var sid = readSessionId()
        if (sid === '') return t('noSession')

        try {
          var scoped = ctx.sessions.scope(sid)
          if (scoped === undefined || scoped === null) return t('noSession')
          var shell = ctx.conversation.input.for(scoped)
          var state = shell.state
          var snap = state !== undefined && typeof state.getSnapshot === 'function' ? state.getSnapshot() : undefined
          var draft = snap !== undefined && snap !== null && typeof snap.draft === 'string' ? snap.draft : ''

          if (hasBlock(draft)) return t('already')

          // A slash-command draft must stay a command: prepending a block would
          // turn `/goal …` into plain text.
          if (draft.trim().charAt(0) === '/') return t('slash')

          var hasQuestion = draft.trim() !== ''
          var label = items[0] !== undefined ? items[0].doc || '' : ''
          var block = buildBlock(items, label, lang, hasQuestion)
          shell.setDraft(block + (hasQuestion ? '\n' + draft : ''))
          return ''
        } catch (err) {
          return t('fail') + (err instanceof Error ? err.message : String(err))
        }
      }

      function focusComposer() {
        var input = document.querySelector('[data-composer-card] [data-composer-input]')
        if (!(input instanceof HTMLElement)) return
        window.requestAnimationFrame(function () {
          if (!input.isConnected) return
          try {
            input.focus({ preventScroll: true })
            var sel = window.getSelection()
            if (sel !== null) {
              sel.selectAllChildren(input)
              sel.collapseToEnd()
            }
          } catch (err) {
            /* ignore */
          }
        })
      }

      // ---------------------------------------------------------------------
      // DOM utilities
      // ---------------------------------------------------------------------

      function el(tag, className, text) {
        var node = document.createElement(tag)
        if (typeof className === 'string' && className !== '') node.className = className
        if (typeof text === 'string') node.textContent = text
        return node
      }

      function isOurNode(node) {
        return node instanceof Element && node.closest('.' + ROOT_CLASS) !== null
      }

      function elementOf(node) {
        if (node === null || node === undefined) return null
        if (node instanceof Element) return node
        if (node.nodeType === Node.TEXT_NODE) return node.parentElement
        return null
      }

      function isEditable(el) {
        return el.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]') !== null
      }

      function inChatFlow(el) {
        return el.closest('[data-chat-flow], [data-focus-flow], [data-time-hover-root]') !== null
      }

      /** Walk out of any shadow root so `.closest()` can see host attributes. */
      function liftOutOfShadow(el) {
        var node = el
        for (var guard = 0; guard < 8; guard++) {
          if (typeof node.getRootNode !== 'function') return node
          var root = node.getRootNode()
          if (root === null || root === undefined || typeof ShadowRoot === 'undefined' || !(root instanceof ShadowRoot)) return node
          node = root.host
          if (node === null || node === undefined) return null
        }
        return node
      }

      /** "DSH 回复 · 第 3 轮" for a rendered assistant row (turn is optional). */
      function chatSourceLabel(root) {
        var turn = root !== null && typeof root.getAttribute === 'function' ? root.getAttribute('data-chat-turn') : null
        if ((turn === null || turn === '') && root !== null && typeof root.closest === 'function') {
          var owner = root.closest('[data-chat-turn]')
          if (owner !== null) turn = owner.getAttribute('data-chat-turn')
        }
        var base = lang === 'en' ? 'DSH reply' : 'DSH 回复'
        if (turn === null || turn === '' || turn === undefined) return base
        return lang === 'en' ? base + ' · turn ' + turn : base + ' · 第 ' + turn + ' 轮'
      }

      /** The side-panel document that owns this selection, if any. */
      function resolveDocRoot(el) {
        if (el === null) return null
        if (isEditable(el)) return null
        if (isOurNode(el)) return null
        var lifted = liftOutOfShadow(el)
        if (lifted === null) return null
        var root = lifted.closest(DOC_ROOT_SELECTOR)
        if (root === null) return null
        // The composer card lives inside the panel host in some layouts.
        if (root.querySelector('[data-composer-card]') !== null && el.closest('[data-composer-card]') !== null) return null
        return root
      }

      /** The assistant turn row that owns this selection, if any. */
      function resolveChatRoot(el) {
        if (el === null) return null
        if (isEditable(el)) return null
        if (isOurNode(el)) return null
        if (el.closest('[data-composer-card], [data-composer-input], [data-composer-seat]') !== null) return null
        // Pills/actions inside a step are chrome, not prose.
        if (el.closest('button, [role="button"], [role="menuitem"], [role="tab"]') !== null) return null
        var lifted = liftOutOfShadow(el)
        if (lifted === null) return null
        return lifted.closest(CHAT_ROOT_SELECTOR)
      }

      /**
       * Classify a selection: `{ kind, root }` for a readable document preview
       * or an assistant turn in the conversation, otherwise null. Chat chrome
       * is intentionally excluded so selecting a tool label never offers a pill.
       */
      function resolveSelectionSource(node) {
        var el = elementOf(node)
        if (el === null) return null
        if (isEditable(el)) return null
        if (isOurNode(el)) return null
        var chat = resolveChatRoot(el)
        if (chat !== null) return { kind: 'chat', root: chat }
        var doc = resolveDocRoot(el)
        if (doc !== null) return { kind: 'doc', root: doc }
        return null
      }

      function titleFromRoot(root) {
        var url = root.getAttribute('data-resource-url') || root.getAttribute('data-textpreview-url') || ''
        if (url !== '') {
          var label = docLabelFromUrl(url)
          if (label !== '') return label
        }
        var node = root.querySelector('[data-slot="title"], [data-dsh-tab-title], [role="tab"][aria-selected="true"], h1')
        if (node !== null) {
          var title = (node.getAttribute('title') || node.textContent || '').trim()
          if (title !== '') return title
        }
        return ''
      }

      function resolveDocInfo(root, kind) {
        if (kind === 'chat') {
          var chatLabel = chatSourceLabel(root)
          return { root: root, kind: 'chat', key: 'chat:' + chatLabel, label: chatLabel }
        }
        var url = root.getAttribute('data-resource-url') || root.getAttribute('data-textpreview-url') || ''
        var nested = url === '' ? root.querySelector('[data-resource-url], [data-textpreview-url]') : null
        if (nested !== null) url = nested.getAttribute('data-resource-url') || nested.getAttribute('data-textpreview-url') || ''
        var label = titleFromRoot(root) || (lang === 'en' ? 'current document' : '当前文档')
        return { root: root, kind: 'doc', key: url !== '' ? url : 'doc:' + label, label: label }
      }

      /** Current non-empty selection inside a document or reply, or null. */
      function readSelection() {
        var sel = window.getSelection()
        if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return null
        var text = sel.toString()
        if (typeof text !== 'string' || text.trim() === '') return null
        var range = sel.getRangeAt(0)
        var source = resolveSelectionSource(range.commonAncestorContainer)
        if (source === null) source = resolveSelectionSource(range.startContainer)
        if (source === null) return null
        var info = resolveDocInfo(source.root, source.kind)
        var rect = range.getBoundingClientRect()
        var clipped = text.length > MAX_QUOTE_INPUT ? text.slice(0, MAX_QUOTE_INPUT) + '…' : text
        return { text: clipped, root: source.root, kind: source.kind, label: info.label, rect: rect }
      }

      // ---------------------------------------------------------------------
      // style
      // ---------------------------------------------------------------------

      function injectStyle() {
        if (document.getElementById(STYLE_ID) !== null) return
        var style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = [
          '.' + ROOT_CLASS + ' { box-sizing: border-box; }',
          '.dsba-toolbar { position: fixed; z-index: ' + (Z_BASE + 2) + '; display: flex; gap: 2px; padding: 3px;',
          '  border: 1px solid var(--dsw-alias-border-default, rgba(255,255,255,.14)); border-radius: 8px;',
          '  background: var(--dsw-alias-bg-elevated, #26262b); box-shadow: 0 6px 24px rgba(0,0,0,.28); }',
          '.dsba-toolbar-btn { font: inherit; font-size: 12px; line-height: 18px; padding: 2px 8px; border: 0; border-radius: 6px;',
          '  color: var(--dsw-alias-text-primary, #eee); background: transparent; cursor: pointer; white-space: nowrap; }',
          '.dsba-toolbar-btn:hover { background: var(--dsw-alias-bg-hover, rgba(255,255,255,.08)); }',
          '.dsba-popover { position: fixed; z-index: ' + (Z_BASE + 3) + '; width: 320px; display: flex; flex-direction: column; gap: 8px;',
          '  padding: 10px; border: 1px solid var(--dsw-alias-border-default, rgba(255,255,255,.14)); border-radius: 10px;',
          '  background: var(--dsw-alias-bg-elevated, #26262b); box-shadow: 0 10px 32px rgba(0,0,0,.34);',
          '  color: var(--dsw-alias-text-primary, #eee); font-size: 13px; }',
          '.dsba-popover-title { font-weight: 600; font-size: 12px; opacity: .85; }',
          '.dsba-quote { font-size: 12px; line-height: 1.5; opacity: .7; max-height: 64px; overflow: hidden;',
          '  border-left: 2px solid var(--dsw-alias-accent-fill, #4f8cff); padding-left: 8px; white-space: pre-wrap; }',
          '.dsba-textarea { width: 100%; min-height: 68px; resize: vertical; font: inherit; font-size: 13px; padding: 7px 8px;',
          '  border: 1px solid var(--dsw-alias-border-default, rgba(255,255,255,.14)); border-radius: 7px;',
          '  background: var(--dsw-alias-bg-base, #1c1c20); color: inherit; outline: none; }',
          '.dsba-textarea:focus { border-color: var(--dsw-alias-accent-fill, #4f8cff); }',
          '.dsba-actions { display: flex; justify-content: flex-end; gap: 6px; }',
          '.dsba-btn-small { padding: 3px 10px; font-size: 12px; }',
          '.dsba-btn { font: inherit; font-size: 12px; padding: 4px 12px; border-radius: 7px; cursor: pointer;',
          '  border: 1px solid var(--dsw-alias-border-default, rgba(255,255,255,.14)); background: transparent; color: inherit; }',
          '.dsba-btn:hover { background: var(--dsw-alias-bg-hover, rgba(255,255,255,.08)); }',
          '.dsba-btn-primary { border-color: transparent; background: var(--dsw-alias-accent-fill, #4f8cff); color: #fff; }',
          '.dsba-btn-primary:hover { filter: brightness(1.08); background: var(--dsw-alias-accent-fill, #4f8cff); }',
          '.dsba-badge { position: fixed; z-index: ' + (Z_BASE + 1) + '; font: inherit; font-size: 12px; padding: 5px 12px;',
          '  border: 0; border-radius: 999px; cursor: pointer; color: #fff; background: var(--dsw-alias-accent-fill, #4f8cff);',
          '  white-space: nowrap; max-width: calc(100vw - 32px);',
          '  box-shadow: 0 4px 16px rgba(0,0,0,.3); }',
          '.dsba-badge:hover { filter: brightness(1.08); }',
          '.dsba-panel { position: fixed; z-index: ' + (Z_BASE + 4) + '; right: 14px; bottom: 92px; width: 340px;',
          '  max-width: calc(100vw - 28px); max-height: min(64vh, 520px); display: flex; flex-direction: column;',
          '  border: 1px solid var(--dsw-alias-border-default, rgba(255,255,255,.14)); border-radius: 10px;',
          '  background: var(--dsw-alias-bg-elevated, #26262b); box-shadow: 0 12px 40px rgba(0,0,0,.4);',
          '  color: var(--dsw-alias-text-primary, #eee); font-size: 13px; overflow: hidden; }',
          '.dsba-panel-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px;',
          '  border-bottom: 1px solid var(--dsw-alias-border-default, rgba(255,255,255,.12)); font-weight: 600; font-size: 12px; }',
          '.dsba-close { border: 0; background: transparent; color: inherit; cursor: pointer; opacity: .65; font-size: 14px; line-height: 1; }',
          '.dsba-close:hover { opacity: 1; }',
          '.dsba-list { overflow: auto; padding: 6px 0; flex: 1 1 auto; }',
          '.dsba-empty { padding: 22px 14px; text-align: center; opacity: .6; font-size: 12px; line-height: 1.6; }',
          '.dsba-item { display: flex; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,.06)); }',
          '.dsba-item:hover { background: var(--dsw-alias-bg-hover, rgba(255,255,255,.05)); }',
          '.dsba-item-idx { flex: 0 0 18px; font-size: 11px; opacity: .5; padding-top: 2px; }',
          '.dsba-item-main { flex: 1 1 auto; min-width: 0; }',
          '.dsba-item-quote { font-size: 12px; line-height: 1.45; opacity: .8; word-break: break-word; }',
          '.dsba-item-note { margin-top: 3px; font-size: 12px; line-height: 1.45; color: var(--dsw-alias-accent-fill, #7aa7ff); word-break: break-word; }',
          '.dsba-item-editing { background: var(--dsw-alias-bg-hover, rgba(255,255,255,.05)); }',
          '.dsba-edit-note { margin-top: 6px; min-height: 56px; font-size: 12px; }',
          '.dsba-edit-hint { margin-top: 4px; font-size: 11px; opacity: .5; }',
          '.dsba-edit-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 7px; }',
          '.dsba-item-doc { margin-top: 3px; font-size: 11px; opacity: .45; }',
          '.dsba-item-actions { flex: 0 0 auto; display: flex; flex-direction: column; gap: 2px; }',
          '.dsba-icon { border: 0; background: transparent; color: inherit; cursor: pointer; opacity: .5; font-size: 12px; padding: 2px 4px; border-radius: 4px; }',
          '.dsba-icon:hover { opacity: 1; background: var(--dsw-alias-bg-hover, rgba(255,255,255,.08)); }',
          '.dsba-panel-foot { display: flex; gap: 6px; justify-content: flex-end; padding: 9px 12px;',
          '  border-top: 1px solid var(--dsw-alias-border-default, rgba(255,255,255,.12)); }',
          '.dsba-toast { position: fixed; z-index: ' + (Z_BASE + 6) + '; left: 50%; bottom: 28px; transform: translateX(-50%);',
          '  max-width: 60vw; padding: 8px 14px; border-radius: 8px; font-size: 12px; line-height: 1.5; color: #fff;',
          '  background: rgba(20,20,24,.94); border: 1px solid rgba(255,255,255,.14); box-shadow: 0 8px 28px rgba(0,0,0,.4); }',
        ].join('\n')
        document.head.appendChild(style)
      }

      // ---------------------------------------------------------------------
      // toast
      // ---------------------------------------------------------------------

      function toast(message) {
        var old = document.querySelector('.dsba-toast')
        if (old !== null) old.remove()
        var node = el('div', 'dsba-toast ' + ROOT_CLASS, message)
        document.body.appendChild(node)
        window.clearTimeout(toastTimer)
        toastTimer = window.setTimeout(function () {
          node.remove()
        }, 3200)
      }

      // ---------------------------------------------------------------------
      // selection toolbar
      // ---------------------------------------------------------------------

      function hideToolbar() {
        window.clearTimeout(showTimer)
        clearRepositionWatch()
        if (toolbar !== null) {
          toolbar.remove()
          toolbar = null
        }
        toolbarPlan = null
        anchorRect = null
      }

      function clampNumber(value, min, max) {
        if (value < min) return min
        if (value > max) return max
        return value
      }

      /** Viewport box the toolbar would occupy for a placement plan. */
      function toolbarBox(plan, size) {
        return {
          left: plan.left - size.width / 2,
          right: plan.left + size.width / 2,
          top: plan.below ? plan.top : plan.top - size.height,
          bottom: plan.below ? plan.top + size.height : plan.top
        }
      }

      function boxIntersects(a, b, margin) {
        var m = margin === undefined ? 4 : margin
        if (a.right + m <= b.left || b.right + m <= a.left) return false
        if (a.bottom + m <= b.top || b.bottom + m <= a.top) return false
        return true
      }

      /**
       * Decide where the annotate pill floats.
       *
       * The host always anchors its own pill (better-sidebar's "Add to
       * conversation", DSH's quote action, …) ABOVE the selection, at the same
       * centre we used to pick — which is exactly why the two overlapped.
       * Defaulting to BELOW the selection separates them without needing any
       * host-private API; when something is still in the way we stack past it,
       * and when the selection hugs the bottom edge we flip above the obstacle.
       *
       * Pure on purpose: `obstacles` are viewport rects of foreign floating
       * chrome, so this is unit-testable without a DOM.
       */
      function planToolbarPlacement(input) {
        var rect = input.rect
        var size = input.size
        var viewport = input.viewport
        var obstacles = input.obstacles === undefined ? [] : input.obstacles
        var left = clampNumber(rect.left + rect.width / 2, 60, viewport.width - 60)
        var spaceBelow = viewport.height - rect.bottom - TOOLBAR_GAP
        var below = spaceBelow >= size.height + 4
        var plan = { left: left, top: below ? rect.bottom + TOOLBAR_GAP : rect.top - TOOLBAR_GAP, below: below }
        var i
        var hit = null
        var box = toolbarBox(plan, size)
        for (i = 0; i < obstacles.length; i++) {
          if (boxIntersects(box, obstacles[i])) {
            hit = obstacles[i]
            break
          }
        }
        if (hit === null) return plan
        if (plan.below) {
          // Something floats below the selection: sit under it when it fits,
          // otherwise flip above the selection (the usual host pill spot).
          var under = { left: left, top: hit.bottom + TOOLBAR_GAP + 2, below: true }
          if (under.top + size.height <= viewport.height - 4) return under
          return { left: left, top: rect.top - TOOLBAR_GAP, below: false }
        }
        // Flipped above because the selection hugs the bottom edge: stack above
        // the obstacle (the host pill) instead of on top of it.
        var above = { left: left, top: hit.top - TOOLBAR_GAP, below: false }
        if (above.top - size.height >= 4) return above
        return { left: left, top: rect.bottom + TOOLBAR_GAP, below: true }
      }

      /** Rects of the host's own selection popups that are currently mounted. */
      function hostPopupRects() {
        var rects = []
        var nodes = document.querySelectorAll('[class*="selectionPopup"], [data-dsh-selection-popup]')
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i]
          if (node.classList !== undefined && node.classList.contains(ROOT_CLASS)) continue
          var style = window.getComputedStyle(node)
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue
          var rect = node.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) rects.push(rect)
        }
        return rects
      }

      /** Foreign `position: fixed` chrome at viewport (x, y), or null. */
      function foreignChromeRectAt(x, y) {
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null
        var hit = document.elementFromPoint(x, y)
        var node = hit
        while (node !== null && node !== document.documentElement) {
          if (node.classList !== undefined && node.classList.contains(ROOT_CLASS)) return null
          var style = window.getComputedStyle(node)
          if (style.position === 'fixed' && style.display !== 'none' && style.visibility !== 'hidden') {
            return node.getBoundingClientRect()
          }
          node = node.parentElement
        }
        return null
      }

      /** Fixed chrome sampled around the selection (generic hosts). */
      function foreignChromeNearSelection() {
        var rect = anchorRect
        if (rect === null) return []
        var found = []
        var xs = [0.12, 0.5, 0.88]
        var ys = [rect.top - 34, rect.top - 12, rect.bottom + 14, rect.bottom + 34]
        var i, j
        for (i = 0; i < ys.length; i++) {
          for (j = 0; j < xs.length; j++) {
            var hitRect = foreignChromeRectAt(rect.left + rect.width * xs[j], ys[i])
            // The surface itself may be position:fixed (a pinned document
            // pane); covering the selection means it is the surface, not chrome.
            if (hitRect === null) continue
            if (hitRect.top <= rect.top + 1 && hitRect.bottom >= rect.bottom - 1) continue
            found.push(hitRect)
          }
        }
        return found
      }

      /** All obstacles that must not be covered by our pill. */
      function toolbarObstacles() {
        var rects = hostPopupRects().concat(foreignChromeNearSelection())
        var unique = []
        var i, j
        for (i = 0; i < rects.length; i++) {
          var rect = rects[i]
          var seen = false
          for (j = 0; j < unique.length; j++) {
            var other = unique[j]
            if (Math.abs(other.top - rect.top) < 1 && Math.abs(other.left - rect.left) < 1) {
              seen = true
              break
            }
          }
          if (!seen) unique.push(rect)
        }
        return unique
      }

      function placeToolbar() {
        if (toolbar === null || anchorRect === null) return
        var plan = planToolbarPlacement({
          rect: anchorRect,
          size: {
            width: toolbar.offsetWidth || TOOLBAR_FALLBACK_WIDTH,
            height: toolbar.offsetHeight || TOOLBAR_FALLBACK_HEIGHT
          },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          obstacles: toolbarObstacles()
        })
        toolbarPlan = plan
        toolbar.style.top = plan.top + 'px'
        toolbar.style.left = plan.left + 'px'
        toolbar.style.transform = plan.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)'
      }

      /**
       * The host pill is mounted asynchronously after the selection gesture, so
       * re-plan a few times right after showing; a short MutationObserver pass
       * catches late mounts as well. Everything is torn down with the toolbar.
       */
      function clearRepositionWatch() {
        while (repositionTimers.length > 0) window.clearTimeout(repositionTimers.pop())
        if (repositionObserver !== null) {
          repositionObserver.disconnect()
          repositionObserver = null
        }
      }

      function watchReposition() {
        clearRepositionWatch()
        var replan = function () {
          if (toolbar !== null) placeToolbar()
        }
        repositionTimers.push(window.setTimeout(replan, 90))
        repositionTimers.push(window.setTimeout(replan, 280))
        if (typeof window.MutationObserver === 'function') {
          try {
            repositionObserver = new window.MutationObserver(replan)
            repositionObserver.observe(document.body, { childList: true })
            repositionTimers.push(
              window.setTimeout(function () {
                if (repositionObserver !== null) {
                  repositionObserver.disconnect()
                  repositionObserver = null
                }
              }, 900)
            )
          } catch (err) {
            repositionObserver = null
          }
        }
      }

      function ensureToolbar(info) {
        if (toolbar === null) {
          toolbar = el('div', 'dsba-toolbar ' + ROOT_CLASS)
          var btn = el('button', 'dsba-toolbar-btn', t('annotate'))
          btn.type = 'button'
          // Keep the selection alive: the button must not steal focus.
          btn.addEventListener('mousedown', function (event) {
            event.preventDefault()
            event.stopPropagation()
          })
          btn.addEventListener('click', function (event) {
            event.preventDefault()
            event.stopPropagation()
            openPopover(lastSelection)
          })
          toolbar.appendChild(btn)
          // A hot-reloaded older instance may have left its own pill behind.
          var strays = document.querySelectorAll('.dsba-toolbar')
          for (var i = 0; i < strays.length; i++) {
            if (strays[i] !== toolbar) strays[i].remove()
          }
          document.body.appendChild(toolbar)
        }
        anchorRect = info.rect
        placeToolbar()
        watchReposition()
      }

      function scheduleToolbar() {
        if (suppressed) return
        window.clearTimeout(showTimer)
        showTimer = window.setTimeout(function () {
          var info = readSelection()
          if (info === null) {
            hideToolbar()
            return
          }
          lastSelection = info
          activeDoc = resolveDocInfo(info.root, info.kind)
          ensureToolbar(info)
          refreshBadgePosition()
        }, 30)
      }

      // ---------------------------------------------------------------------
      // annotation popover
      // ---------------------------------------------------------------------

      function closePopover() {
        if (popover !== null) {
          popover.remove()
          popover = null
        }
      }

      function openPopover(info) {
        if (info === null || info === undefined) return
        hideToolbar()
        closePopover()

        var doc = resolveDocInfo(info.root, info.kind)
        activeDoc = doc

        var card = el('div', 'dsba-popover ' + ROOT_CLASS)
        card.appendChild(el('div', 'dsba-popover-title', t('popoverTitle')))

        var quotePreview = el('div', 'dsba-quote', summarizeQuote(info.text, 220))
        quotePreview.title = info.text
        card.appendChild(quotePreview)

        var textarea = document.createElement('textarea')
        textarea.className = 'dsba-textarea'
        textarea.placeholder = t('placeholder')
        card.appendChild(textarea)

        var actions = el('div', 'dsba-actions ' + ROOT_CLASS)
        var cancel = el('button', 'dsba-btn', t('cancel'))
        cancel.type = 'button'
        var save = el('button', 'dsba-btn dsba-btn-primary', t('save'))
        save.type = 'button'
        actions.appendChild(cancel)
        actions.appendChild(save)
        card.appendChild(actions)

        function commit() {
          addItem(info.text, textarea.value, doc, info.kind)
          closePopover()
          suppressed = true
          if (window.getSelection() !== null) window.getSelection().removeAllRanges()
          renderBadge()
          if (panelOpen) renderPanel()
          toast(items.length === 1 ? t('savedOne') : t('saved')(items.length))
        }

        save.addEventListener('click', commit)
        cancel.addEventListener('click', function () {
          closePopover()
          suppressed = true
        })
        textarea.addEventListener('keydown', function (event) {
          if (event.key === 'Escape') {
            event.preventDefault()
            closePopover()
            return
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            commit()
          }
        })

        document.body.appendChild(card)
        popover = card

        var rect = info.rect
        var width = 320
        var left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)
        var top = rect.bottom + 10
        if (top + 220 > window.innerHeight) top = Math.max(12, rect.top - 220)
        card.style.left = left + 'px'
        card.style.top = top + 'px'
        textarea.focus()
      }

      // ---------------------------------------------------------------------
      // badge
      // ---------------------------------------------------------------------

      // `position: fixed` is only viewport-relative while no ancestor creates a
      // containing block (`transform` / `filter` / `contain` / `will-change`).
      // When one does, every floating node silently lands inside that arbitrary
      // box — the reported symptom is a 30x120 pill squeezed against the top-left
      // corner and half off-screen. The top layer (popover) ignores containing
      // blocks, so escalate only after measuring that the box is wrong.
      var topLayerMode = false
      var badgeRight = '16px'
      var badgeBottom = '96px'

      function isOffViewport(node) {
        if (node === null || node.isConnected !== true) return false
        var box = node.getBoundingClientRect()
        if (box.width < 1 || box.height < 1) return true
        return box.left < 0 || box.top < 0 ||
          box.right > window.innerWidth + 1 || box.bottom > window.innerHeight + 1
      }

      function offendingAncestors(node) {
        var out = []
        var walk = node.parentElement
        while (walk !== null && walk !== document.documentElement) {
          var cs = window.getComputedStyle(walk)
          var why = []
          if (cs.transform !== 'none') why.push('transform=' + cs.transform)
          if (cs.filter !== 'none') why.push('filter=' + cs.filter)
          if (typeof cs.backdropFilter === 'string' && cs.backdropFilter !== 'none') why.push('backdrop-filter=' + cs.backdropFilter)
          if (cs.perspective !== 'none') why.push('perspective=' + cs.perspective)
          if (cs.contain !== 'none' && cs.contain !== 'normal') why.push('contain=' + cs.contain)
          if (cs.willChange !== 'auto') why.push('will-change=' + cs.willChange)
          if (why.length > 0) {
            var cls = typeof walk.className === 'string' ? walk.className.trim().split(/\s+/).join('.') : ''
            out.push(walk.tagName.toLowerCase() + (cls === '' ? '' : '.' + cls) + ' [' + why.join(', ') + ']')
          }
          walk = walk.parentElement
        }
        return out
      }

      function recordPlacementDiag(kind, node) {
        try {
          var box = node.getBoundingClientRect()
          window.localStorage.setItem('dsba:diag', JSON.stringify({
            at: new Date().toISOString(),
            kind: kind,
            rect: { left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) },
            viewport: {
              innerWidth: window.innerWidth,
              innerHeight: window.innerHeight,
              clientWidth: document.documentElement.clientWidth,
              clientHeight: document.documentElement.clientHeight,
            },
            inline: node.getAttribute('style') || '',
            ancestors: offendingAncestors(node),
          }))
        } catch (err) {
          /* diagnostics must never break the UI */
        }
      }

      function promoteToTopLayer(node, right, bottom) {
        try {
          if (typeof node.showPopover !== 'function') return false
          if (!node.hasAttribute('popover')) node.setAttribute('popover', 'manual')
          node.style.margin = '0'
          node.style.inset = 'auto'
          node.style.right = right
          node.style.bottom = bottom
          if (typeof node.matches === 'function' && node.matches(':popover-open')) return true
          node.showPopover()
          return true
        } catch (err) {
          return false
        }
      }

      /** Mount a floating node and prove it actually landed inside the viewport. */
      function mountFloating(node, kind, right, bottom) {
        document.body.appendChild(node)
        if (topLayerMode) {
          promoteToTopLayer(node, right, bottom)
          return
        }
        window.requestAnimationFrame(function () {
          if (node.isConnected !== true || isOffViewport(node) !== true) return
          if (promoteToTopLayer(node, right, bottom)) {
            topLayerMode = true
            recordPlacementDiag(kind, node)
          }
        })
      }

      function removeBadge() {
        if (badge !== null) {
          badge.remove()
          badge = null
        }
      }

      function refreshBadgePosition() {
        if (badge === null) return
        var box = badge.getBoundingClientRect()
        var width = box.width > 0 ? box.width : 96
        var height = box.height > 0 ? box.height : 28
        var rect = null
        if (activeDoc !== null && activeDoc.kind !== 'chat' && activeDoc.root instanceof Element && activeDoc.root.isConnected) {
          rect = activeDoc.root.getBoundingClientRect()
        }
        // `right` / `bottom` are measured FROM the viewport edges, so they must
        // stay small. Feeding innerWidth / innerHeight into them parks the pill
        // off-screen: `right: innerWidth - 16` puts its right edge 16px from the
        // LEFT edge, and `bottom: innerHeight - 96` puts it 96px from the TOP.
        var right = 16
        var bottom = 96
        if (rect !== null) {
          right = Math.min(right, window.innerWidth - rect.right + 16)
          bottom = Math.min(bottom, window.innerHeight - rect.bottom + 16)
        }
        right = Math.min(Math.max(12, right), Math.max(12, window.innerWidth - width - 12))
        bottom = Math.min(Math.max(12, bottom), Math.max(12, window.innerHeight - height - 12))
        badgeRight = right + 'px'
        badgeBottom = bottom + 'px'
        badge.style.right = badgeRight
        badge.style.bottom = badgeBottom
        if (topLayerMode) {
          promoteToTopLayer(badge, badgeRight, badgeBottom)
          return
        }
        window.requestAnimationFrame(function () {
          if (badge === null || badge.isConnected !== true || isOffViewport(badge) !== true) return
          if (promoteToTopLayer(badge, badgeRight, badgeBottom)) {
            topLayerMode = true
            recordPlacementDiag('badge', badge)
          }
        })
      }

      function renderBadge() {
        if (items.length === 0) {
          removeBadge()
          if (panelOpen) renderPanel()
          return
        }
        if (badge === null) {
          badge = el('button', 'dsba-badge ' + ROOT_CLASS)
          badge.type = 'button'
          badge.addEventListener('click', function (event) {
            event.preventDefault()
            event.stopPropagation()
            togglePanel()
          })
        }
        badge.textContent = t('badge')(items.length)
        refreshBadgePosition()
        if (badge.isConnected !== true) mountFloating(badge, 'badge', badgeRight, badgeBottom)
      }

      // ---------------------------------------------------------------------
      // panel
      // ---------------------------------------------------------------------

      function removePanel() {
        if (panel !== null) {
          panel.remove()
          panel = null
        }
        panelOpen = false
        editingId = null
      }

      /** Scroll to `quote` inside `root` and select it; true when found. */
      function revealQuote(root, quote) {
        if (!(root instanceof Element) || !root.isConnected) return false
        var needle = summarizeQuote(quote, 40)
        if (needle === '') return false
        var head = needle.slice(0, 18)
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        var node = null
        while ((node = walker.nextNode()) !== null) {
          var text = node.nodeValue || ''
          if (text.indexOf(head) < 0) continue
          var parent = node.parentElement
          if (parent === null) continue
          parent.scrollIntoView({ block: 'center', behavior: 'smooth' })
          var range = document.createRange()
          range.selectNodeContents(node)
          var sel = window.getSelection()
          if (sel !== null) {
            sel.removeAllRanges()
            sel.addRange(range)
          }
          return true
        }
        return false
      }

      /** Locate a queued annotation: chat turns first, then the open document. */
      function jumpToItem(item) {
        if (item === null || item === undefined) return
        if (item.kind === 'chat') {
          var rows = document.querySelectorAll(CHAT_ROOT_SELECTOR)
          for (var i = 0; i < rows.length; i++) {
            if (revealQuote(rows[i], item.quote)) return
          }
        }
        if (activeDoc !== null && activeDoc.kind === 'doc') revealQuote(activeDoc.root, item.quote)
      }

      function renderPanel() {
        if (!panelOpen) return
        var prevScroll = 0
        var focusAfterRender = null
        if (panel !== null) {
          var prevList = panel.querySelector('.dsba-list')
          if (prevList !== null) prevScroll = prevList.scrollTop
          panel.remove()
        }
        panel = el('div', 'dsba-panel ' + ROOT_CLASS)

        var head = el('div', 'dsba-panel-head')
        head.appendChild(el('span', '', t('panelTitle') + ' · ' + items.length))
        var close = el('button', 'dsba-close', '✕')
        close.type = 'button'
        close.addEventListener('click', removePanel)
        head.appendChild(close)
        panel.appendChild(head)

        var list = el('div', 'dsba-list')
        if (items.length === 0) {
          list.appendChild(el('div', 'dsba-empty', t('empty')))
        } else {
          items.forEach(function (item, index) {
            var row = el('div', 'dsba-item')

            var idx = el('div', 'dsba-item-idx', String(index + 1))
            row.appendChild(idx)

            var main = el('div', 'dsba-item-main')
            main.appendChild(el('div', 'dsba-item-quote', summarizeQuote(item.quote, 110)))

            if (editingId === item.id) {
              row.classList.add('dsba-item-editing')
              var ta = document.createElement('textarea')
              ta.className = 'dsba-textarea dsba-edit-note'
              ta.value = item.note
              ta.placeholder = t('editPlaceholder')
              ta.rows = 3
              ta.spellcheck = false
              main.appendChild(ta)
              main.appendChild(el('div', 'dsba-edit-hint', t('editHint')))

              var commit = function () {
                updateItemNote(item.id, ta.value)
                editingId = null
                renderPanel()
                toast(t('updated'))
              }
              var editing = el('div', 'dsba-edit-actions')
              var cancelEdit = el('button', 'dsba-btn dsba-btn-small dsba-edit-cancel', t('editCancel'))
              cancelEdit.type = 'button'
              cancelEdit.addEventListener('click', function () {
                editingId = null
                renderPanel()
              })
              var saveEdit = el('button', 'dsba-btn dsba-btn-small dsba-btn-primary dsba-edit-save', t('editSave'))
              saveEdit.type = 'button'
              saveEdit.addEventListener('click', commit)
              ta.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  event.stopPropagation()
                  commit()
                }
              })
              editing.appendChild(cancelEdit)
              editing.appendChild(saveEdit)
              main.appendChild(editing)
              row.appendChild(main)
              list.appendChild(row)
              focusAfterRender = ta
              return
            }

            if (item.note !== '') main.appendChild(el('div', 'dsba-item-note', item.note))
            var meta = (item.doc || '') + (item.at !== undefined ? ' · ' + formatClock(item.at) : '')
            if (meta.trim() !== '') main.appendChild(el('div', 'dsba-item-doc', meta.trim()))
            main.title = t('editTitle')
            main.addEventListener('dblclick', function () {
              startEdit(item.id)
            })
            row.appendChild(main)

            var actions = el('div', 'dsba-item-actions')
            var edit = el('button', 'dsba-icon dsba-edit-btn', '\u270e')
            edit.type = 'button'
            edit.title = t('edit')
            edit.addEventListener('click', function () {
              startEdit(item.id)
            })
            var jump = el('button', 'dsba-icon', '\u2197')
            jump.type = 'button'
            jump.title = t('jump')
            jump.addEventListener('click', function () {
              jumpToItem(item)
            })
            var del = el('button', 'dsba-icon', '\u2715')
            del.type = 'button'
            del.title = t('remove')
            del.addEventListener('click', function () {
              removeItem(item.id)
              renderPanel()
              renderBadge()
              toast(t('removed'))
            })
            actions.appendChild(edit)
            actions.appendChild(jump)
            actions.appendChild(del)
            row.appendChild(actions)

            list.appendChild(row)
          })
        }
        panel.appendChild(list)

        var foot = el('div', 'dsba-panel-foot')
        var clear = el('button', 'dsba-btn', t('clear'))
        clear.type = 'button'
        clear.addEventListener('click', function () {
          if (items.length === 0) return
          if (!window.confirm(t('clearConfirm'))) return
          items = []
          persistItems()
          renderPanel()
          renderBadge()
        })
        var send = el('button', 'dsba-btn dsba-btn-primary', t('send'))
        send.type = 'button'
        send.addEventListener('click', function () {
          var error = sendToComposer()
          if (error !== '') {
            toast(error)
            return
          }
          items = []
          persistItems()
          renderPanel()
          renderBadge()
          toast(t('sent'))
          suppressed = true
          focusComposer()
        })
        foot.appendChild(clear)
        foot.appendChild(send)
        panel.appendChild(foot)

        mountFloating(panel, 'panel', '14px', '92px')
        list.scrollTop = prevScroll
        if (focusAfterRender !== null) {
          focusAfterRender.focus()
          try {
            focusAfterRender.setSelectionRange(focusAfterRender.value.length, focusAfterRender.value.length)
          } catch (err) {
            /* jsdom-style environments */
          }
        }
        panelOpen = true
      }

      function togglePanel() {
        if (panelOpen) {
          removePanel()
          return
        }
        // Open the flag first: renderPanel() refuses to paint while closed.
        panelOpen = true
        renderPanel()
      }

      // ---------------------------------------------------------------------
      // listeners
      // ---------------------------------------------------------------------

      function onSelectionEvent(event) {
        if (isOurNode(event.target instanceof Element ? event.target : null)) return
        scheduleToolbar()
      }

      function onDocumentPointerDown(event) {
        var target = event.target instanceof Element ? event.target : null
        if (isOurNode(target)) return
        if (target !== null && (target.closest(DOC_ROOT_SELECTOR) !== null || target.closest(CHAT_ROOT_SELECTOR) !== null)) suppressed = false
        hideToolbar()
        closePopover()
        if (panelOpen && target !== null && target.closest('.dsba-panel') === null) {
          // Clicking outside the panel closes it, mirroring the badge toggle.
          removePanel()
        }
      }

      /**
       * A selection can vanish without a mouseup (host re-render, another pane
       * taking focus, `removeAllRanges()`); the pill must not linger.
       */
      function onSelectionChange() {
        if (toolbar === null) return
        window.clearTimeout(selCheckTimer)
        selCheckTimer = window.setTimeout(function () {
          if (toolbar === null) return
          var sel = window.getSelection()
          if (sel === null || sel.isCollapsed || sel.toString().trim() === '') {
            hideToolbar()
            return
          }
          if (readSelection() === null) hideToolbar()
        }, 80)
      }

      function onViewportChange(event) {
        // A stale pill would point at the wrong spot after scrolling; the host
        // hides its own popup here too.
        if (toolbar !== null) hideToolbar()
        refreshBadgePosition()
      }

      function onKeyDown(event) {
        if (event.key === 'Escape') {
          if (editingId !== null) {
            editingId = null
            renderPanel()
            event.stopPropagation()
            return
          }
          hideToolbar()
          closePopover()
          removePanel()
        }
      }

      // ---------------------------------------------------------------------
      // plugin lifecycle
      // ---------------------------------------------------------------------

      function normalizeLang(value) {
        if (typeof value !== 'string' || value === '') return ''
        return value.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
      }

      function detectLang(context) {
        // 0.2.x locale service: getSnapshot().active ('zh' | 'en'), superseded by
        // the older plain `language` field some builds exposed.
        try {
          var value = context.locale
          if (value !== undefined && value !== null) {
            if (typeof value.getSnapshot === 'function') {
              var snap = value.getSnapshot()
              if (snap !== undefined && snap !== null) {
                var fromSnap = normalizeLang(snap.active) || normalizeLang(snap.language)
                if (fromSnap !== '') return fromSnap
              }
            }
            var direct = normalizeLang(value.active) || normalizeLang(value.language)
            if (direct !== '') return direct
          }
        } catch (err) {
          /* ignore */
        }
        try {
          var nav = window.navigator.language || ''
          return nav.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
        } catch (err) {
          return 'zh'
        }
      }

      exports.name = PKG
      // Cordis service names (not package ids); package ids live in
      // package.json dsh.client.inject so the loader knows what to pull in.
      exports.inject = ['sessions', 'conversation', 'locale', 'uiSession']

      /** Remove UI left behind by a previous instance (hot reload, crash). */
      function removeStrayNodes() {
        var nodes = document.querySelectorAll('.dsba-toolbar, .dsba-popover, .dsba-panel, .dsba-badge')
        for (var i = 0; i < nodes.length; i++) nodes[i].remove()
        toolbar = null
        popover = null
        panel = null
        badge = null
        panelOpen = false
        editingId = null
        suppressed = false
        window.clearTimeout(showTimer)
        window.clearTimeout(selCheckTimer)
        window.clearTimeout(toastTimer)
        clearRepositionWatch()
      }

      exports.apply = function apply(context) {
        // HMR can replace the client bundle without calling dispose() on the
        // old instance; take over instead of stacking a second pill.
        var previous = window[HOST_KEY]
        if (previous !== undefined && previous !== null && typeof previous.dispose === 'function') {
          try {
            previous.dispose()
          } catch (err) {
            /* an older build without our contract: fall through to cleanup */
          }
        }
        removeStrayNodes()

        ctx = context
        lang = detectLang(context)
        injectStyle()
        loadItems()
        renderBadge()

        // Follow session switches so the badge shows the right session's queue.
        try {
          var current = context.uiSession !== undefined && context.uiSession !== null
            ? context.uiSession.adapter.current
            : undefined
          if (current !== undefined && current !== null && typeof current.subscribe === 'function') {
            disposers.push(current.subscribe(function () {
              loadItems()
              renderBadge()
              if (panelOpen) renderPanel()
            }))
          }
        } catch (err) {
          /* session switching is best-effort */
        }

        document.addEventListener('mouseup', onSelectionEvent, true)
        document.addEventListener('keyup', onSelectionEvent, true)
        document.addEventListener('mousedown', onDocumentPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        document.addEventListener('selectionchange', onSelectionChange, true)
        window.addEventListener('scroll', onViewportChange, true)
        window.addEventListener('resize', onViewportChange)

        function teardown() {
          document.removeEventListener('mouseup', onSelectionEvent, true)
          document.removeEventListener('keyup', onSelectionEvent, true)
          document.removeEventListener('mousedown', onDocumentPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
          document.removeEventListener('selectionchange', onSelectionChange, true)
          window.removeEventListener('scroll', onViewportChange, true)
          window.removeEventListener('resize', onViewportChange)
          while (disposers.length > 0) {
            var disposeOne = disposers.pop()
            try {
              if (typeof disposeOne === 'function') disposeOne()
              else if (disposeOne !== null && typeof disposeOne.dispose === 'function') disposeOne.dispose()
            } catch (err) {
              /* ignore */
            }
          }
          hideToolbar()
          closePopover()
          removePanel()
          removeBadge()
          var style = document.getElementById(STYLE_ID)
          if (style !== null) style.remove()
          if (window[HOST_KEY] === hostRecord) {
            try {
              delete window[HOST_KEY]
            } catch (err) {
              window[HOST_KEY] = undefined
            }
          }
        }

        hostRecord = { dispose: teardown }
        window[HOST_KEY] = hostRecord
        return teardown
      }

      // Exposed for unit tests only; the plugin loader ignores extra exports.
      exports.__test = {
        buildBlock: buildBlock,
        hasBlock: hasBlock,
        summarizeQuote: summarizeQuote,
        resourcePathFromUrl: resourcePathFromUrl,
        docLabelFromUrl: docLabelFromUrl,
        basename: basename,
        noteOrDefault: noteOrDefault,
        planToolbarPlacement: planToolbarPlacement,
        toolbarBox: toolbarBox,
        formatClock: formatClock,
      }

      return module.exports
    },
  })
})()
