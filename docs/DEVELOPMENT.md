# Development and releases — Xvert

This guide is for maintainers building, checking and publishing Xvert for Windows. For everyday use,
return to the [README](../README.md).

## Build locally

Use Windows with Microsoft Edge WebView2 Runtime, Node.js/npm, Rust's MSVC toolchain and Microsoft
C++ Build Tools with the Windows SDK. Install the **Desktop development with C++** workload. The
repository's release workflow currently selects Node.js 20 and stable Rust. See the [Tauri Windows
prerequisites](https://v2.tauri.app/start/prerequisites/#windows) for setup details.

From a directory where you keep source repositories:

~~~powershell
git clone https://github.com/Skale-Club/xvert.git
cd xvert
npm ci
npm run dev
~~~

Private repositories require an authenticated GitHub account with access. The frontend is plain
HTML, CSS and JavaScript served by Tauri 2; opening the HTML directly in a browser does not provide
the native commands.

To check Rust code, run the included tests and build the executable:

~~~powershell
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --release --locked
npm run build
~~~

The build produces `src-tauri/target/release/xvert.exe`. It does not create an installer or a
PortableApps package. Copy the executable to a writable folder for manual testing. Its `Data` folder
belongs beside that executable, including when running a development build.

## Architecture

FFmpeg does the converting; Xvert never links it, it runs `ffmpeg.exe` and `ffprobe.exe` as
separate programs with no console window. `engine.rs` finds them (beside the exe, `Datafmpeg`,
then `PATH`), reads the version and the encoder list, and downloads the gyan.dev essentials build
when asked (SHA-256 checked, only the two programs extracted). `media.rs` runs ffprobe and sorts a
file into video, audio or image, and makes the preview pictures. `formats.rs` is the format table
and the FFmpeg arguments for each, as pure functions. `job.rs` runs one conversion into
`name.part.ext`, reads `-progress` output, kills FFmpeg on cancel and renames only finished files.

The window keeps the list and the queue (`app.js`): one video at a time, up to three audio files or
pictures, four jobs in all. Each run gets a fresh job number used by `job` progress events and
`cancel`. Files dragged onto the window arrive through Tauri's `tauri://drag-drop` event.

All the Skale X apps use the same palette: navy surfaces, primary blue `#5173D6` and soft blue
`#8FA9EE`. Keep English, Portuguese and Spanish UI strings consistent. Settings and exports use the
portable data directory; do not commit runtime data or private signing keys.

## Local MCP server

`Xvert.exe --mcp` makes `main()` call `mcp_tools::serve()` before Tauri starts, so no window opens.
`mcp.rs` is the MCP server over stdio (one JSON-RPC 2.0 message per line: `initialize`, `ping`,
`tools/list`, `tools/call`, plus the shared `app_info` tool). It is the same file in every Skale app:
change it in one and copy it to the others. `mcp_tools.rs` lists this app's tools and calls the same
modules the window uses. Keep stdout for protocol messages only (log with `eprintln!`), and return
`Err` from a tool instead of panicking: release builds abort on panic. Release builds use the GUI
subsystem and still talk over the pipes an MCP client opens.

To check by hand, write these lines to the exe's stdin; each request gets one JSON line back:

```text
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"app_info","arguments":{}}}
```

Any MCP client can drive it the same way, for example the MCP Inspector:
`npx @modelcontextprotocol/inspector "<path>\Xvert.exe" --mcp`.
`cargo test mcp` runs the protocol tests.

## Validate a change

Run the checks above when changing application code. Unit tests do not validate real Windows
devices, capture software or external APIs. For documentation-only changes, compare claims with the
implementation and check links and commands.

- `cargo test` converts generated clips into every format the local FFmpeg can write and reads
  each result back; it skips that test when no FFmpeg is found.
- Drop a mix of real videos (phone HEVC, screen recordings), songs with cover art, HEIC/PNG/WebP
  pictures and a non-media file; check previews, the skipped notice and the per-kind formats.
- Convert with each quality and a picture-size cap; cancel one file and the whole queue; check
  that no `.part` files remain and that names never overwrite (`name (2).ext`).
- Rename `ffmpeg.exe` away to test the download card and its progress, then check the three
  languages and both dialogs.

Keep documentation aligned with observed behavior. Update the README's English instructions and
Portuguese/Spanish summaries together. A feature listed in the README should have an implemented
workflow; a release link should not imply that a binary exists before publication succeeds.

## Publish a release

The **Release** GitHub Actions workflow runs when a `v*` tag is pushed. A normal branch push does
not build or publish an executable. Publication needs repository write access, GitHub Actions
enabled and an Actions secret named `TAURI_SIGNING_PRIVATE_KEY` available to this repository. An
organization secret must grant this repository access.

The secret must contain the private signing key matching the app's embedded public update key. Keep
the key outside Git and back it up securely. The current workflow supplies an empty signing-key
password; using a password-protected key requires updating the workflow's secret configuration
first.

Before tagging a release, confirm that the repository has a signing key available through a
repository or permitted organization secret. A normal source push does not publish a binary.

For a reviewed release:

1. Start from a clean checkout of `main`, fetch the remote and confirm `origin`    points to
   `https://github.com/Skale-Club/xvert.git`.
2. Choose an unused semantic version. Set the same version in the npm package,    Rust package and
   Tauri configuration. Refresh the npm lockfile with    `npm install --package-lock-only` and the
   Rust lockfile with    `cargo check --manifest-path src-tauri/Cargo.toml`. Review those changes.
3. Run the tests and build above, then perform the relevant manual checks.
4. Commit the version changes and lockfiles. Create the corresponding `vMAJOR.MINOR.PATCH`    tag on
   that commit, then push `main` and that exact tag to `origin`.
5. Watch the [Actions run](https://github.com/Skale-Club/xvert/actions).    The tag must match the
   Rust package version. The workflow builds the app,    signs it and publishes `Xvert.exe` plus
   `Xvert.exe.sig` in    [Releases](https://github.com/Skale-Club/xvert/releases).
6. Download and smoke-test the release. Confirm both assets are present and    readable by the
   intended users before announcing a download or update.    Replace the dated pre-release notice in
   the README after the first release.

The existing `scripts/release.ps1` helper changes the three version manifests, commits, tags and
pushes immediately. It does not refresh lockfiles, run tests or check that signing secrets exist.
Use the reviewed process above when preparing lockfiles or validating a first release.

The updater queries GitHub without authentication when the app starts and every six hours. When
the latest release is newer, it downloads the exe, verifies its signature and keeps it beside the
running exe as `<name>.new.exe`. The swap happens when the app exits, or at once from the updates panel's **Restart now**.
It retains `Data`. Release assets must be publicly readable for this updater to work; GitHub login in
a browser does not authenticate the app. `src-tauri/src/updater.rs` is the same file in every Skale
app, as is `src/updates.js` (the updates panel) in the apps with a window: change them in one and
copy them to the others.

The update signature is separate from Windows Authenticode signing; this workflow does not configure
an Authenticode certificate.

## Portable distribution

The app creates `Data` next to its executable. Optional PortableApps-style metadata can be supplied
under `App/AppInfo`; the app only refreshes the version when that metadata already exists. Neither
the build nor the release workflow creates a complete PortableApps package.

Close the app before moving or backing up its folder.

## Verify the Windows executable icon

After a normal `npm run build`, the postbuild step checks the icon resources
embedded in the resulting executable against `src-tauri/icons/icon.ico`. You can
repeat the data-only check with `npm run verify:icon`. This uses Node.js, does not
launch the app and fails if any icon frame is stale or missing. Cargo tracks icon
inputs through `build.rs`, so updating artwork rebuilds the Windows resource library.
