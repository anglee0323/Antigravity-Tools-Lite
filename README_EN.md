# Antigravity Tools Lite

A lightweight desktop tool for managing multiple Google accounts used with Antigravity and viewing local token usage.

This Lite edition focuses on three things: managing accounts, switching the active account in Antigravity, and reading local conversation records to build a token dashboard. The desktop app does not expose or auto-start the API proxy, admin panel, proxy scheduler, advertising entry points, or promotional links.

> This project is a personal-use customization based on [lbjlaq/Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager). It keeps the original license and attribution requirements and does not represent the upstream project's feature set or release schedule.

## Features

- **Local token dashboard**
  - Today, last 7 days, and last 30 days.
  - Hourly bars for today and daily bars for longer ranges.
  - Total, input, output, cache hit rate, and estimated API cost.
  - Hover a chart bar to inspect the usage for that period.
  - Per-model input, output, cached tokens, and request counts.
- **Multi-account management**
  - Add accounts through Google OAuth, Refresh Token, or local database import.
  - Inspect and refresh account quotas.
  - Use the bidirectional switch button to activate an account in Antigravity.
- **Official price synchronization**
  - Reads public prices from the [Google Gemini API pricing page](https://ai.google.dev/gemini-api/docs/pricing?hl=en) and the [Google Agent Platform pricing page](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing).
  - Caches price metadata locally for 24 hours and falls back to the previous cache or built-in prices when needed.
  - The dollar amount is an estimate based on public API rates, not an actual Google AI Pro bill.
- **Minimal UI**
  - Only Home, Accounts, and Settings remain in the main navigation.
  - The Lite desktop app does not start the local port 8045 proxy or initialize proxy logs, token-statistics, security-audit, or user-token databases.

## Data and privacy

- The dashboard scans `~/.gemini/antigravity/conversations` locally and read-only; conversation contents are not uploaded.
- Account data is stored locally under `~/.antigravity_tools/`. Switching accounts synchronizes the local credentials required by Antigravity.
- Pricing synchronization only requests the public Google pages listed above; account tokens and conversation data are not sent to the pricing endpoint.
- Never commit `~/.antigravity_tools/`, `~/.gemini/oauth_creds.json`, database files, or token files to GitHub.

## Usage

### Add an account

1. Open **Accounts**.
2. Click **Add account**.
3. Choose OAuth and complete Google sign-in, or use Refresh Token/local database import.

### Switch accounts

Click the bidirectional switch button on the target account. The app refreshes the token, writes the credentials required by Antigravity, and updates the current-account state. Depending on the installed Antigravity version, the switch may restart Antigravity.

### View usage

Open **Home** and select **Today**, **Last 7 days**, or **Last 30 days**. After creating new conversations, click **Refresh** to rescan the local records.

## Run from source

### Requirements

- macOS (the Lite desktop edition is currently validated primarily on macOS)
- Node.js 20+
- Rust stable
- System build tools required by Tauri 2

```bash
git clone https://github.com/anglee0323/Antigravity-Tools-Lite.git
cd Antigravity-Tools-Lite

# The current dependency tree has a peer-dependency conflict.
npm ci --legacy-peer-deps

# Development mode
npm run tauri dev

# Production bundle
npm run tauri build
```

Build only the frontend with:

```bash
npm run build
```

Bundles are written to `src-tauri/target/release/bundle/`. Automatic updater signing artifacts are disabled by default; configure your own signing key and release workflow if you intend to publish Tauri updater artifacts.

## Project layout

```text
src/                         React frontend
src/pages/Dashboard.tsx      Local token dashboard
src/pages/Accounts.tsx       Account management
src-tauri/src/modules/       Rust data, account, and pricing modules
src-tauri/src/modules/native_token_stats.rs
                             Read-only Antigravity conversation scanner
src-tauri/src/modules/api_pricing.rs
                             Official pricing fetch, parsing, and cache
```

## License

This repository keeps the [CC BY-NC-SA 4.0](./LICENSE) license in the repository. Follow the license and the upstream project's copyright and attribution requirements for commercial use, redistribution, and derivative works.
