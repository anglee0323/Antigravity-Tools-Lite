# Antigravity Tools Lite

一个面向个人使用的轻量版 Antigravity 账号管理与本地用量仪表盘。

这个版本保留最核心的三件事：管理多个 Google 账号、在 Antigravity 中切换账号、读取本机对话记录统计 Token 用量。桌面版不暴露也不自动启动 API 反代、管理后台、代理调度器、广告入口或推广链接。

> 本项目基于 [lbjlaq/Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager) 定制，保留原项目的许可证与致谢信息。它是个人使用取向的 Lite 分支，不代表上游项目的功能或发布节奏。

## 功能

- **本地 Token 仪表盘**
  - 今天、近 7 天、近 30 天三个统计范围。
  - 今天按小时显示，7 天和 30 天按天显示。
  - 总 Token、输入 Token、输出 Token、缓存命中率、API 费用等价估算。
  - 鼠标悬浮图表柱子查看对应时间段用量。
  - 按模型查看输入、输出、缓存 Token 和请求次数。
- **多账号管理**
  - Google OAuth 授权、Refresh Token 添加和本地数据库导入。
  - 查看账号额度并刷新。
  - 使用双向箭头将指定账号切换到 Antigravity。
- **价格同步**
  - 从 [Google Gemini API 官方价格页](https://ai.google.dev/gemini-api/docs/pricing?hl=en) 和 [Google Agent Platform 官方价格页](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)读取公开价格。
  - 价格元数据本地缓存 24 小时，网络或页面解析失败时使用上次缓存和内置兜底价格。
  - 仪表盘显示的是按公开 API 标准价折算的美元等价金额，不是 Google AI Pro 的实际账单。
- **极简界面**
  - 只保留：首页、账号管理、设置。
  - Lite 桌面版不启动本地 8045 反代端口，也不自动初始化代理日志、Token 统计、安全审计和用户 Token 数据库。

## 数据与隐私

- 仪表盘只读扫描本机的 `~/.gemini/antigravity/conversations`，不会上传对话内容。
- 账号数据保存在本机 `~/.antigravity_tools/`；切换账号时会同步 Antigravity 所需的本地凭据。
- 价格同步只请求上面列出的 Google 官方公开网页，不会把账号 Token 或对话发送到价格接口。
- 不要把 `~/.antigravity_tools/`、`~/.gemini/oauth_creds.json`、数据库文件或任何 Token 文件提交到 GitHub。

## 使用方式

### 添加账号

1. 打开“账号管理”。
2. 点击“添加账号”。
3. 选择 OAuth 授权，完成 Google 登录；也可以使用 Refresh Token 或本地数据库导入。

### 切换账号

在目标账号卡片上点击双向箭头。应用会刷新 Token、写入 Antigravity 所需凭据并更新当前账号状态。根据本机 Antigravity 版本，切换过程可能会重启 Antigravity。

### 查看用量

打开首页，选择“今天”“近 7 天”或“近 30 天”。首次使用或生成新的对话后，点击“刷新”即可重新扫描本地记录。

## 从源码运行

### 环境要求

- macOS（当前 Lite 桌面版主要在 macOS 上验证）
- Node.js 20+
- Rust stable
- Tauri 2 所需的系统构建工具

```bash
git clone https://github.com/anglee0323/Antigravity-Tools-Lite.git
cd Antigravity-Tools-Lite

# 当前依赖树存在 peer dependency 冲突，安装时使用兼容模式
npm ci --legacy-peer-deps

# 开发模式
npm run tauri dev

# 生产构建
npm run tauri build
```

前端单独构建：

```bash
npm run build
```

构建产物位于 `src-tauri/target/release/bundle/`。本仓库默认关闭自动更新签名产物；如果你要发布 Tauri updater，需要自行配置签名私钥和发行流程。

## 项目结构

```text
src/                         React 前端
src/pages/Dashboard.tsx     本地 Token 仪表盘
src/pages/Accounts.tsx      账号管理
src-tauri/src/modules/      Rust 本地数据、账号和价格同步模块
src-tauri/src/modules/native_token_stats.rs
                             对 Antigravity 对话数据库的只读扫描
src-tauri/src/modules/api_pricing.rs
                             Google 官方价格抓取、解析和缓存
```

## 许可证

本项目沿用仓库中的 [CC BY-NC-SA 4.0](./LICENSE) 许可证。商业使用、再分发和二次修改请遵守许可证及上游项目的版权与署名要求。
