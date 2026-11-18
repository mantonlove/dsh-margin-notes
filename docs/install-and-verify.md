# 安装与验证 dsh-margin-notes

安装路径调研见 `../../notes/2026-10-26-local-plugin-install-path.md`。这里只写落地步骤。

## 0. 前置检查

- 包是 bundle 包：`package.json` 含 `dsh.bundle.patch`（`./cordis.patch.yml`）且文件存在 ✅
- `lib/index.js` 是有效 ESM（已写入，空插件）✅
- 加载合约自检通过：`node --test test/contract.test.mjs`（12/12）✅ —— 逐条对照 App 0.2.1-rc.3 自己的规则，见「0.2」
- 单元测试通过：`node --test test/format.test.mjs`（13/13）✅
- 浏览器 harness 通过：见下面「0.5」，最后一次结果 **90 passed, 0 failed** ✅（含宿主 `Add to conversation` 胶囊避让、清单二次编辑回归）
- 落点与 chip 单测：`node --test test/placement.test.mjs`（13/13）✅
- 当前 profile：`~/.dsh/profiles/desktop`（App 0.2.2-rc.2，better-sidebar 0.30.1，`dsh.bundle.builtinTabs` 仅 `editor`）

## 0.2 加载合约（App 侧硬规则，已核对源码）

`node --test test/contract.test.mjs` 就是把下面这些规则钉成断言；改 `package.json` / 入口文件后先跑它。

| 规则 | 出处（app.asar 内） |
| --- | --- |
| `dsh.client.platform` 必须是字符串，且只有 `"web"` 会被服务给 GUI | `@deepseek-ai/dsh-client-modules/lib/index.js:65,733` |
| 声明了 `dsh.client` 就必须有 `exports["./client"]`（字符串或 `{default}`），否则抛错 | 同上 `:172,739` |
| bundle 顶层必须同步调用 `window.__ModuleLoader__.load({ id, factory })`，`id` 必须是包名 | `@deepseek-ai/dsh-client-modules/lib/client.js:703` |
| 同一 id 只允许注册一次；只加载不注册会报 `loaded without registering "<id>"` | 同上 `:748` |
| `dsh.client.inject` 是**包名**数组，仅决定到达顺序 | 同上 `:777,790` |
| 客户端插件的 `exports.inject` 是 **Cordis 服务名**：`sessions` / `conversation` / `locale` / `uiSession` | 四个服务各自的注册处见 `test/contract.test.mjs` 注释 |
| 本地 spec 只接受**绝对路径**（`/abs`、`link:/abs`、`file:/abs`），相对路径直接 `invalid-spec` | `@deepseek-ai/dsh-plugin-manager/lib/index.js:73-108` |
| `inspect` 对本地路径要求：有可读 `package.json`、有 name、声明了 `dsh.bundle`，否则 `not-a-package` / `not-a-bundle` | 同上 `:1856-1867` |
| `dsh.manifestVersion` / `engines.dsh` 只是声明，安装器与加载器都不校验 | `@deepseek-ai/dsh-package-manifest/README.md` |

补充：`dsh.client.inject` 里列出的 `@deepseek-ai/dsh-client-ui-session` 等三个包，只是让宿主先加载它们的 bundle；即使写错也不会让插件不挂载（真正的挂载门槛是 `exports.inject` 的四个服务名）。

## 0.5 本地 harness 自测（不装进 App 也能跑）

```
cd /path/to/dsh-margin-notes
python3 -m http.server 8732
# 浏览器打开 http://127.0.0.1:8732/test/harness.html
```

页面标题为 `HARNESS PASS`、正文末尾 `RESULT 90 passed, 0 failed` 才算通过。它覆盖：bundle 注册、插件契约、选区过滤（文档 / 助手回复 / 用户消息 / 输入框）、浮层避让与关闭、徽标计数、按 session 持久化、清单渲染、清单内二次编辑（保存 / Esc 取消）、单来源块与混合来源块（文档 + 回复）拼装、写草稿、发送后清空、`dispose` 清理样式。
服务必须从**包根目录**起，否则 `../lib/client.js` 会 404。

