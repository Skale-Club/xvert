//! The formats Xvert writes and the FFmpeg arguments for each. Everything
//! here is plain data and string building, so it is tested without FFmpeg.

use crate::media::Media;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Format {
    pub id: &'static str,
    /// What it produces: "video", "audio" or "image".
    pub kind: &'static str,
    pub ext: &'static str,
    pub label: &'static str,
    /// Codecs, as shown under the label.
    pub detail: &'static str,
    /// Lossless formats ignore the quality setting.
    pub lossless: bool,
}

const fn f(id: &'static str, kind: &'static str, ext: &'static str, label: &'static str, detail: &'static str, lossless: bool) -> Format {
    Format { id, kind, ext, label, detail, lossless }
}

pub const FORMATS: &[Format] = &[
    f("mp4", "video", "mp4", "MP4", "H.264 · AAC", false),
    f("mp4-hevc", "video", "mp4", "MP4 HEVC", "H.265 · AAC", false),
    f("webm", "video", "webm", "WebM", "VP9 · Opus", false),
    f("mkv", "video", "mkv", "MKV", "H.264 · AAC", false),
    f("mov", "video", "mov", "MOV", "H.264 · AAC", false),
    f("avi", "video", "avi", "AVI", "MPEG-4 · MP3", false),
    f("gif", "video", "gif", "GIF", "Animated", false),
    f("mp3", "audio", "mp3", "MP3", "LAME VBR", false),
    f("m4a", "audio", "m4a", "M4A", "AAC", false),
    f("wav", "audio", "wav", "WAV", "PCM 16-bit", true),
    f("flac", "audio", "flac", "FLAC", "Lossless", true),
    f("ogg", "audio", "ogg", "OGG", "Vorbis", false),
    f("opus", "audio", "opus", "Opus", "Opus", false),
    f("jpg", "image", "jpg", "JPG", "JPEG", false),
    f("png", "image", "png", "PNG", "Lossless", true),
    f("webp", "image", "webp", "WebP", "Lossy", false),
    f("avif", "image", "avif", "AVIF", "AV1", false),
    f("bmp", "image", "bmp", "BMP", "Bitmap", true),
    f("tiff", "image", "tiff", "TIFF", "Lossless", true),
    f("ico", "image", "ico", "ICO", "Icon, 256 px", true),
];

pub fn get(id: &str) -> Option<&'static Format> {
    FORMATS.iter().find(|f| f.id == id)
}

/// Encoders each format needs. AVIF takes either AV1 encoder.
fn needs(id: &str) -> &'static [&'static [&'static str]] {
    match id {
        "mp4" | "mkv" | "mov" => &[&["libx264"], &["aac"]],
        "mp4-hevc" => &[&["libx265"], &["aac"]],
        "webm" => &[&["libvpx-vp9"], &["libopus"]],
        "avi" => &[&["mpeg4"], &["libmp3lame"]],
        "gif" => &[&["gif"]],
        "mp3" => &[&["libmp3lame"]],
        "m4a" => &[&["aac"]],
        "wav" => &[&["pcm_s16le"]],
        "flac" => &[&["flac"]],
        "ogg" => &[&["libvorbis"]],
        "opus" => &[&["libopus"]],
        "jpg" => &[&["mjpeg"]],
        "png" => &[&["png"]],
        "webp" => &[&["libwebp"]],
        "avif" => &[&["libaom-av1", "libsvtav1"]],
        "bmp" => &[&["bmp"]],
        "tiff" => &[&["tiff"]],
        "ico" => &[&["bmp"]],
        _ => &[&["?"]],
    }
}

/// Format ids this FFmpeg build can write.
pub fn available(encoders: &HashSet<String>) -> Vec<&'static str> {
    FORMATS
        .iter()
        .filter(|f| needs(f.id).iter().all(|any| any.iter().any(|e| encoders.contains(*e))))
        .map(|f| f.id)
        .collect()
}

