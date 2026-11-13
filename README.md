# dsh-margin-notes

> Margin notes for DSH：在文档或助手回复里划词加一句批注，攒成一批一次性塞进输入框发送。

在 DSH 右侧栏 / 全屏预览里读文档、或在对话里读助手回复时，选中文字 → 加一条批注；攒够后一次性把整批批注塞进输入框再发送。

## 它解决什么

- 右侧栏或全屏看完一段文档，想改的地方很多，但输入框只能一条一条说。
- 现在：`选中文字 → ＋批注 → 写一句 → 继续读`，全部批注以浮动徽标计数。
- 对话里读回复时想吐槽的那一句也能直接圈住：助手回复、文档批注进同一个队列，发送时逐条标明来源。
- 写错了不用删了重来：清单里每条都能二次编辑（`✎` 或双击），改完再一起发。
- 读完后点徽标 → 「发送到输入框」，整批以结构化块进入草稿，可再补一句提问，回车发出。

## 交互

| 动作 | 结果 |
| --- | --- |
| 在文档里选中文字 | 选区**下方**浮现 `＋ 批注`（宿主的 `Add to conversation` 在上方，两者自动避让） |
| 在对话里选中助手回复 | 同样浮现 `＋ 批注`；条目来源记为 `DSH 回复 · 第 N 轮`（用户自己的消息、工具条、输入框不触发） |
| 点 `＋ 批注` | 弹出批注卡：原文预览 + 一句话批注（可留空） |
| `⌘/Ctrl + Enter` 或「保存」 | 加入清单，右下角徽标显示条数 |
| 点徽标 | 打开批注清单：逐条查看 / `✎` 编辑 / `↗` 定位 / `✕` 删除 / 清空 |
| 点 `✎` 或双击条目 | 就地改这条批注（原文保留，只改批注文字）；`⌘Enter` 保存，`Esc` 取消 |
| 「发送到输入框」 | 整批拼成块写入当前会话草稿，并把焦点交回输入框 |
| `Esc` | 关闭浮层；点空白处同样关闭 |

批注块形状（中文；界面为英文时自动切英文）：

```
【批注 · 请逐条回应】文档：report.md

1. 原文：「selected text …」
   批注：this claim needs a citation

2. 原文：「…」
   批注：（无文字，仅标记此段）

请按「Annotation 1：…」逐条回应，不要遗漏。

【批注结束】
```

同一个批次里既有文档又有回复（或多个文档）时，表头不再写单一文档，而是每条前面加一行来源：

```
【批注 · 请逐条回应】

1. 来源：DSH 回复 · 第 2 轮
   原文：「…」
   批注：…

2. 来源：draft.md
   原文：「…」
   批注：…
```

草稿里原本有文字时，块前置、原文追加在后，并在块尾加 `【我的提问】` 分隔；
草稿里已经有批注块时不重复追加。

## 浮层避让

better-sidebar 自己在选区**上方** 8px 处挂一个 `Add to conversation` 按钮（`<hash>_selectionPopup`，`position: fixed`，`translate(-50%, calc(-100% - 8px))`）。我们早期也按同样的锚点放胶囊，结果两个按钮叠在一起（截图里 `Add … tion` 从两边露出来）。

现在的定位规则（`planToolbarPlacement()`，纯函数、可单测）：

- 默认放在选区**下方** 8px，和宿主的胶囊天然分开；
- 选区贴着视口底边、下方放不下时，翻到上方并**叠在宿主胶囊之上**，而不是盖住它；
- 定位前扫一遍 `[class*="selectionPopup"]` 与选区附近的 `position: fixed` 浮层，落点相交就继续往外让；
- 宿主胶囊是异步挂载的，展示后 90ms / 280ms 各重算一次，并用 900ms 的 `MutationObserver` 兜住更晚的挂载；
- 文档面板自身若是 `position: fixed`，会被「是否包住选区」过滤掉，不会误判成浮层。

## 幽灵胶囊

