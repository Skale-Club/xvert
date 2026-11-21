# Xvert branding

Xvert is the media converter in the Skale Club Windows app family (skale.css v2). Its signal is
render orange `#ff8f45` and its mark is a frame becoming its outline: a solid triangle followed by
the same triangle as an outline, in ink `#04070d` on a rounded orange tile.

The source of truth is `skaleclub-apps/design/skale-css/marks/xvert.svg`; the family rules (tile,
glyph scale, signals, tray icons) are in that folder's `README.md`. Never redraw the mark by hand
in this repository.

Run `./make-icon.ps1` to regenerate the Tauri icons, `src/logo.png` and the PortableApps menu
assets in `branding/portable/`. It draws the mark with System.Drawing (no npm needed): the glyph
fills 64% of the tile on desktop sizes and 74% at 24 px and below. The portable assets map to
`App/AppInfo/appicon.ico` and `App/AppInfo/appicon_{16,32,75,128}.png` in the installed package.
`src-tauri/icons/icon.icns`, `android/` and `ios/` are not used by the Windows build and still
hold the previous mark.

The build script tracks the ICO/PNG inputs. `npm run build` verifies the icon frames embedded in
the Windows executable. After installing a build, compare its SHA-256 with the validated executable
and run `node scripts/verify-windows-icon.cjs <installed-exe>`.

## History

- 2026-11-20: the family mark replaced the earlier approved folded-file mark ("A — Dobra limpa",
  selected 2026-10-29), at the owner's request, as part of the skale.css v2 rollout.
