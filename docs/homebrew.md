# Homebrew distribution

## Status

This repository contains the **macOS Apple Silicon cask** at `Casks/antigravity-tools-lite.rb`, backed by the public [v4.7.8 release](https://github.com/anglee0323/antigravity-tools-lite/releases/tag/v4.7.8). It uses this repository as an explicit-URL tap; no separate tap repository is required. v4.7.6 predates the management CLI.

The public ZIP, checksums, generated cask and source manifest were downloaded and compared with GitHub's asset digests. The ZIP's executable is ARM64 and reports bundle version 4.7.8; its path matches the `binary` stanza. The root cask is byte-for-byte identical to the release attachment, with ZIP SHA-256 `8f1d54072d6784fffe4ea82425bd087f0fd2f7c267659be73e1b02505e82f50d`. The Homebrew recipe check loads the DSL and fetches/verifies the archive without installing or launching the app.

**Native installation acceptance is pending.** Installation, upgrade, uninstall/account preservation, custom `--appdir` behavior and Gatekeeper acceptance have not yet been tested on a user's Mac. Recipe and package validation do not establish these results. The installation commands below are provided with that limitation; no security checks are disabled.

The cask installs both `Antigravity Tools Lite.app` and the management command `agy-lite`. It uses Homebrew's documented [`app` and `binary` artifacts](https://docs.brew.sh/Cask-Cookbook#stanza-binary). A separate formula would still carry the current desktop-linked executable, so no lightweight CLI-only formula is claimed here. Linux and Intel macOS Homebrew packages are not provided; use the existing Linux packages or build from source.

## Release inputs and generation

The macOS release job explicitly builds `aarch64-apple-darwin`, verifies the Mach-O architecture, and produces:

- `Antigravity-Tools-Lite-VERSION-macos-arm64.zip`
- `antigravity-tools-lite.rb`, generated from the exact ZIP with a real SHA-256 checksum

The ZIP and cask are uploaded together by the existing release workflow. Editing this workflow does not itself trigger a release or create a tap. The workflow refuses a tag/version mismatch. Never replace a published ZIP or its checksum; publish a new version and update the cask through a PR.

For manual generation, set these to a real archive and its intended immutable release URL; no sample release URL is assumed to exist:

```sh
node scripts/generate-homebrew.mjs \
  --archive "$RELEASE_ZIP" \
  --url "$RELEASE_ARCHIVE_URL" \
  --version "$RELEASE_VERSION" \
  --output artifacts/homebrew/Casks/antigravity-tools-lite.rb
```

The generator validates the filename/version pair, HTTPS URL and bundled executable path. It computes SHA-256 from the file; it does not use `:no_check`, upload anything, fetch the URL, or claim the release is live. The release job separately verifies that the bundled executable is ARM64. The recipe requires Apple Silicon and macOS 11 or later; running the built app on the oldest supported macOS still needs a release smoke test.

## Test a generated cask locally on a Mac

After the exact ZIP is publicly available at the cask URL:

```sh
# A local-only developer tap. This command does not create a GitHub repository.
brew tap-new local/antigravity-tools-lite
mkdir -p "$(brew --repository local/antigravity-tools-lite)/Casks"
cp artifacts/homebrew/Casks/antigravity-tools-lite.rb \
  "$(brew --repository local/antigravity-tools-lite)/Casks/antigravity-tools-lite.rb"
brew style --cask local/antigravity-tools-lite/antigravity-tools-lite
brew audit --cask local/antigravity-tools-lite/antigravity-tools-lite
brew install --cask local/antigravity-tools-lite/antigravity-tools-lite
agy-lite --version
agy-lite accounts list --json
brew uninstall --cask local/antigravity-tools-lite/antigravity-tools-lite
```

Review any Homebrew trust prompt yourself. `brew uninstall` retains saved accounts and OS credentials. No `zap` stanza deletes them. Test that upgrades preserve account files and that `agy-lite` follows a custom `--appdir`, then publish the verified cask under `Casks/` in an authorized tap. Only after publication should end-user installation instructions name that tap. See Homebrew's [tap maintenance guide](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap).

## Signing and Gatekeeper

The v4.7.8 release uses complete ad-hoc bundle signing. The downloaded public ZIP passes strict signature verification with empty entitlements. The release workflow does not configure Developer ID signing/notarization and does not disable quarantine/Gatekeeper. Homebrew installation does not remove that limitation. A distributable release needs appropriate signing/notarization or clearly documented user review of the ad-hoc signed app; do not add quarantine-removal commands to the cask. Confirm Apple trust behavior on a clean Mac before promoting installation instructions.

## Publish the cask in this repository

A separate `homebrew-*` repository is optional. Homebrew's [two-argument tap form](https://docs.brew.sh/Taps) supports this existing Git repository. The root `Casks/antigravity-tools-lite.rb` is the exact generated v4.7.8 release attachment, with its immutable archive URL and real SHA-256. A release attachment alone is not a tap entry.

Install from the repository with:

```sh
brew tap anglee0323/antigravity-tools-lite https://github.com/anglee0323/antigravity-tools-lite.git
brew install --cask anglee0323/antigravity-tools-lite/antigravity-tools-lite
agy-lite --version
agy-lite --help
```

The explicit Git URL matters: the one-argument `brew tap` form would look for a different, `homebrew-`-prefixed repository. The cask's `app` artifact installs the app, and its `binary` artifact links the bundled executable as `$(brew --prefix)/bin/agy-lite`, following a custom `--appdir`. It neither installs nor replaces Google's `agy`.

Installation does not launch the app. If a manually installed app already occupies the destination, keep a backup and review Homebrew's conflict message before proceeding. These commands do not request forced overwrite, app adoption, account-data deletion or removal of platform trust checks.

For later versions, publish the new ZIP first, generate and test the matching cask, then update the same root-level cask through a PR. Users can then run:

```sh
brew update
brew upgrade --cask anglee0323/antigravity-tools-lite/antigravity-tools-lite
```

Use the [release checklist](release-checklist.md) to keep the source commit, version, assets and installation evidence aligned.