- 保存或取消一条批注后，选区还留在文档里时**不再重复弹出**胶囊：`suppressed` 闸门只在文档区域重新按下鼠标（`mousedown`）时解除。
- 宿主异步恢复选区（`selectionchange`）会立刻收掉已显示的胶囊；选区被折叠、或移出文档区域时同样隐藏。
- `apply()` 幂等：新实例先 `dispose()` 旧实例、再清掉所有残留 `.dsba-*` 节点，句柄存在 `window.__dshBatchAnnotationsHost__`，HMR 反复替换也只保留一套 UI。
- 视口滚动 / 窗口缩放时收起胶囊（宿主也这么做），避免按钮停在错位的文字上。

## 兼容性

- **不接管文档渲染**：只监听选区，靠 DOM 锚点识别「这是文档区域」，因此不依赖 dsh-better-sidebar 的内部实现，侧栏、全屏、宿主原生预览都能用。
- **对话来源**：靠 `[data-chat-flow-kind="assistant-step"]` / `[data-chat-flow-kind="turn-process"]` 识别助手回复行（DSH 0.2.1-rc.3 实测属性），轮到第几轮取自 `data-chat-turn`；不劫持消息渲染。
- **不写宿主状态**：批注清单存在 `localStorage`，key 为 `dsh-margin-notes:v1:<sessionId>`。
- **降级**：找不到会话 / 服务缺失时只弹提示，不抛错到界面。

## 安装

DSH App → 侧栏「插件」→ 添加插件，三选一：

```
github:mantonlove/dsh-margin-notes                                        # 直接从仓库装
https://github.com/mantonlove/dsh-margin-notes/releases/latest/download/dsh-margin-notes.tgz   # 发布包
link:/absolute/path/to/dsh-margin-notes                                   # 本地开发，改代码即时生效
```

安装走官方 `installBundle`（inspect → pnpm add → 写 `dsh.profile.bundles`），HMR 生效，通常无需重启。从本地检出开发时见 `docs/install-and-verify.md`。

发布包：在仓库根执行 `npm pack`，把生成的 `dsh-margin-notes-<version>.tgz` 挂到 GitHub Release 的 `latest` 上即可（`files` 只含 `lib/`、`cordis.patch.yml`、`README.md`，无需构建）。

## 开发

```
node --test test/contract.test.mjs      # 12 项：App 侧加载合约（manifest / 注册 / 服务名 / 补丁）
node --test test/format.test.mjs        # 10 项：纯函数（选区过滤、块拼装、存储、locale）
node --test test/placement.test.mjs     # 7 项：浮层落点（默认在下、底边翻上、避让宿主胶囊、横向夹取）
python3 -m http.server 8732             # 在包根目录起服务
open http://127.0.0.1:8732/test/harness.html   # 57 项：真实浏览器里跑完整交互（含胶囊避让、清单二次编辑、幽灵胶囊回归、热替换幂等）
```

- `test/contract.test.mjs` 把 App 0.2.1-rc.3 自己的加载规则钉成断言：`dsh.client.platform === 'web'`、`exports["./client"]` 必须存在、注册 id 必须等于包名、`cordis.patch.yml` 的 insert 行、四个 Cordis 服务名。规则出处见 `docs/install-and-verify.md` 的「加载合约」表。

- 单元测试在 VM 沙箱里直接加载 **`lib/client.js`**（`window.__ModuleLoader__` 打桩），验证真实产物里的纯函数，不复制逻辑。
- `test/harness.html` 用假 `ctx`（`sessions` / `conversation` / `locale` / `uiSession`）和假 DOM 跑全链路：选区 → 浮层 → 弹卡 → 徽标 → 清单（含二次编辑 / Esc 取消）→ 拼块 → 写草稿，并断言「对话消息 / 输入框里的选区不触发」以及 `dispose` 清理。标题会显示 `HARNESS PASS` / `HARNESS FAIL` 和逐项结果。
- 这个 harness 已经抓到两个真实 bug：弹卡引用没赋值导致浮层叠罗汉、清单先渲染后置位导致面板空白。改交互后先跑它。

## 已知边界

- PDF / 图片预览里的文字选区取决于预览器是否为 DOM 文本；canvas 渲染的 PDF、以及塞进 iframe 的 HTML 预览选不中（跨文档拿不到选区）。
- 只处理文档区域；对话消息里的选区仍走 DSH 自身的「引用」能力。
- 批注不做正文内联高亮（避免与编辑器重渲染冲突），定位用清单里的 `↗`。

## License

MIT
