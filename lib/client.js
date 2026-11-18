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
      // Inline reference chip: the composer shows one token, the codec below
      // expands it to the full block only at submit time.
      var CHIP_SOURCE = 'margin-notes'
      // Registered with the CSS Custom Highlight API so annotated passages stay
      // visibly marked while reading. Pins (below) carry the click target.
      var HIGHLIGHT_NAME = 'margin-notes'
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
          chipLabel: '批注块',
          sentChip: '已作为批注块加入输入框，发送时展开。',
          merged: '已更新输入框里的批注块。',
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
          chipLabel: 'Annotations',
          sentChip: 'Added as an annotation chip — it expands when sent.',
          merged: 'Updated the annotation chip in the composer.',
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

      function chipStoreKey(ref) {
        return 'dsh-margin-notes:chip:v1:' + ref
      }

      /** Keep the last 24 chip payloads so a restored draft still expands. */
      function pruneChipStore() {
        try {
          var prefix = 'dsh-margin-notes:chip:v1:'
          var keys = []
          for (var i = 0; i < window.localStorage.length; i++) {
            var key = window.localStorage.key(i)
            if (key !== null && key.indexOf(prefix) === 0) keys.push(key)
          }
          if (keys.length <= 24) return
          keys.sort()
          for (var j = 0; j < keys.length - 24; j++) window.localStorage.removeItem(keys[j])
        } catch (err) {
          /* storage can be blocked; the in-memory map still works */
        }
      }

      function rememberChip(ref, rec) {
        chipBlocks[ref] = rec
        try {
          window.localStorage.setItem(chipStoreKey(ref), JSON.stringify({ items: rec.items, label: rec.label, block: rec.block }))
          pruneChipStore()
        } catch (err) {
          /* quota or private mode: keep the run in memory only */
        }
      }

      function chipRecord(ref) {
        var rec = chipBlocks[ref]
        if (rec !== undefined) return rec
        try {
          var raw = window.localStorage.getItem(chipStoreKey(ref))
          if (raw === null) return undefined
          var parsed = JSON.parse(raw)
          if (parsed === null || typeof parsed !== 'object' || typeof parsed.block !== 'string') return undefined
          rec = {
            items: Array.isArray(parsed.items) ? parsed.items : [],
            label: typeof parsed.label === 'string' ? parsed.label : '',
            block: parsed.block,
          }
          chipBlocks[ref] = rec
          return rec
        } catch (err) {
          return undefined
        }
      }

      /**
       * Cut every chip's clipboard projection out of the draft. `state.draft`
       * is the clipboard view, where a chip expands to its full clipboardText;
       * guards that ask "did the user type a block/command?" must not see that
       * text or a chip would masquerade as a pasted block.
       */
      function stripChipRanges(draft, occurrences) {
        if (typeof draft !== 'string' || !Array.isArray(occurrences) || occurrences.length === 0) return draft
        var sorted = occurrences.slice().sort(function (a, b) {
          return (a && typeof a.offset === 'number' ? a.offset : 0) - (b && typeof b.offset === 'number' ? b.offset : 0)
        })
        var out = ''
        var cursor = 0
        for (var i = 0; i < sorted.length; i++) {
          var occ = sorted[i]
          if (occ === null || typeof occ !== 'object') continue
          var start = typeof occ.offset === 'number' ? occ.offset : 0
          var len = typeof occ.length === 'number' ? occ.length : 0
          if (start < cursor || start > draft.length) continue
          out += draft.slice(cursor, start)
          cursor = Math.min(draft.length, start + len)
        }
        return out + draft.slice(cursor)
      }

      /**
       * End of the draft in detect coordinates. Every chip counts as one
       * U+FFFC there, while `draft.length` counts its whole clipboardText.
       */
      function detectLength(draft, occurrences) {
        var end = typeof draft === 'string' ? draft.length : 0
        if (!Array.isArray(occurrences)) return end
        for (var i = 0; i < occurrences.length; i++) {
          var occ = occurrences[i]
          if (occ === null || typeof occ !== 'object') continue
          var len = typeof occ.length === 'number' ? occ.length : 0
          if (len > 1) end -= len - 1
        }
        return Math.max(0, end)
      }

      /** First chip owned by this plugin, if any. */
      function findChip(occurrences) {
        if (!Array.isArray(occurrences)) return null
        for (var i = 0; i < occurrences.length; i++) {
          var occ = occurrences[i]
          if (occ !== null && typeof occ === 'object' && occ.source === CHIP_SOURCE) return occ
        }
        return null
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
      var activeDoc = null // { root, kind, label }
      var storageKeyCache = ''
      var toolbar = null
      var toolbarPlan = null
      var popover = null
      var badge = null
      var panel = null
      // One entry per annotation whose quote still resolves in the mounted DOM.
      // Each entry owns a fixed-position numbered pin; `range` follows reflow.
      var marks = []
      var marksLayer = null
      var marksTimer = 0
      var marksRaf = 0
      var marksObserver = null
      var marksPaints = 0
      var highlightReady = typeof window.Highlight === 'function' && typeof CSS !== 'undefined' && CSS.highlights !== undefined && CSS.highlights !== null
      var toastTimer = 0
      var showTimer = 0
      var repositionTimers = []
      var repositionObserver = null
      var anchorRect = null
      var lastSelection = null
      var panelOpen = false
      var editingId = null
      var disposers = []
      // ref -> { items, label, block }: what the chip's codec hands the sink.
      var chipBlocks = Object.create(null)
      var chipSeq = 0
      var chipReady = false
      var lastSendMode = 'text'
      var disposed = false
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
        scheduleMarks()
      }

      function persistItems() {
        try {
          window.localStorage.setItem(storageKey(), JSON.stringify(items))
        } catch (err) {
          /* storage full / disabled: annotations stay in memory */
        }
        scheduleMarks()
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
      /**
       * Register the @-source whose codec expands one chip at submit time.
       * The chip itself is inserted by sendToComposer; this roster entry exists
       * so `inputTriggers.serializeReference()` can find the block text when the
       * user actually sends the message.
       */
      function registerChipSource(context) {
        var spec = {
          trigger: '@',
          name: CHIP_SOURCE,
          order: 40,
          showGroupTitle: false,
          candidates: function () {
            return Promise.resolve([])
          },
          onPick: function () {
            return undefined
          },
          codec: {
            clipboardText: function (ref) {
              var rec = chipRecord(ref)
              return rec !== undefined ? rec.block : ''
            },
            serialize: function (ref) {
              var rec = chipRecord(ref)
              if (rec === undefined) return Promise.reject(new Error('margin-notes: annotation block expired'))
              return Promise.resolve(rec.block)
            },
          },
        }
        var adopt = function (service) {
          if (disposed || service === null || service === undefined || typeof service.registerSource !== 'function') return
          try {
            var off = service.registerSource(spec)
            chipReady = true
            if (typeof off === 'function') disposers.push(off)
          } catch (err) {
            chipReady = false
          }
        }
        try {
          if (typeof context.get === 'function') adopt(context.get('inputTriggers'))
        } catch (err) {
          /* service not mounted yet */
        }
        if (chipReady) return
        try {
          if (typeof context.inject === 'function') {
            context.inject(['inputTriggers'], function (scope) {
              adopt(scope !== null && scope !== undefined ? scope.inputTriggers : undefined)
            })
          }
        } catch (err) {
          /* optional bridge: the text fallback still works */
        }
      }

      /** Insert the block into the current draft; returns an error string or ''. */
      function sendToComposer() {
        if (items.length === 0) return ''
        var sid = readSessionId()
        if (sid === '') return t('noSession')
        lastSendMode = 'text'

        try {
          // Focusing first also initializes an empty composer; some hosts only
          // create the draft editor once it has focus, and insertReference
          // needs a live editor to splice the chip into.
          focusComposer()
          var scoped = ctx.sessions.scope(sid)
          if (scoped === undefined || scoped === null) return t('noSession')
          var shell = ctx.conversation.input.for(scoped)
          var state = shell.state
          var snap = state !== undefined && typeof state.getSnapshot === 'function' ? state.getSnapshot() : undefined
          var draft = snap !== undefined && snap !== null && typeof snap.draft === 'string' ? snap.draft : ''
          var occurrences = snap !== undefined && snap !== null && Array.isArray(snap.occurrences) ? snap.occurrences : []
          // A chip's clipboard projection contains the whole block, so the
          // "already pasted" and slash guards must look at typed text only.
          var visible = stripChipRanges(draft, occurrences)

          if (hasBlock(visible)) return t('already')

          // A slash-command draft must stay a command: prepending a block would
          // turn `/goal …` into plain text.
          if (visible.trim().charAt(0) === '/') return t('slash')

          var label = items[0] !== undefined ? items[0].doc || '' : ''

          // A second click before sending folds into the existing chip instead
          // of leaving two blocks in the same draft.
          var existing = findChip(occurrences)
          var existingRecord = existing !== null && typeof existing.ref === 'string' ? chipRecord(existing.ref) : undefined
          if (existingRecord !== undefined) {
            existingRecord.items = existingRecord.items.concat(items)
            existingRecord.block = buildBlock(existingRecord.items, existingRecord.label, lang, false)
            rememberChip(existing.ref, existingRecord)
            lastSendMode = 'merged'
            return ''
          }

          if (chipReady && typeof shell.insertReference === 'function' && snap !== null && snap !== undefined && typeof snap.draftRev === 'number') {
            var ref = 'mn-' + Date.now().toString(36) + '-' + (++chipSeq)
            var block = buildBlock(items, label, lang, false)
            var at = detectLength(draft, occurrences)
            var inserted = false
            try {
              inserted = shell.insertReference(
                {
                  source: CHIP_SOURCE,
                  ref: ref,
                  label: t('chipLabel'),
                  appearance: 'file',
                  clipboardText: block,
                },
                { start: at, end: at, draftRev: snap.draftRev },
              )
            } catch (err) {
              inserted = false
            }
            if (!inserted) {
              // Do not fall back to setDraft here: that would wipe the user's
              // text and any chip already in the draft.
              return t('fail') + (lang === 'en' ? 'the composer is busy; try again.' : '输入框正忙，请稍后再试。')
            }
            rememberChip(ref, { items: items.slice(), label: label, block: block })
            lastSendMode = 'chip'
            return ''
          }

          // Older composer without reference chips: keep the text fallback.
          var hasQuestion = draft.trim() !== ''
          var fallback = buildBlock(items, label, lang, hasQuestion)
          shell.setDraft(fallback + (hasQuestion ? '\n' + draft : ''))
          lastSendMode = 'text'
          return ''
        } catch (err) {
          return t('fail') + (err instanceof Error ? err.message : String(err))
        }
      }

      /** First visible composer: several panes can keep one mounted each. */
      function findComposer() {
        var nodes = document.querySelectorAll('[data-composer-card] [data-composer-input]')
        var fallback = null
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i]
          if (!(node instanceof HTMLElement)) continue
          if (fallback === null) fallback = node
          var rect = node.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) return node
        }
        return fallback
      }

      function focusComposer() {
        var input = findComposer()
        if (!(input instanceof HTMLElement)) return
        var place = function () {
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
        }
        // Place the caret now. Deferring the whole thing to the next frame lets a
        // slow render (or a fresh selection made in between) move the caret
        // first, and the late `selectAllChildren` then wipes that selection.
        place()
        window.requestAnimationFrame(function () {
          if (!input.isConnected || document.activeElement !== input) return
          var sel = window.getSelection()
          // A selection made elsewhere in the meantime must win.
          if (sel !== null && !sel.isCollapsed && sel.rangeCount > 0 && !input.contains(sel.anchorNode)) return
          place()
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
        if (kind === 'chat') return { root: root, kind: 'chat', label: chatSourceLabel(root) }
        var label = titleFromRoot(root) || (lang === 'en' ? 'current document' : '当前文档')
        return { root: root, kind: 'doc', label: label }
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
          '.dsba-item-note { margin-top: 3px; font-size: 12px; line-height: 1.45; color: var(--dsw-alias-accent-fill, #7aa7ff); word-break: break-word;',
          '  cursor: pointer; border-radius: 3px; }',
          '.dsba-item-note:hover { text-decoration: underline; text-underline-offset: 2px; }',
          '.dsba-item-note:focus-visible { outline: 1px solid var(--dsw-alias-accent-fill, #4f8cff); outline-offset: 1px; }',
          '.dsba-note-empty { opacity: .55; font-style: italic; }',
          '.dsba-item { cursor: pointer; }',
          '.dsba-item-editing { background: var(--dsw-alias-bg-hover, rgba(255,255,255,.05)); }',
          '.dsba-edit-note { margin-top: 6px; min-height: 56px; font-size: 12px; }',
          '.dsba-edit-hint { margin-top: 4px; font-size: 11px; opacity: .5; }',
          '.dsba-edit-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 7px; }',
          '.dsba-item-doc { margin-top: 3px; font-size: 11px; opacity: .45; }',
          '.dsba-item-actions { flex: 0 0 auto; display: flex; flex-direction: column; gap: 2px; }',
          '.dsba-icon { border: 0; background: transparent; color: inherit; cursor: pointer; opacity: .5; font-size: 12px; padding: 2px 4px; border-radius: 4px; }',
          '.dsba-icon:hover { opacity: 1; background: var(--dsw-alias-bg-hover, rgba(255,255,255,.08)); }',
          '.dsba-action { border: 0; background: transparent; color: inherit; cursor: pointer; opacity: .55; font: inherit;',
          '  font-size: 11px; line-height: 16px; padding: 1px 4px; border-radius: 4px; white-space: nowrap; }',
          '.dsba-action:hover { opacity: 1; background: var(--dsw-alias-bg-hover, rgba(255,255,255,.08)); }',
          '.dsba-panel-foot { display: flex; gap: 6px; justify-content: flex-end; padding: 9px 12px;',
          '  border-top: 1px solid var(--dsw-alias-border-default, rgba(255,255,255,.12)); }',
          '.dsba-marks { position: fixed; inset: 0; z-index: ' + (Z_BASE - 1) + '; pointer-events: none; }',
          '.dsba-pin { position: fixed; z-index: 1; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%;',
          '  font: inherit; font-size: 10px; line-height: 18px; text-align: center; color: #fff; cursor: pointer;',
          '  background: var(--dsw-alias-accent-fill, #4f8cff); box-shadow: 0 2px 8px rgba(0,0,0,.35);',
          '  pointer-events: auto; opacity: .9; }',
          '.dsba-pin:hover, .dsba-pin:focus-visible { opacity: 1; transform: scale(1.12); outline: none; }',
          '.dsba-pin-rect { position: fixed; border-radius: 2px; background: rgba(79,140,255,.24); pointer-events: none; }',
          '.dsba-pin-editing { box-shadow: 0 0 0 3px rgba(79,140,255,.35), 0 2px 8px rgba(0,0,0,.35); }',
          '::highlight(' + HIGHLIGHT_NAME + ') { background-color: rgba(79,140,255,.24); }',
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
        node.setAttribute('role', 'status')
        node.setAttribute('aria-live', 'polite')
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
        card.setAttribute('role', 'dialog')
        card.setAttribute('aria-label', t('popoverTitle'))
        card.appendChild(el('div', 'dsba-popover-title', t('popoverTitle')))

        var quotePreview = el('div', 'dsba-quote', summarizeQuote(info.text, 220))
        quotePreview.title = info.text
        card.appendChild(quotePreview)

        var textarea = document.createElement('textarea')
        textarea.className = 'dsba-textarea'
        textarea.placeholder = t('placeholder')
        textarea.setAttribute('aria-label', t('placeholder'))
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
            // Same as the cancel button: the selection is still live, so without
            // this the next keyup can bring the toolbar back.
            suppressed = true
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

      /**
       * Offset from the viewport edges for the queue badge: bottom-right corner,
       * lifted 96px so the composer stays clear, then clamped into small
       * viewports. Pure so the geometry can be unit-tested without a DOM.
       *
       * `right`/`bottom` are distances FROM the viewport edges; feeding
       * `innerWidth` straight into the style parks the pill near the opposite
       * edge. The panel shares this anchor, so the badge must not drift into a
       * document pane's corner while the panel opens at the window corner.
       */
      function badgeOffset(viewport, size) {
        var width = size !== null && size !== undefined && size.width > 0 ? size.width : 96
        var height = size !== null && size !== undefined && size.height > 0 ? size.height : 28
        var right = Math.min(16, Math.max(12, viewport.width - width - 12))
        var bottom = Math.min(96, Math.max(12, viewport.height - height - 12))
        return { right: right, bottom: bottom }
      }

      function refreshBadgePosition() {
        if (badge === null) return
        var box = badge.getBoundingClientRect()
        var offset = badgeOffset({ width: window.innerWidth, height: window.innerHeight }, { width: box.width, height: box.height })
        badgeRight = offset.right + 'px'
        badgeBottom = offset.bottom + 'px'
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
        badge.setAttribute('aria-label', t('badge')(items.length))
        badge.setAttribute('aria-haspopup', 'dialog')
        badge.setAttribute('aria-expanded', panelOpen ? 'true' : 'false')
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
        if (badge !== null) badge.setAttribute('aria-expanded', 'false')
      }

      /** Scroll a resolved range into view and select it. */
      function revealRange(range) {
        if (range === null) return false
        // This is a programmatic selection: without suppressing the pill the
        // selectionchange handler would pop "＋ 批注" over the located quote.
        hideToolbar()
        suppressed = true
        var anchor = range.startContainer
        var parent = anchor instanceof Element ? anchor : anchor.parentElement
        var block = parent !== null && typeof parent.closest === 'function'
          ? parent.closest('p, li, blockquote, pre, td, th, h1, h2, h3, h4, h5, h6')
          : null
        var target = block !== null ? block : parent
        if (target !== null && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
        var sel = window.getSelection()
        if (sel !== null) {
          sel.removeAllRanges()
          sel.addRange(range)
        }
        positionMarksSoon()
        return true
      }

      /** Scroll to `quote` inside `root` and select it; true when found. */
      function revealQuote(root, quote) {
        return revealRange(findQuoteRange(root, quote))
      }

      /** Locate a queued annotation: chat turns first, then any mounted document. */
      function jumpToItem(item) {
        if (item === null || item === undefined) return false
        return revealRange(locateItem(item))
      }

      // ---------------------------------------------------------------------
      // in-page marks: highlight annotated passages, numbered pins edit them
      // ---------------------------------------------------------------------

      function ensureMarksLayer() {
        if (marksLayer !== null && marksLayer.isConnected) return marksLayer
        marksLayer = document.createElement('div')
        marksLayer.className = 'dsba-marks ' + ROOT_CLASS
        document.body.appendChild(marksLayer)
        return marksLayer
      }

      /**
       * Collapse every whitespace run to one space while remembering the raw
       * offset of each surviving character. Selection text and rendered DOM
       * drift on line breaks and indentation; this keeps the search stable.
       */
      function normalizeWithMap(text) {
        var out = ''
        var map = []
        var lastSpace = false
        for (var i = 0; i < text.length; i++) {
          var ch = text.charAt(i)
          var space = ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\v'
          if (space) {
            if (!lastSpace) {
              out += ' '
              map.push(i)
              lastSpace = true
            }
          } else {
            out += ch
            map.push(i)
            lastSpace = false
          }
        }
        return { text: out, map: map }
      }

      function pointInNodes(nodes, offset, preferNext) {
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i]
          if (preferNext ? offset < n.end : offset <= n.end) {
            var local = offset - n.start
            if (local < 0) local = 0
            if (local > n.node.nodeValue.length) local = n.node.nodeValue.length
            return { node: n.node, offset: local }
          }
        }
        var last = nodes[nodes.length - 1]
        return { node: last.node, offset: last.node.nodeValue.length }
      }

      function rangeFromOffsets(nodes, start, end) {
        var a = pointInNodes(nodes, start, true)
        var b = pointInNodes(nodes, end, false)
        var range = document.createRange()
        try {
          range.setStart(a.node, a.offset)
          range.setEnd(b.node, b.offset)
        } catch (err) {
          return null
        }
        return range
      }

      /** Find `quote` inside `root`, crossing inline elements and whitespace. */
      function findQuoteRange(root, quote) {
        if (!(root instanceof Element) || !root.isConnected) return null
        var needle = typeof quote === 'string' ? quote.trim() : ''
        if (needle === '') return null
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
        var nodes = []
        var text = ''
        var node = null
        while ((node = walker.nextNode()) !== null) {
          var value = node.nodeValue || ''
          if (value === '') continue
          var parent = node.parentElement
          if (parent !== null) {
            var tag = parent.tagName
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue
          }
          nodes.push({ node: node, start: text.length, end: text.length + value.length })
          text += value
        }
        if (nodes.length === 0) return null
        var start = text.indexOf(needle)
        var end = start + needle.length
        if (start < 0) {
          var normalized = normalizeWithMap(text)
          var q = needle.replace(/\s+/g, ' ').trim()
          var at = q === '' ? -1 : normalized.text.indexOf(q)
          if (at < 0) return null
          start = normalized.map[at]
          end = normalized.map[at + q.length - 1] + 1
        }
        if (start < 0 || end <= start) return null
        return rangeFromOffsets(nodes, start, end)
      }

      /** A mounted preview that is actually laid out (hidden copies are skipped). */
      function rootIsVisible(root) {
        if (!(root instanceof Element) || !root.isConnected) return false
        if (root.hidden) return false
        var rect = root.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) return false
        var style = window.getComputedStyle(root)
        return style.display !== 'none' && style.visibility !== 'hidden'
      }

      /** Resolve one queued annotation against the conversation or the open doc. */
      function locateItem(item) {
        if (item === null || item === undefined) return null
        if (item.kind === 'chat') {
          var rows = document.querySelectorAll(CHAT_ROOT_SELECTOR)
          for (var i = 0; i < rows.length; i++) {
            var found = findQuoteRange(rows[i], item.quote)
            if (found !== null) return found
          }
          return null
        }
        var roots = []
        function addRoot(root) {
          if (!(root instanceof Element) || !root.isConnected) return
          for (var k = 0; k < roots.length; k++) {
            if (roots[k] === root) return
          }
          roots.push(root)
        }
        if (activeDoc !== null && activeDoc.kind === 'doc') addRoot(activeDoc.root)
        // After a reload activeDoc is still null; scan the mounted previews so
        // saved document annotations get their pins back without a new gesture.
        var docs = document.querySelectorAll(DOC_ROOT_SELECTOR)
        for (var d = 0; d < docs.length; d++) addRoot(docs[d])
        // Prefer a laid-out preview: a hidden duplicate would otherwise win the
        // first indexOf match and leave the pin pointing at invisible text.
        for (var v = 0; v < roots.length; v++) {
          if (!rootIsVisible(roots[v])) continue
          var inVisible = findQuoteRange(roots[v], item.quote)
          if (inVisible !== null) return inVisible
        }
        for (var a = 0; a < roots.length; a++) {
          var inAny = findQuoteRange(roots[a], item.quote)
          if (inAny !== null) return inAny
        }
        return null
      }

      /**
       * Drop pin/box/highlight state but keep the marks layer mounted. Reusing
       * the layer matters: removing and re-appending it on every paint poked the
       * body MutationObserver and produced a self-feeding repaint loop.
       */
      function clearMarks() {
        window.clearTimeout(marksTimer)
        marksTimer = 0
        if (marksRaf !== 0) {
          window.cancelAnimationFrame(marksRaf)
          marksRaf = 0
        }
        for (var i = 0; i < marks.length; i++) {
          var entry = marks[i]
          if (entry.pin !== null) entry.pin.remove()
          for (var b = 0; b < entry.boxes.length; b++) entry.boxes[b].remove()
        }
        marks = []
        if (highlightReady) {
          try {
            CSS.highlights.delete(HIGHLIGHT_NAME)
          } catch (err) {
            /* older browsers without Highlights */
          }
        }
      }

      function removeMarks() {
        clearMarks()
        if (marksLayer !== null) {
          marksLayer.remove()
          marksLayer = null
        }
      }

      function positionMarks() {
        if (marks.length === 0) return
        var vw = window.innerWidth
        var vh = window.innerHeight
        for (var i = 0; i < marks.length; i++) {
          var entry = marks[i]
          var rects = []
          try {
            rects = entry.range.getClientRects()
          } catch (err) {
            entry.pin.style.display = 'none'
            continue
          }
          var first = null
          var visible = []
          for (var r = 0; r < rects.length; r++) {
            var rect = rects[r]
            if (rect.width <= 0 || rect.height <= 0) continue
            if (rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw) continue
            visible.push(rect)
            if (first === null) first = rect
          }
          if (first === null) {
            entry.pin.style.display = 'none'
          } else {
            entry.pin.style.display = 'block'
            // Anchor in the paragraph gutter when possible: a quote that starts
            // mid-line would otherwise put the pin on top of the preceding text.
            var left = first.left - 22
            var startEl = entry.range.startContainer instanceof Element
              ? entry.range.startContainer
              : entry.range.startContainer.parentElement
            var block = startEl !== null && startEl !== undefined
              ? startEl.closest('p, li, blockquote, pre, td, th, h1, h2, h3, h4, h5, h6')
              : null
            if (block !== null) {
              var blockRect = block.getBoundingClientRect()
              if (blockRect.left - 22 >= 4) left = blockRect.left - 22
            }
            if (left < 4) left = 4
            if (left > vw - 22) left = vw - 22
            var top = first.top + first.height / 2 - 9
            if (top < 4) top = 4
            if (top > vh - 22) top = vh - 22
            entry.pin.style.left = Math.round(left) + 'px'
            entry.pin.style.top = Math.round(top) + 'px'
            if (entry.id === editingId) entry.pin.classList.add('dsba-pin-editing')
            else entry.pin.classList.remove('dsba-pin-editing')
          }
          if (!highlightReady) {
            for (var x = 0; x < entry.boxes.length; x++) entry.boxes[x].remove()
            entry.boxes = []
            for (var v = 0; v < visible.length; v++) {
              var box = document.createElement('div')
              box.className = 'dsba-pin-rect ' + ROOT_CLASS
              box.style.left = Math.round(visible[v].left) + 'px'
              box.style.top = Math.round(visible[v].top) + 'px'
              box.style.width = Math.round(visible[v].width) + 'px'
              box.style.height = Math.round(visible[v].height) + 'px'
              marksLayer.appendChild(box)
              entry.boxes.push(box)
            }
          }
        }
      }

      function paintMarks() {
        marksPaints += 1
        clearMarks()
        if (disposed || items.length === 0) {
          if (marksObserver !== null) {
            marksObserver.disconnect()
            marksObserver = null
          }
          if (marksLayer !== null) {
            marksLayer.remove()
            marksLayer = null
          }
          return
        }
        var layer = ensureMarksLayer()
        var ranges = []
        for (var i = 0; i < items.length; i++) {
          var item = items[i]
          var range = locateItem(item)
          if (range === null) continue
          var pin = document.createElement('button')
          pin.type = 'button'
          pin.className = 'dsba-pin ' + ROOT_CLASS
          pin.textContent = String(i + 1)
          pin.setAttribute('aria-label', t('jump') + ' ' + (i + 1))
          var pinTitle = item.note !== '' ? item.quote + '\n' + item.note : item.quote
          pin.title = pinTitle.length > 160 ? pinTitle.slice(0, 160) + '…' : pinTitle
          pin.setAttribute('data-dsba-pin', item.id)
          pin.addEventListener('click', function (event) {
            event.preventDefault()
            event.stopPropagation()
            var id = this.getAttribute('data-dsba-pin')
            for (var k = 0; k < items.length; k++) {
              if (items[k].id === id) {
                openPanelForItem(items[k])
                return
              }
            }
          })
          layer.appendChild(pin)
          ranges.push(range)
          marks.push({ id: item.id, range: range, pin: pin, boxes: [] })
        }
        if (highlightReady) {
          try {
            var highlight = new Highlight()
            for (var h = 0; h < ranges.length; h++) highlight.add(ranges[h])
            CSS.highlights.set(HIGHLIGHT_NAME, highlight)
          } catch (err) {
            highlightReady = false
          }
        }
        positionMarks()
        // Start observing only after the layer exists: the first paint must not
        // be seen as an external mutation (that was the repaint loop's trigger).
        watchMarks()
      }

      function scheduleMarks() {
        if (disposed) return
        window.clearTimeout(marksTimer)
        marksTimer = window.setTimeout(function () {
          marksTimer = 0
          paintMarks()
        }, 120)
      }

      function positionMarksSoon() {
        if (marks.length === 0 || marksRaf !== 0) return
        marksRaf = window.requestAnimationFrame(function () {
          marksRaf = 0
          positionMarks()
        })
      }

      function openPanelForItem(item) {
        if (item === null || item === undefined) return
        panelOpen = true
        // A pin is a locator, not an edit shortcut: reveal the passage and show
        // the list; editing starts from the note text itself. Keep an editor that
        // is already open so an in-progress edit is not silently discarded.
        if (editingId === null) renderPanel()
        jumpToItem(item)
      }

      function watchMarks() {
        if (marksObserver !== null || typeof MutationObserver !== 'function') return
        marksObserver = new MutationObserver(function (records) {
          if (disposed || items.length === 0) return
          for (var i = 0; i < records.length; i++) {
            var target = records[i].target
            var elTarget = target instanceof Element ? target : target.parentElement
            if (elTarget !== null && elTarget.closest('.dsba-marks, .dsba-panel, .dsba-popover, .dsba-toolbar, .dsba-badge') !== null) continue
            scheduleMarks()
            return
          }
        })
        marksObserver.observe(document.body, { childList: true, subtree: true, characterData: true })
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
        panel.setAttribute('role', 'dialog')
        panel.setAttribute('aria-label', t('panelTitle'))

        var head = el('div', 'dsba-panel-head')
        head.appendChild(el('span', '', t('panelTitle') + ' · ' + items.length))
        var close = el('button', 'dsba-close', '✕')
        close.type = 'button'
        close.title = t('cancel')
        close.setAttribute('aria-label', t('cancel'))
        close.addEventListener('click', removePanel)
        head.appendChild(close)
        panel.appendChild(head)

        var list = el('div', 'dsba-list')
        list.setAttribute('role', 'list')
        if (items.length === 0) {
          list.appendChild(el('div', 'dsba-empty', t('empty')))
        } else {
          items.forEach(function (item, index) {
            var row = el('div', 'dsba-item')
            row.setAttribute('role', 'listitem')

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

            {
              var note = el('div', 'dsba-item-note dsba-note-btn' + (item.note === '' ? ' dsba-note-empty' : ''), noteOrDefault(item.note))
              note.title = t('editTitle')
              note.setAttribute('role', 'button')
              note.setAttribute('tabindex', '0')
              note.setAttribute('aria-label', t('editTitle'))
              note.addEventListener('click', function (event) {
                event.stopPropagation()
                startEdit(item.id)
              })
              note.addEventListener('keydown', function (event) {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                startEdit(item.id)
              })
              main.appendChild(note)
            }
            var meta = (item.doc || '') + (item.at !== undefined ? ' · ' + formatClock(item.at) : '')
            if (meta.trim() !== '') main.appendChild(el('div', 'dsba-item-doc', meta.trim()))
            main.title = t('jump')
            row.appendChild(main)

            var actions = el('div', 'dsba-item-actions')
            var del = el('button', 'dsba-action dsba-del-btn', t('remove'))
            del.type = 'button'
            del.title = t('remove')
            del.setAttribute('aria-label', t('remove'))
            del.addEventListener('click', function (event) {
              event.stopPropagation()
              removeItem(item.id)
              renderPanel()
              renderBadge()
              toast(t('removed'))
            })
            actions.appendChild(del)
            row.appendChild(actions)

            // Click the row (quote, meta, blank space) to reveal the passage;
            // the note text above stops propagation and opens the editor.
            row.addEventListener('click', function (event) {
              if (editingId === item.id) return
              var target = event.target
              if (target !== null && target.closest !== undefined && target.closest('button, textarea, input, a') !== null) return
              jumpToItem(item)
            })

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
          toast(lastSendMode === 'chip' ? t('sentChip') : lastSendMode === 'merged' ? t('merged') : t('sent'))
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
        if (badge !== null) badge.setAttribute('aria-expanded', 'true')
        positionMarks()
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
        positionMarksSoon()
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
        removeMarks()
        if (marksObserver !== null) {
          marksObserver.disconnect()
          marksObserver = null
        }
        var nodes = document.querySelectorAll('.dsba-toolbar, .dsba-popover, .dsba-panel, .dsba-badge, .dsba-marks, .dsba-pin, .dsba-pin-rect')
        for (var i = 0; i < nodes.length; i++) nodes[i].remove()
        toolbar = null
        popover = null
        panel = null
        badge = null
        panelOpen = false
        editingId = null
        suppressed = false
        chipBlocks = Object.create(null)
        chipSeq = 0
        chipReady = false
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
        disposed = false
        lang = detectLang(context)
        registerChipSource(context)
        activeDoc = null
        injectStyle()
        loadItems()
        renderBadge()
        window.setTimeout(function () {
          if (!disposed) paintMarks()
        }, 350)

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

        // Follow locale switches too: labels are otherwise painted once and stay
        // in the language that was active at mount time.
        try {
          var locale = context.locale
          if (locale !== undefined && locale !== null && typeof locale.subscribe === 'function') {
            disposers.push(locale.subscribe(function () {
              var next = detectLang(context)
              if (next === lang) return
              lang = next
              renderBadge()
              if (panelOpen) renderPanel()
              if (toolbar !== null) {
                var annotateBtn = toolbar.querySelector('.dsba-toolbar-btn')
                if (annotateBtn !== null) annotateBtn.textContent = t('annotate')
              }
            }))
          }
        } catch (err) {
          /* locale following is best-effort */
        }

        document.addEventListener('mouseup', onSelectionEvent, true)
        document.addEventListener('keyup', onSelectionEvent, true)
        document.addEventListener('mousedown', onDocumentPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        document.addEventListener('selectionchange', onSelectionChange, true)
        window.addEventListener('scroll', onViewportChange, true)
        window.addEventListener('resize', onViewportChange)

        function teardown() {
          disposed = true
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
          removeMarks()
          activeDoc = null
          if (marksObserver !== null) {
            marksObserver.disconnect()
            marksObserver = null
          }
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
        badgeOffset: badgeOffset,
        stripChipRanges: stripChipRanges,
        detectLength: detectLength,
        findChip: findChip,
        findQuoteRange: findQuoteRange,
        marksPaintCount: function () { return marksPaints },
        formatClock: formatClock,
      }

      return module.exports
    },
  })
})()
