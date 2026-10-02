# Antigravity Tools Lite

[English](./README.md)

面向 [Antigravity](https://antigravity.google) 的本地桌面应用。用于管理 Antigravity 应用与其 `agy` CLI 所使用的 Google 账号，查看各模型配额与重置倒计时，并基于本机记录统计 Token 用量与预估 API 费用。账号与用量记录保存在本机，用量汇总在本地完成。Google 授权、令牌刷新和配额查询需要联网并使用相应凭据；价格同步也需要联网

![仪表盘 — Linux 原生 WebKitGTK](docs/screenshots/4.7.7/linux-dashboard-light.png)

Linux 真实 Tauri/WebKitGTK 视口，CI 调试构建 `6896ce61`，英文界面与合成示例数据，不含系统窗框。[截图来源与平台边界](docs/screenshots/4.7.7/README.md)

## 功能概览

- **账号管理** —— 导入本机已有账号、切换 Antigravity 使用的账号、为账号添加备注、删除账号
- **配额总览** —— 按模型查看配额与重置时间，并按 PRO / ULTRA / FREE 分组，支持表格与卡片两种视图
- **用量仪表盘** —— 今天、昨天、近 3 天、近 7 天或近 30 天的 Token 用量，按模型拆分，并给出预估 API 费用
- **快速仪表盘** —— 在菜单栏或托盘查看配额，使用独立按钮执行账号切换
- **低额度换号协调** —— 可选在检测到所有客户端退出后切换备用账号，不迁移运行中的任务
- **一个动作覆盖两个客户端** —— 一次切换同步 Antigravity 应用与已初始化的 `agy` CLI 所需的凭据
- **本地存储** —— 没有本项目运营的代理或凭据中转服务；账号与用量保存在本机，授权和配额请求直接访问 Google
- **中英双语界面** —— 简体中文与英文，浅色与深色主题，托盘菜单

## 下载安装

**[最新版本](https://github.com/anglee0323/antigravity-tools-lite/releases/latest)**

| 平台 | 安装包 | 安装方式 |
| --- | --- | --- |
| macOS（Apple Silicon） | `Antigravity-Tools-Lite-<版本>-macos-arm64.zip` | 解压后把 `Antigravity Tools Lite.app` 移入「应用程序」 |
| Windows（x64） | `Antigravity-Tools-Lite-<版本>-windows-x64-setup.exe` | NSIS 安装程序，按用户安装 |
| Linux（x64） | `Antigravity-Tools-Lite-<版本>-linux-amd64.deb` | `sudo apt install ./安装包.deb` |

当前发布流程没有配置 Developer ID 签名/公证或 Windows Authenticode 签名，系统可能提示或阻止运行下载的安装包。请先核对发布来源和校验值，再通过系统正常的审核流程自行决定是否信任。参见 [Apple 官方说明](https://support.apple.com/en-gb/102445)和 [Microsoft 应用信誉说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)。Homebrew 安装不会取消这些系统检查

**macOS 4.7.7 修复提示：** 如果下载的 4.7.7 提示「已损坏」，请在修正版 4.7.8 发布后升级，并保留旧 APP 和账号数据。4.7.8 修复应用包签名与直接发行版权限配置；完整 ad-hoc 签名不等于 Developer ID 签名或 Apple 公证，Gatekeeper 和原生 GUI 验收仍未完成。Homebrew 配方还需单独更新为已核验的新发布资产。

## 账号管理

点击 **+** 按钮添加账号，提供三种方式

- **OAuth 授权** —— 打开浏览器完成 Google 授权后即可添加
- **Refresh Token** —— 可粘贴单个 Token，也可粘贴 JSON 数组一次导入多个账号
- **从本机导入** —— 扫描系统凭据存储、Antigravity 数据库、已安装插件、原生 agy 会话以及旧版 CLI 数据目录（`~/.antigravity-agent`），导入找到的全部账号

![账号管理 — Linux 原生 WebKitGTK，合成示例数据](docs/screenshots/4.7.7/linux-accounts-light.png)

每一行提供四个操作，均带悬浮说明

| 操作 | 效果 |
| --- | --- |
| **切换到此账号** | 将所选账号写入 Antigravity 的凭据存储（2.0 以前的老版本写入 `state.vscdb`），并同步已初始化的原生 agy 会话。手动换号可能关闭并重启 Antigravity，请先保存工作。重新打开后核对账号；若提示部分更新失败，请检查两个客户端后再试 |
| **刷新此账号配额** | 重新读取该账号各模型的配额与重置时间 |
| **编辑备注** | 保存最多 15 个字符的短标签，用于区分账号 |
| **删除此账号** | 从本应用中移除该账号 |

列表支持按配额重置时间或最后使用时间排序、拖拽调整顺序、在表格与卡片视图之间切换。勾选多行可批量刷新或批量删除，筛选行可将列表收窄为全部、PRO、ULTRA 或 FREE

### 切换时为何会关闭应用

一次切换会同步 Antigravity 应用与已初始化的 `agy` CLI 所需的凭据位置。切换过程中关闭应用是必要的：正在运行的实例会在内存中保留旧 Token，并在刷新时写回凭据，使切换结果被静默覆盖。切换后请新开一条 CLI 命令；已运行的 CLI 命令可能仍持有旧 Token

对于 2.0 以前的 Antigravity 版本，没有凭据项可写，应用会自动改为把 Token 注入该版本本地的 `state.vscdb` 数据库，同时同步已初始化的原生 agy 会话。单独针对 IDE 的切换仍只处理该 IDE 的数据库

三个平台的原生 agy 会话路径均为 `~/.gemini/antigravity-cli/antigravity-oauth-token`。仅使用已有的 `antigravity-cli` 目录，正常 APP 同步可在需要时创建其中的首个 Token 文件。APP 与 agy 可能共享系统凭据，因此只更新会话文件不能确定新 agy 进程实际使用的账号。请使用正常 APP 同步，并在客户端确认当前身份。通用 Google Gemini CLI 的 `~/.gemini/oauth_creds.json` 和 `~/.gemini/google_accounts.json` 均不会被创建、修改或删除

会话采用原子替换与写后校验，Unix 文件权限为 `0600`。Linux 新版 APP 使用系统凭据切换时，若会话同步失败，会恢复之前的系统凭据。旧版 APP 的数据库更新不会回滚，会话失败时会报告部分更新。macOS/Windows 在系统凭据已更新后若会话同步失败，会明确报告部分更新，请确认两个客户端的状态后再重试

## 用量仪表盘

仪表盘读取 Antigravity 本地的对话数据库（`conversation.db`、`token_usage_archive.db`）及其归档目录，在本机汇总已记录的用量。Tools Lite 不上传对话内容，也不推算未被记录的请求

- **统计范围** —— 今天、昨天、近 3 天、近 7 天或近 30 天；单日范围包含按小时的柱状图
- **图表详情** —— 指向柱状条即显示该时段的输入、输出、缓存 Token 数、请求次数与预估费用
- **汇总卡片** —— 总 Token、输入 Token、输出 Token、缓存命中率与预估 API 费用
- **模型用量与模型明细** —— 显示哪些模型在消耗配额，并提供按模型的明细表

费用依据 Google 公开的 Gemini 价格页估算，每天同步一次并缓存，同时内置兜底价格表。缺少价格的模型会标记为未计价，而不是按 0 计算

## 快速仪表盘

| 总览 | 逐账号查看 |
| --- | --- |
| ![总览组件预览](docs/screenshots/4.7.7/menu-overview-preview-zh.png) | ![账号组件预览](docs/screenshots/4.7.7/menu-account-preview-zh.png) |

以上为 `6896ce61` 的 Chromium 组件布局预览，380 × 480，使用合成 IPC 与示例数据，不是 macOS 原生菜单截图。[来源说明](docs/screenshots/4.7.7/README.md)明确区分浏览器预览和 Linux 原生截图。

菜单栏／托盘面板支持总览及逐账号查看。选择账号只改变查看对象，点击**切换为此账号**才执行真实换号，可能关闭并重启 Antigravity，请先保存工作。「当前账号」来自 Tools 本地记录，本机 Token 总量不按账号归属。

macOS、Windows 可点击图标打开，Linux 从托盘菜单选择**快速仪表盘**；没有托盘时仍可使用主窗口。原生定位、焦点、Dock 和登录启动行为仍待平台实机验收，浏览器预览不能代替这些检查。详见[面板行为与平台边界](docs/menu-bar-dashboard.md)。

## 设置

![设置 — Linux 原生 WebKitGTK，浅色主题](docs/screenshots/4.7.7/linux-settings-light.png)

<details>
<summary>深色主题 — Linux 原生视口</summary>

![设置 — Linux 原生 WebKitGTK，深色主题](docs/screenshots/4.7.7/linux-settings-dark.png)

</details>

以上为使用合成数据的 Linux 原生视口；设置页下方内容需要滚动查看，不是全页截图。

- **外观与语言** —— 跟随系统，或选择浅色与深色；简体中文或英文
- **后台任务** —— 账号配额的自动刷新频率，以及从本地 Antigravity 数据重新读取当前账号的频率
- **本地数据** —— 应用数据位置（`~/.antigravity_tools/`），并提供打开目录的按钮
- **启动与菜单栏** —— 登录启动、登录时后台运行和隐藏 Dock 图标均默认关闭；隐藏 Dock 仅限 macOS

**App 设置导航汉化（实验性）**默认关闭，仅支持 macOS 上的官方 Antigravity App 2.19.1，覆盖设置入口及导航的 9 个固定标签。Tools Lite 自身的中英界面是独立设置；聊天、代码、账号名、项目名、路径和输入内容不在翻译范围内。九标签的临时翻译与还原已验证，最终 Tools 包的开关、重载、重连及关闭恢复仍待实机验收，详见[范围与验收](docs/app-localization.md)。

## 数据处理

| | |
| --- | --- |
| 读取 | Antigravity 本地的对话数据库与归档，其中包含 Token 数、模型名称与时间戳 |
| 写入 | `~/.antigravity_tools/` 用于保存账号、配置与价格缓存；切换账号时写入操作系统凭据存储及已初始化的原生 agy 会话 |
| 联网 | Google 授权、令牌刷新和配额查询使用必要凭据；价格同步也需要联网 |
| 服务边界 | Tools Lite 不提供凭据中转服务，不上传对话内容 |

## 从源码构建

Linux 构建与兼容性说明见 [Linux 支持](docs/linux.md)。

需要 Node.js 22 及以上版本、stable Rust 工具链，以及 Tauri 2 对应的平台构建工具

```bash
npm ci
npm run tauri dev       # 开发模式
npm run build           # 仅构建前端
npm run tauri build     # macOS .app 或 Windows 安装包
```

构建产物位于 `src-tauri/target/release/bundle/`。推送 `v*` tag 会触发发布工作流，构建 macOS、Windows 和 Linux deb 并挂载到 GitHub Release

## 低额度换号

设置中提供两个默认关闭的模式：**任务结束后换号**、**停止后换号**。两者都按真实配额选择允许使用的备用账号，仅在检测到 Antigravity APP、IDE 和 agy 均已退出后更新凭据。此协调器不会替你停止任务、关闭或重启客户端。重新打开后，请核对账号并从历史手动继续原对话；运行中的生成或命令不会自动迁移。详见[设置方式、边界和验证说明](docs/low-quota-switching.md)。

## 与上游项目的关系

本项目是 [lbjlaq/Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager) 的精简分支。上游提供完整工具箱，包含反向代理、HTTP API、Cloudflared 隧道、IP 管理与 Docker 镜像。本分支保留账号管理与本地用量仪表盘，移除代码库中的代理与 Web 模式部分，并加入自己的仪表盘、双语界面、主题支持与发布流程。两者为独立项目，若需要代理功能请使用上游

## 许可

基于 [lbjlaq/Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager) 定制，沿用 [CC BY-NC-SA 4.0](./LICENSE) 许可证。任何使用、修改或再分发行为均需遵守该许可证及原项目的署名要求

## 命令行与 Homebrew

Tools Lite 自带管理命令 `agy-lite`，支持列出账号、查看本地记录的当前账号和缓存配额，以及复用 GUI 安全流程显式切换账号。它与 Google 的 `agy` 命令不同；`current` 是本地记录，`quota` 不会刷新实时数据，详见 [CLI 使用说明](docs/cli.md)。

[v4.7.7](https://github.com/anglee0323/antigravity-tools-lite/releases/tag/v4.7.7) 已包含管理 CLI，旧版 v4.7.6 不包含。Apple Silicon Mac 可使用本仓库的 cask 安装 APP，并将包内管理命令链接为 `agy-lite`：

```sh
brew tap anglee0323/antigravity-tools-lite https://github.com/anglee0323/antigravity-tools-lite.git
brew install --cask anglee0323/antigravity-tools-lite/antigravity-tools-lite
agy-lite --version
agy-lite --help
```

配方固定了正式 ZIP 已核验的 SHA-256；实际 Mac 上的 Homebrew 安装、升级和卸载验收仍待完成，未签名 APP 也尚未通过系统信任验收。已有手动安装时请先保留 APP 备份，自行处理应用目录冲突，不要删除账号数据。此 cask 不会安装 Google 的 `agy`，详见 [Homebrew 验证范围与限制](docs/homebrew.md)。
