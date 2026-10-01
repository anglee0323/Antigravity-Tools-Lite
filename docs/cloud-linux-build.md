# Cloud Linux build environment

This recipe prepares the current **Debian 13 x86-64** cloud workspace for Antigravity Tools Lite. It does not require root, change host security/network settings, enable services, or execute Debian package maintainer scripts. It is a reproducible provisioning recipe, not a promise that the cloud filesystem or computer will remain available indefinitely.

## One-time setup

The host must provide Bash, Debian's archive keyring and APT, GCC/G++, make, pkg-config, curl, tar, sha256sum and dpkg-deb. This cloud image already supplies them.

```bash
./scripts/cloud-linux-setup.sh
source /workspace/shared/antigravity-build-env/env.sh
./scripts/cloud-linux-verify.sh --check
```

On the already-provisioned October 2026 workspace, the existing Rust install is reused rather than downloaded twice:

```bash
ANTIGRAVITY_TOOLCHAIN_ROOT=/workspace/shared/antigravity-validation/toolchain \
  ./scripts/cloud-linux-setup.sh
```

Run setup in a fresh shell before sourcing `env.sh`, with no other builds/tests running. Matching extracted package inventories are reused. `ANTIGRAVITY_BUILD_ENV` changes the build-environment directory. The setup also extracts the D-Bus/keyring test dependencies without enabling a service. The setup creates a workspace-local APT state/cache and downloads authenticated Debian packages from snapshot `20260828T000000Z`. Packages are only extracted into `sysroot/`; no system package is installed. The snapshot's archive-expiry check is disabled because it is an intentional historical snapshot, but Debian repository signatures and package hashes are still verified. The script never uses `--allow-unauthenticated`.

Default toolchain versions are Rust 1.99.0 and Node.js 24.19.0. Matching existing installations are reused. Missing Rust is obtained from the official Rust installer, and missing Node from nodejs.org with its published SHA-256 checksum. Rust/Cargo and npm dependencies continue to use the committed lockfiles. To upgrade deliberately, set `RUST_VERSION`, `NODE_VERSION` or `DEBIAN_SNAPSHOT` and rerun all checks.

No `.bashrc`, system PATH, credentials or account settings are changed. Source `env.sh` in each new build shell. It selects the local tools, header metadata and libraries only for that shell. Keep the environment directory outside the checkout; do not commit it or uploaded caches.

## Checks and packaging

```bash
./scripts/cloud-linux-verify.sh --check
./scripts/cloud-linux-verify.sh --package
```

The first command installs lockfile-pinned frontend dependencies, builds the frontend, runs a full backend `cargo check --locked`, and runs backend library tests. `--package` additionally builds the native x86-64 `.deb`. It does not publish, tag, push, install the package, or run the GUI. Logs and dependency inventories are under `$ANTIGRAVITY_BUILD_ENV` (default `/workspace/shared/antigravity-build-env`).

`CARGO_BUILD_JOBS` defaults to 3 to limit memory use. Set it lower if the executor is memory constrained. Check free disk space before release builds; Rust targets and the extracted WebKit/Clang dependency tree take several gigabytes.

## Compatibility and verification limits

The current cloud executor permits compilation but denies creation of the local Unix sockets needed by the isolated D-Bus helper and a virtual display. Those runtime checks have not passed here. Installing their dependencies does not establish that this executor can run desktop applications or keyring tests. Use a runner that permits these facilities for runtime validation; do not disable application sandboxes or connect tests to a real user bus.

- A package built natively here inherits **Debian 13 / glibc 2.41-era dependencies**. Successful compilation does not mean it will run on Ubuntu 22.04 or other older Linux systems. Inspect `dpkg-deb --info <package>` and test on the intended target.
- For a distributable Ubuntu 22.04 baseline, use the existing `scripts/build-linux-deb.sh --docker` builder or the repository's Ubuntu 22.04 release workflow. Docker availability is a separate requirement; this setup does not install or start Docker.
- macOS `.app`/`.dmg` and Windows installers require their own validated build environments. This Linux setup does not replace those runners.
- Tests that need a real desktop Secret Service are ignored by the default library test suite. `source /workspace/shared/antigravity-build-env/env.sh; ./scripts/test-linux-credentials.sh` runs the separate disposable D-Bus/keyring test helper. Its required binaries are provisioned by this recipe; a sandbox must also permit temporary local Unix sockets. Do not run its ignored tests against a real credential store.
- Visible rendering, actual account login/switching and installation on a real Linux desktop are distinct checks. A generated package alone does not verify them.

## Sources

- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Debian Snapshot](https://snapshot.debian.org/)
- [Rust installation](https://www.rust-lang.org/tools/install)
- [Node.js releases](https://nodejs.org/dist/)
