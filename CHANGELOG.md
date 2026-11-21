# Changelog

## 0.3.0 — 2026-11-20

- Move to the Skale Club family design (skale.css v2) with Xvert's render-orange signal: brand
  glows, the drop zone, the active row, the output panel and selected formats follow the signal;
  text on signal fills uses dark ink. Option labels are silkscreen labels and changing numbers
  (progress, sizes, estimates, counts, version) use mono readouts.
- Replace the folded-file logo with the family mark (orange tile, solid and outline triangles) in
  the interface, the Windows executable and the PortableApps menu icons. `make-icon.ps1` now draws
  it without npm.

## 0.2.0 — 2026-11-04

- Internal signed downloads and updates through a stable per-app manifest endpoint.
- Missing feeds report an error; staged packages are verified again before replacement.
- Release automation publishes the executable, signature and latest.json together.

- Add Clear completed to remove successful queue entries while preserving saved files and active,
  pending, failed or cancelled jobs.
- Separate video output formats and audio extraction into independently collapsible sections.
- Make output formats, quality/picture settings and destination collapsible, with selected-value
  summaries and a control to show/hide all options. Keep conversion actions visible.
- Add optional permanent deletion of originals after verified conversion success, with per-batch
  opt-in, preservation on failure/cancellation and notices when originals cannot be removed.
- Replace the Xvert product logo with the approved folded-file mark (A — Dobra limpa), including
  the interface, Windows executable and PortableApps menu icons.
- `Xvert.exe --mcp` runs a local MCP server (no window) for Claude Code, Codex and other MCP
  clients: FFmpeg status, reading media files and converting one file (never overwrites).

## 0.1.0

- First version: converts videos, music and pictures with FFmpeg. Drag and drop or pick files and
  folders, one format per kind, quality and size options, a queue with progress, cancel and retry.
- Finds FFmpeg beside the exe, in Data or on the PC, or downloads it with a checksum check.
- English, Portuguese and Spanish.