/// Whether a file of `kind` can become `format`: video becomes video, audio or
/// a GIF; audio only audio; pictures only pictures.
pub fn accepts(format: &Format, kind: &str) -> bool {
    match kind {
        "video" => format.kind != "image",
        "audio" => format.kind == "audio",
        "image" => format.kind == "image",
        _ => false,
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Options {
    /// "high", "balanced" or "small".
    pub quality: String,
    /// Largest picture height, never upscaled; 0 keeps the original.
    pub max_height: u32,
    /// Leave the sound out of videos.
    pub mute: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self { quality: "balanced".into(), max_height: 0, mute: false }
    }
}

impl Options {
    /// Picks one of three values by quality.
    fn pick<T: Copy>(&self, high: T, balanced: T, small: T) -> T {
        match self.quality.as_str() {
            "high" => high,
            "small" => small,
            _ => balanced,
        }
    }
}

/// Keeps the height at most `max` (when set) and both sides even, as the
/// 4:2:0 video encoders require.
fn even_scale(max: u32) -> String {
    if max == 0 {
        "scale='trunc(iw/2)*2':'trunc(ih/2)*2'".into()
    } else {
        format!("scale=-2:'trunc(min(ih,{max})/2)*2'")
    }
}

fn picture_scale(max: u32) -> Option<String> {
    (max > 0).then(|| format!("scale=-1:'min(ih,{max})'"))
}

fn push(args: &mut Vec<String>, items: &[&str]) {
    args.extend(items.iter().map(|s| s.to_string()));
}

/// The FFmpeg arguments to turn `media` into `format` at `output`. Progress
/// goes to stdout as key=value lines.
pub fn args(media: &Media, format: &Format, options: &Options, output: &Path, encoders: &HashSet<String>) -> Result<Vec<String>, String> {
    if !accepts(format, media.kind) {
        return Err("cannotConvert".into());
    }
    if format.kind == "audio" && !media.has_audio {
        return Err("noAudio".into());
    }
    let mut a: Vec<String> = Vec::new();
    push(&mut a, &["-hide_banner", "-nostdin", "-y", "-v", "error"]);
    a.push("-i".into());
    a.push(media.path.clone());
    let o = options;
    let sound = media.has_audio && !o.mute;

    match format.kind {
        "video" if format.id == "gif" => {
            let height = if o.max_height > 0 { o.max_height } else { 480 };
            let fps = o.pick(20, 15, 10);
            push(&mut a, &["-map", "0:V:0", "-an", "-vf"]);
            a.push(format!(
                "fps={fps},scale=-1:'min(ih,{height})':flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5"
            ));
            push(&mut a, &["-loop", "0"]);
        }
        "video" => {
            push(&mut a, &["-map", "0:V:0"]);
            if sound {
                push(&mut a, &["-map", "0:a:0"]);
            } else {
                a.push("-an".into());
            }
            a.push("-vf".into());
            a.push(even_scale(o.max_height));
            let audio_rate = o.pick("192k", "160k", "128k");
            match format.id {
                "mp4-hevc" => {
                    let crf = o.pick("20", "26", "30");
                    push(&mut a, &["-c:v", "libx265", "-preset", "medium", "-crf", crf, "-pix_fmt", "yuv420p", "-tag:v", "hvc1"]);
                }
                "webm" => {
                    let crf = o.pick("28", "33", "38");
                    push(&mut a, &["-c:v", "libvpx-vp9", "-crf", crf, "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-pix_fmt", "yuv420p"]);
                }
                "avi" => {
                    let q = o.pick("2", "4", "7");
                    push(&mut a, &["-c:v", "mpeg4", "-vtag", "xvid", "-q:v", q]);
                }
                _ => {
                    let crf = o.pick("18", "23", "28");
                    push(&mut a, &["-c:v", "libx264", "-preset", "medium", "-crf", crf, "-pix_fmt", "yuv420p"]);
                }
            }
            if sound {
                match format.id {
                    "webm" => push(&mut a, &["-c:a", "libopus", "-b:a", o.pick("160k", "128k", "96k")]),
                    "avi" => push(&mut a, &["-c:a", "libmp3lame", "-q:a", o.pick("2", "4", "6")]),
                    _ => push(&mut a, &["-c:a", "aac", "-b:a", audio_rate]),
                }
            }
            if matches!(format.id, "mp4" | "mp4-hevc" | "mov") {
                push(&mut a, &["-movflags", "+faststart"]);
            }
        }
        "audio" => {
            push(&mut a, &["-map", "0:a:0", "-vn"]);
            match format.id {
                "mp3" => push(&mut a, &["-c:a", "libmp3lame", "-q:a", o.pick("0", "2", "5")]),
                "m4a" => push(&mut a, &["-c:a", "aac", "-b:a", o.pick("256k", "192k", "128k")]),
                "wav" => push(&mut a, &["-c:a", "pcm_s16le"]),
                "flac" => push(&mut a, &["-c:a", "flac"]),
                "ogg" => push(&mut a, &["-c:a", "libvorbis", "-q:a", o.pick("7", "5", "3")]),
                "opus" => push(&mut a, &["-c:a", "libopus", "-b:a", o.pick("160k", "128k", "96k")]),
                _ => return Err("cannotConvert".into()),
            }
        }
        _ => {
            // Pictures: one frame.
            let scale = picture_scale(o.max_height);
            match format.id {
                // JPG and BMP have no transparency: put see-through pictures on white.
                "jpg" | "bmp" if media.alpha => {
                    let first = scale.map(|s| format!("[0:V:0]{s}[i]")).unwrap_or_else(|| "[0:V:0]null[i]".into());
                    let pixels = if format.id == "jpg" { "yuvj444p" } else { "bgr24" };
                    a.push("-filter_complex".into());
                    a.push(format!("{first};color=white,format=rgb24[bg];[bg][i]scale2ref[bg][i];[bg][i]overlay=shortest=1,format={pixels}"));
                }
                "ico" => {
                    push(&mut a, &["-map", "0:V:0", "-vf", "scale=256:256:force_original_aspect_ratio=decrease"]);
                }
                _ => {
                    push(&mut a, &["-map", "0:V:0"]);
                    if let Some(scale) = scale {
                        a.push("-vf".into());
                        a.push(scale);
                    }
                }
            }
            push(&mut a, &["-frames:v", "1"]);
            match format.id {
                "jpg" => push(&mut a, &["-c:v", "mjpeg", "-q:v", o.pick("2", "4", "8"), "-update", "1"]),
                "png" => push(&mut a, &["-c:v", "png", "-update", "1"]),
                "bmp" => push(&mut a, &["-c:v", "bmp", "-update", "1"]),
                "tiff" => push(&mut a, &["-c:v", "tiff", "-update", "1"]),
                "webp" => push(&mut a, &["-c:v", "libwebp", "-quality", o.pick("92", "82", "70")]),
                "avif" if encoders.contains("libaom-av1") => {
                    push(&mut a, &["-c:v", "libaom-av1", "-still-picture", "1", "-crf", o.pick("20", "30", "40"), "-cpu-used", "6"]);
                }
                "avif" => push(&mut a, &["-c:v", "libsvtav1", "-crf", o.pick("20", "30", "40")]),
                "ico" => {}
                _ => return Err("cannotConvert".into()),
            }
        }
    }
    push(&mut a, &["-progress", "pipe:1", "-nostats", "-stats_period", "0.5"]);
    a.push(output.display().to_string());
    Ok(a)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn media(kind: &'static str, has_audio: bool, alpha: bool) -> Media {
        Media {
            path: r"C:\in\clip.mov".into(),
            name: "clip.mov".into(),
            size: 1,
            kind,
            duration: 10.0,
            width: 1920,
            height: 1080,
            fps: 30.0,
            video_codec: "h264".into(),
            audio_codec: "aac".into(),
            channels: 2,
            sample_rate: 48000,
            bitrate: 0,
            has_audio,
            alpha,
            cover: false,
        }
    }

    fn all() -> HashSet<String> {
        FORMATS.iter().flat_map(|f| needs(f.id).iter().flat_map(|any| any.iter())).map(|e| e.to_string()).collect()
    }

    fn run(m: &Media, id: &str, o: &Options) -> Result<String, String> {
        args(m, get(id).unwrap(), o, Path::new(r"C:\out\x.part"), &all()).map(|a| a.join(" "))
    }

    #[test]
    fn every_format_has_its_encoders_listed() {
        assert_eq!(available(&all()).len(), FORMATS.len());
        let only_audio: HashSet<String> = ["libmp3lame", "aac"].iter().map(|s| s.to_string()).collect();
        assert_eq!(available(&only_audio), vec!["mp3", "m4a"]);
        let mut svt = all();
        svt.remove("libaom-av1");
        assert!(available(&svt).contains(&"avif"));
    }

    #[test]
    fn matches_sources_to_targets() {
        let (video, audio, image) = (media("video", true, false), media("audio", true, false), media("image", false, false));
        let o = Options::default();
        assert!(run(&video, "mp3", &o).is_ok());
        assert!(run(&video, "gif", &o).is_ok());
        assert_eq!(run(&video, "png", &o).err().as_deref(), Some("cannotConvert"));
        assert_eq!(run(&audio, "mp4", &o).err().as_deref(), Some("cannotConvert"));
        assert_eq!(run(&image, "mp3", &o).err().as_deref(), Some("cannotConvert"));
        assert_eq!(run(&media("video", false, false), "mp3", &o).err().as_deref(), Some("noAudio"));
    }

    #[test]
    fn builds_video_arguments() {
        let o = Options { quality: "high".into(), max_height: 720, mute: false };
        let mp4 = run(&media("video", true, false), "mp4", &o).unwrap();
        assert!(mp4.contains("-c:v libx264 -preset medium -crf 18"), "{mp4}");
        assert!(mp4.contains("-map 0:a:0") && mp4.contains("-c:a aac -b:a 192k") && mp4.contains("+faststart"));
        assert!(mp4.contains("min(ih,720)"));
        assert!(mp4.ends_with(r"-progress pipe:1 -nostats -stats_period 0.5 C:\out\x.part"));

        let muted = run(&media("video", true, false), "webm", &Options { mute: true, ..Options::default() }).unwrap();
        assert!(muted.contains("-an") && !muted.contains("libopus") && muted.contains("-crf 33"));
        assert!(muted.contains("scale='trunc(iw/2)*2'"));

        let gif = run(&media("video", true, false), "gif", &Options::default()).unwrap();
        assert!(gif.contains("min(ih,480)") && gif.contains("palettegen") && gif.contains("-an"));
    }

    #[test]
    fn builds_audio_and_picture_arguments() {
        let o = Options { quality: "small".into(), ..Options::default() };
        let mp3 = run(&media("audio", true, false), "mp3", &o).unwrap();
        assert!(mp3.contains("-map 0:a:0 -vn -c:a libmp3lame -q:a 5"), "{mp3}");

        let png = media("image", false, true);
        let jpg = run(&png, "jpg", &o).unwrap();
        assert!(jpg.contains("color=white") && jpg.contains("-q:v 8") && jpg.contains("-frames:v 1"), "{jpg}");
        let webp = run(&png, "webp", &Options { max_height: 600, ..o.clone() }).unwrap();
        assert!(webp.contains("-vf scale=-1:'min(ih,600)'") && webp.contains("-quality 70") && !webp.contains("color=white"));
        assert!(run(&png, "ico", &o).unwrap().contains("force_original_aspect_ratio=decrease"));
        assert!(run(&png, "avif", &o).unwrap().contains("libaom-av1 -still-picture 1 -crf 40"));
    }
}
