# Spec: Desktop CI 打包（Windows 安装包 + zip 免安装版）

## 背景与目标

仓库当前没有任何 GitHub Actions workflow。需要新增一个可手动触发的 action，在本仓库的
GitHub fork/私有运行环境中编译桌面端产物，同时产出：

1. 正式 NSIS 安装包（`ZCode-<version>-win-<arch>.exe`）；
2. **zip 免安装版（portable）**（`ZCode-<version>-win-<arch>.zip`），解压即用。

个人使用场景：**不做代码签名、不做公证**，不依赖任何 Apple/微软证书 secret。

## 非目标

- 不产出 macOS / Linux 产物（workflow 仅跑 `windows-latest`，x64）。
- 不接自动更新 feed 发布（`publish` 保持现有的 generic localhost 占位）。
- 不改 Preview/production 身份逻辑：CI 默认 `ZCODE_ENV=production`，得到正式 `ZCode`
  身份与无 `_TEST` 后缀的文件名。

## 产品规则

### R1 Windows 打包目标可扩展（zip = portable）

- `packages/desktop/electron-builder.config.js` 的 `win.target` 现固定为 `["nsis"]`。
- 新增环境变量 `ZCODE_DESKTOP_WIN_TARGETS`：逗号分隔的 target 列表（如 `nsis,zip`），
  显式设置时覆盖默认 `["nsis"]`；未设置时行为完全不变。
- 取值仅允许 `nsis` / `zip`，出现未知值时打包期直接失败（fail fast，防止拼错的 target
  静默产出非预期产物）。
- zip target 产物即官方 portable 语义：electron-builder 会把 `win-unpacked` 目录打成
  单个 zip，解压后直接运行 `ZCode.exe`，无需安装。个人使用不做任何签名配置
  （不设置 `CSC_LINK` / `WIN_CSC_LINK` 时 electron-builder 对 zip 与 nsis 均不签名）。

### R2 打包脚本能找到 zip 产物

- `packages/desktop/scripts/bundle.mjs` 的 `artifactExtensionsByOs.win` 从 `[".exe"]`
  扩展为 `[".exe", ".zip"]`，保证 bundle 收尾的体积审计（audit-bundle-size）能发现
  zip 产物；`audit-bundle-size.mjs` 已有 `.zip` 限额（500 MiB），无需修改。

### R3 CI 构建链路

GitHub Actions 上从零到出包的步骤与仓库既有脚本一一对应：

1. 检出仓库，setup Node（版本取 `mise.toml` 的 24.x），启用 corepack 获取 pnpm
   （版本由 `packageManager: pnpm@10.33.2` 锁定）。
2. `pnpm install`（含 desktop 的 `postinstall: node-pty-rebuild`）。
3. `pnpm --filter @zcode/desktop prepare:runtime-assets`：构建 agent JS bundle
   （zcode.cjs）、ripgrep 与 native-search 工具。Windows 打包**不**依赖
   `prepare:remote-assets` 的跨平台原生二进制（远端 SSH/WSL 资产），因此不执行它。
4. `pnpm --filter @zcode/desktop build:no-runtime-assets`：tsup/vite 生产构建。
5. `pnpm --filter @zcode/desktop exec electron-builder --config electron-builder.config.js
   --win --x64`，由 bundle.mjs 同款参数直接驱动 electron-builder（带重试逻辑的话直接
   走 `pnpm bundle:desktop -- --os win --arch x64` 更佳，它已包含 prepare/build/校验/
   体积审计全链路，所以 workflow 采用 `pnpm bundle:desktop`）。
6. 产物上传：`dist/` 下的 `.exe` 与 `.zip` 作为 workflow artifacts。

### R4 状态所有权

- 打包目标解析的唯一所有者是 `electron-builder.config.js`（bundle.mjs 不重复解析）。
- 产物文件名继续由 `buildDesktopArtifactName` 单点生成：`ZCode-<version>-win-x64.exe`
  与 `ZCode-<version>-win-x64.zip`（`ZCODE_ENV=production` 时无 `_TEST` 后缀）。

## 接口

| 名称 | 类型 | 说明 |
| ---- | ---- | ---- |
| `ZCODE_DESKTOP_WIN_TARGETS` | 环境变量 | 逗号分隔的 Windows 打包 target，允许 `nsis`、`zip`；缺省 `nsis` |
| `workflow_dispatch` | GitHub 事件 | 手动触发；输入 `runs_on` 预留，当前固定 `windows-latest` |

## 验收场景

1. **默认不变**：不设置 `ZCODE_DESKTOP_WIN_TARGETS` 时，config 的 `win.target` 仍为
   `["nsis"]`，现有打包链路不受影响。
2. **扩展 target**：设置 `ZCODE_DESKTOP_WIN_TARGETS=nsis,zip` 时，`win.target` 等于
   `["nsis","zip"]`，一次打包同时产出安装包与 zip 版。
3. **非法值失败**：`ZCODE_DESKTOP_WIN_TARGETS=dmg` 时 config 加载即抛错。
4. **CI 出包**：手动触发 workflow 后，artifacts 中同时存在 `.exe` 与 `.zip` 两个产物，
   文件名形如 `ZCode-3.14.3-win-x64.exe` / `ZCode-3.14.3-win-x64.zip`。
