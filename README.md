# Xvert

Portable video, audio and image converter for Windows. Drop in videos, music and pictures, choose
a format for each kind, and convert them all in one go. One small exe: no installer, no
administrator rights. 🇧🇷 [Português](#português) · 🇪🇸 [Español](#español)

Made by **[Skale Club](https://skale.club)**.

## Availability

**Status checked October 27, 2026:** source version 0.1.0. No GitHub Release or
publicly downloadable executable has been published. Build from source using the
[development guide](docs/DEVELOPMENT.md). Future release binaries belong in
[Releases](https://github.com/Skale-Club/xvert/releases).

Once running, the app updates itself: it checks GitHub Releases when it opens and every 6 hours,
downloads a newer signed version in the background and installs it when you close the app. The
version button at the foot of the sidebar opens the updates panel, with **Check now** and
**Restart now**. Your `Data` folder is kept.

## Run it

Double-click `Xvert.exe`. It requires Microsoft Edge WebView2 Runtime and
[FFmpeg](https://ffmpeg.org), the free, open-source engine that does the converting. Xvert uses the
first FFmpeg it finds:

1. `ffmpeg.exe` and `ffprobe.exe` next to `Xvert.exe`;
2. `Data\ffmpeg\`, where Xvert's own download goes;
3. an FFmpeg installed on the PC (on `PATH`, for example through `winget install ffmpeg`).

When none is found, Xvert offers to download the gyan.dev "release essentials" build (the Windows
build linked from ffmpeg.org, about 100 MB), checks it against the published SHA-256 checksum and
keeps only `ffmpeg.exe` and `ffprobe.exe` in `Data\ffmpeg\`. Settings live in `Data\xvert.json`.

Language: the selector at the bottom left (English, Português, Español).

## How it works

- **Add files**: drag them onto the window, or use **Add files** / **Add folder** (folders are
  searched for media files, up to 2,000). Each file shows a preview, its size, length, resolution
  and codecs.
- **Choose formats** per kind, in the Output panel:

| Files | Can become |
|---|---|
| Videos | MP4 (H.264), MP4 HEVC (H.265), WebM (VP9), MKV, MOV, AVI, animated GIF, or just the sound as MP3, M4A, WAV, FLAC, OGG or Opus |
| Music and audio | MP3, M4A (AAC), WAV, FLAC, OGG (Vorbis), Opus |
| Pictures | JPG, PNG, WebP, AVIF, BMP, TIFF, ICO |

- **Quality**: High, Balanced or Small. Lossless formats (WAV, FLAC, PNG, BMP, TIFF) ignore it.
- **Picture size**: keep the original or cap the height (2160p down to 480p); never upscales.
  GIFs are capped at 480p unless you pick a size.
- **Remove the sound from videos**, and **Save to** a folder of your choice or next to each original.
- **Convert**: one video at a time (video encoders already use every core) and up to three audio
  files or pictures at once. Each row shows progress, time left and speed, then the new size. Cancel
  a file or everything; retry a failed one; the arrow button shows the result in Explorer.

The **Engine** page shows which FFmpeg is in use and which formats it can write.

## What it never does

- It never changes or deletes your originals. New files get the original name with the new
  extension; when that name is taken, `name (2).ext` and so on.
- A conversion writes to `name.part.ext` first and is only renamed when it finishes, so a cancelled
  or failed conversion leaves nothing behind.
- Transparent pictures converted to JPG or BMP (which have no transparency) are put on white, not
  black.
- Nothing is uploaded: all converting happens on this PC.

## Use with Claude Code and Codex

`Xvert.exe --mcp` runs Xvert as a local [MCP](https://modelcontextprotocol.io) server, with no
window, so AI assistants such as Claude Code and Codex can use its engine on this PC. Xvert itself
sends nothing over the network; what the assistant reads goes to its AI provider, as with anything
else you share with it. `convert` writes a new file beside the original (or in `out_dir`) and never
overwrites anything; the other tools only read. FFmpeg is found the same way as in the window.

Claude Code (available in every project):

```bash
claude mcp add --scope user xvert -- "C:\Apps\Xvert\Xvert.exe" --mcp
```

Codex, in `%USERPROFILE%\.codex\config.toml`:

```toml
[mcp_servers.xvert]
command = 'C:\Apps\Xvert\Xvert.exe'
args = ["--mcp"]
```

Use the path where your `Xvert.exe` is. Tools:

- `app_info`: version, where the exe and `Data` folder are, and the saved settings.
- `engine_status`: whether FFmpeg was found, its version, and the formats it can write.
- `probe`: `path`, `limit`: kind, duration, size, resolution, codecs and more for a file or the
  media in a folder.
- `convert`: `path`, `format`, `quality`, `max_height`, `mute`, `out_dir`: converts one file and
  returns the new path and size.

## Development

Tauri 2, Rust and plain HTML/CSS/JavaScript. See the [development and release
guide](docs/DEVELOPMENT.md) for prerequisites, build, tests and signed releases.

---

## Português

O Xvert converte vídeos, músicas e imagens. É um exe pequeno, sem instalação e sem precisar de
administrador. Ainda não há release publicada (27/10/2026); veja as
[instruções de compilação](docs/DEVELOPMENT.md).

- Precisa do FFmpeg: ele usa o que estiver ao lado do exe, na pasta `Data\ffmpeg` ou instalado no
  PC, e se não achar nenhum oferece baixar (cerca de 100 MB, com verificação do checksum).
- Arraste arquivos para a janela ou use **Adicionar arquivos** / **Adicionar pasta**.
- Escolha o formato de cada tipo: vídeos (MP4, HEVC, WebM, MKV, MOV, AVI, GIF ou só o áudio),
  músicas (MP3, M4A, WAV, FLAC, OGG, Opus) e imagens (JPG, PNG, WebP, AVIF, BMP, TIFF, ICO).
- Qualidade, tamanho máximo da imagem, tirar o som dos vídeos e a pasta de saída ficam no painel
  **Saída**.
- Os originais nunca são alterados. Se a conversão for cancelada ou falhar, nada fica para trás.
- **Claude Code e Codex**: `Xvert.exe --mcp` roda o Xvert como servidor MCP local, sem janela, para
  assistentes de IA usarem a leitura e a conversão de arquivos (converter só cria arquivos novos).
  Veja [Use with Claude Code and Codex](#use-with-claude-code-and-codex).

## Español

Xvert convierte vídeos, música e imágenes. Es un exe pequeño, sin instalación y sin necesidad de
administrador. Aún no hay release publicada (27/10/2026); consulta las
[instrucciones de compilación](docs/DEVELOPMENT.md).

- Necesita FFmpeg: usa el que esté junto al exe, en la carpeta `Data\ffmpeg` o instalado en el PC,
  y si no encuentra ninguno ofrece descargarlo (unos 100 MB, con verificación del checksum).
- Arrastra archivos a la ventana o usa **Añadir archivos** / **Añadir carpeta**.
- Elige el formato de cada tipo: vídeos (MP4, HEVC, WebM, MKV, MOV, AVI, GIF o solo el audio),
  música (MP3, M4A, WAV, FLAC, OGG, Opus) e imágenes (JPG, PNG, WebP, AVIF, BMP, TIFF, ICO).
- La calidad, el tamaño máximo, quitar el sonido de los vídeos y la carpeta de salida están en el
  panel **Salida**.
- Los originales nunca se modifican. Si una conversión se cancela o falla, no queda nada a medias.
- **Claude Code y Codex**: `Xvert.exe --mcp` ejecuta Xvert como servidor MCP local, sin ventana,
  para que asistentes de IA usen la lectura y la conversión de archivos (convertir solo crea
  archivos nuevos). Consulta [Use with Claude Code and Codex](#use-with-claude-code-and-codex).

## Skale Club apps

These Windows apps belong to the [Skale-Club organization](https://github.com/Skale-Club).
They share navy interfaces, blue accents, transparent product symbols, and English,
Portuguese and Spanish UI text. Each app has its own executable and portable Data folder.

| App | Purpose |
| --- | --- |
| [Xpace](https://github.com/Skale-Club/xpace) | Care for the PC (disk space, cleaning, drivers, startup, apps) and inspect hardware, live sensors and benchmarks |
| [Xink](https://github.com/Skale-Club/xink) | Draw over the screen during presentations or recordings |
| [Xnote](https://github.com/Skale-Club/xnote) | Transcribe meetings and turn notes into summaries and tasks |
| [Xvert](https://github.com/Skale-Club/xvert) | Convert videos, music and pictures between formats |

Repository access may be required depending on project visibility. Report problems through the
relevant repository, including app version, Windows version and reproduction steps.

---

© 2026 [Skale Club](https://skale.club). FFmpeg is a trademark of Fabrice Bellard and is not part of
this repository; it is used as a separate program under its own license.
