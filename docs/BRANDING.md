# Xvert branding

Xvert is the media converter in the Skale Club family. Its approved product mark is **A — Dobra
limpa**: a compact folded file with a rounded silhouette, two blue planes and an open diagonal cut.
The fold suggests a file changing form. Preserve that silhouette rather than adding play buttons,
recycling arrows, an X monogram or a surrounding tile.

The master is `icon-source.png` (1254 × 1254 RGBA), with a transparent background and transparent
diagonal opening. It contains the symbol alone, without the Xvert wordmark or presentation labels.
Use the Skale Club blues (`#5173D6` and `#8FA9EE`); the Skale Club organization mark in
`src/skaleclub.png` is a separate identity.

Run `./make-icon.ps1` to regenerate all Tauri platform icons, `src/logo.png`
and the PortableApps menu assets in `branding/portable/`. The portable assets map directly to
`App/AppInfo/appicon.ico` and `App/AppInfo/appicon_{16,32,75,128}.png` in the installed package.
They supplement the existing package metadata; they are not a complete PortableApps package.

The build script tracks the ICO/PNG inputs. `npm run build` verifies the icon frames embedded in
the Windows executable. After installing a build, compare its SHA-256 with the validated executable
and run `node scripts/verify-windows-icon.cjs <installed-exe>`.

## Artwork provenance

The user selected variation A on October 29, 2026. The built-in `image_gen` tool extracted the
approved symbol from its concept board, preserving the geometry and removing the presentation.
Tauri's icon CLI performs deterministic resizing and icon format conversion from that master.

Final extraction prompt:

> Precise asset extraction and background removal of the supplied approved Xvert logo board.
> Extract ONLY the large blue folded-file symbol in the upper middle of this board. Preserve that
> exact A / DOBRA LIMPA silhouette, the exact shape/proportions, rounded corners, fold geometry,
> pointed diagonal negative-space opening, and the two blue planes. Do not redesign, stylize, add
> details, alter the fold, or invent a different logo. Remove the entire navy background, every
> word including Xvert and the title, and the small white duplicate at the bottom. The diagonal
> slit and every space outside the symbol must be fully transparent alpha, not dark navy or black
> fills. Result is ONE standalone blue symbol, large, centered on a perfectly square transparent
> canvas with about 10% clear padding at all four sides, suitable as the sole master for Windows
> application icon generation. Keep the palette cobalt #5173D6 and soft blue #8FA9EE, clean crisp
> edges, solid broad planes, no shadows, glow, border, square icon tile, backdrop or text.
> Transparent background required.