## 1. 安装（官方 UI 路径，推荐）

1. 打开 DSH App 右侧栏「插件」页 → 「添加插件」
2. 输入：

   ```
   link:/path/to/dsh-margin-notes
   ```

3. 点「检查」→ 通过后「安装并启用」
4. 若 UI 提示 `restart-required`（如 package-moved），**不要立即重启**：
   当前会话会被杀掉（host pid 27421）。等本会话结束后手动执行
   你自己重启 DSH App 的方式。

两种等价写法，选一个粘：

- `link:/path/to/dsh-margin-notes` —— 软链，改代码即时生效（推荐）
- `/path/to/dsh-margin-notes` —— 裸绝对路径，pnpm 记成 `file:`

按 `parseInstallSpec`，`file:` 前缀也会被接受并剥掉，但 `file:` 有「拷贝后改源码不生效」的先例，不用。相对路径和 `~` 会被判 `invalid-spec` / 「a local path must be absolute」。

## 2. 验证清单（装完按顺序做）

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 右侧栏打开任意 `.md`（README 即可） | 正常渲染，控制台无 `dsh-margin-notes` 报错 |
| 2 | 在文档里选中一段文字 | 选区**下方**出现 `＋ 批注`；better-sidebar 的 `Add to conversation` 在选区上方，两枚胶囊不重叠 |
| 2b | 保存后不碰文档，等 1–2 秒（或切换右侧栏页签再切回） | 不会再冒出第二枚 `＋ 批注`；只有重新在文档里按下鼠标并选中时才出现 |
| 3b | 点徽标打开清单 → 第一条的 `✎` → 改文字 → `⌘Enter` | 清单即时显示新文字，面板不关；`Esc` 退出编辑且内容不变 |
| 3 | 点它 → 输入一句 → `⌘Enter` | 右下角出现 `批注 1` 徽标 |
| 4 | 再选一处加批注 | 徽标变 `批注 2` |
| 5 | 刷新页面 | 徽标仍是 `批注 2`（localStorage 持久化） |
| 6 | 点徽标 → 清单 | 两条都在，点条目能滚动定位，点批注文字能编辑，删除能删 |
| 7 | 点「发送到输入框」 | 草稿出现批注块，焦点回到输入框，徽标消失 |
| 8 | 回车发送 | 模型按 `Annotation 1/2` 逐条回应 |
| 9 | 全屏打开文档重复 2–3 | 同样可用 |
| 10 | 在助手回复里选文字 | 出现 `＋ 批注`；保存后清单来源为 `DSH 回复 · 第 N 轮` |
| 11 | 在用户自己发的消息、工具条、输入框里选文字 | **不**出现 `＋ 批注` |
| 12 | 一条文档批注 + 一条回复批注一起发送 | 草稿表头只有 `【批注 · 请逐条回应】`，每条前面有 `来源：…` 行 |

失败时先看 DevTools 控制台：`[dsh-margin-notes]` 无输出也无浮层 → 多半是 bundle 没被加载或 `exports.inject` 服务名不匹配。

## 3. 回滚

优先用 UI 卸载。UI 不可用时：

1. 退出 App
2. 还原备份：`package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `cordis.patch.yml` 的 `*.bak-STAMP`
3. 在 profile 目录执行 `pnpm install`

## 4. 开发迭代

`link:` 安装后改 `lib/client.js` 由 HMR 热替换；没热更就刷新一次页面（⌘R）。改 `package.json` / `cordis.patch.yml` 才需要重装或重启。

重建新实例时插件自己会接管：`apply()` 先调用上一实例的 `dispose()`（句柄存在 `window.__dshBatchAnnotationsHost__`）并清掉残留的 `.dsba-*` 节点，所以 HMR 反复替换也不会叠出两枚胶囊。
