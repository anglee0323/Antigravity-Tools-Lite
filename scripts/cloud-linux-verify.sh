#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="${ANTIGRAVITY_BUILD_ENV:-/workspace/shared/antigravity-build-env}"
[[ -r "$root/env.sh" ]] || { echo "Run scripts/cloud-linux-setup.sh first." >&2; exit 1; }
source "$root/env.sh"
[[ "$(rustc --version | awk '{print $2}')" == "${ANTIGRAVITY_RUST_VERSION:-1.99.0}" ]] || { echo "Rust version drifted; rerun setup." >&2; exit 1; }
[[ "$(node --version)" == "v${ANTIGRAVITY_NODE_VERSION:-24.19.0}" ]] || { echo "Node version drifted; rerun setup." >&2; exit 1; }
case "${1:---check}" in
  --check|--package) ;;
  *) echo 'Usage: scripts/cloud-linux-verify.sh [--check|--package]' >&2; exit 2 ;;
esac
mkdir -p "$root/logs"
# Verify versions and compiler/library discovery before long builds.
rustc --version; cargo --version; node --version; npm --version
pkg-config --modversion gtk+-3.0 webkit2gtk-4.1 ayatana-appindicator3-0.1
npm ci 2>&1 | tee "$root/logs/npm-ci.log"
npm run build 2>&1 | tee "$root/logs/frontend-build.log"
cargo check --locked --manifest-path src-tauri/Cargo.toml 2>&1 | tee "$root/logs/cargo-check.log"
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib 2>&1 | tee "$root/logs/cargo-test.log"
if [[ "${1:---check}" == --package ]]; then
  npm run tauri build -- --bundles deb -- --locked 2>&1 | tee "$root/logs/deb-build.log"
  find src-tauri/target/release/bundle/deb -maxdepth 1 -name '*.deb' -exec sha256sum {} \;
fi
