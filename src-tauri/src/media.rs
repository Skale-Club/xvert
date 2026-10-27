//! What a file is: ffprobe tells us its streams, and from those we sort it
//! into video, audio or image. Also makes the small preview pictures.

use crate::engine::{self, Engine};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// "video", "audio" or "image".
    pub kind: &'static str,
    /// Seconds; 0 for still images.
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub video_codec: String,
    pub audio_codec: String,
    pub channels: u32,
    pub sample_rate: u32,
    /// bits per second of the whole file
    pub bitrate: u64,
    pub has_audio: bool,
    /// The picture has an alpha channel (matters for JPG, which has none).
    pub alpha: bool,
    /// An audio file with cover art.
    pub cover: bool,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Probe {
    streams: Vec<Stream>,
    format: Format,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Stream {
    codec_type: String,
    codec_name: String,
    width: u32,
    height: u32,
    pix_fmt: String,
    avg_frame_rate: String,
    r_frame_rate: String,
    nb_frames: Option<String>,
    channels: u32,
    sample_rate: Option<String>,
    duration: Option<String>,
    disposition: Disposition,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Disposition {
    attached_pic: u8,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Format {
    format_name: String,
    duration: Option<String>,
    bit_rate: Option<String>,
}

fn number(text: &Option<String>) -> f64 {
    text.as_deref().and_then(|t| t.parse().ok()).unwrap_or(0.0)
}

/// "30000/1001" -> 29.97
fn rate(text: &str) -> f64 {
    match text.split_once('/') {
        Some((a, b)) => match (a.parse::<f64>(), b.parse::<f64>()) {
            (Ok(a), Ok(b)) if b > 0.0 => a / b,
            _ => 0.0,
        },
        None => text.parse().unwrap_or(0.0),
    }
}

/// Codecs that only ever hold single pictures.
const STILL_CODECS: &[&str] = &["png", "mjpeg", "bmp", "tiff", "webp", "jpeg2000", "jpegxl", "av1", "hevc", "ppm", "pgm", "pam", "qoi", "targa", "sgi", "dds", "psd", "exr", "hdr", "xbm", "pcx"];

fn sort(probe: &Probe) -> Option<&'static str> {
    let picture = probe.streams.iter().find(|s| s.codec_type == "video" && s.disposition.attached_pic == 0);
    let audio = probe.streams.iter().any(|s| s.codec_type == "audio");
    let format = &probe.format.format_name;
    match picture {
        Some(stream) => {
            let frames: u64 = stream.nb_frames.as_deref().and_then(|n| n.parse().ok()).unwrap_or(0);
            let still_format = format.ends_with("_pipe") || format == "image2" || format == "ico";
            // One frame and no length: an AVIF or HEIC picture in an MP4-style box, or a still GIF.
            let one_frame = frames <= 1 && number(&probe.format.duration) < 0.2;
            let single = (still_format || one_frame) && STILL_CODECS.contains(&stream.codec_name.as_str());
            let still_gif = stream.codec_name == "gif" && one_frame;
            Some(if (single || still_gif) && !audio { "image" } else { "video" })
        }
        None if audio => Some("audio"),
        None => None,
    }
}

fn parse(path: &Path, size: u64, json: &str) -> Result<Media, String> {
    let probe: Probe = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let kind = sort(&probe).ok_or("notMedia")?;
    let video = probe.streams.iter().find(|s| s.codec_type == "video" && s.disposition.attached_pic == 0);
    let audio = probe.streams.iter().find(|s| s.codec_type == "audio");
    let mut duration = number(&probe.format.duration);
    if duration <= 0.0 {
        duration = probe.streams.iter().map(|s| number(&s.duration)).fold(0.0, f64::max);
    }
    let alpha_formats = ["rgba", "bgra", "argb", "abgr", "ya8", "ya16", "yuva", "gbrap", "pal8", "rgba64", "bgra64"];
    Ok(Media {
        path: path.display().to_string(),
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        size,
        kind,
        duration: if kind == "image" { 0.0 } else { duration },
        width: video.map_or(0, |v| v.width),
        height: video.map_or(0, |v| v.height),
        fps: video.map_or(0.0, |v| {
            let avg = rate(&v.avg_frame_rate);
            if avg > 0.0 { avg } else { rate(&v.r_frame_rate) }
        }),
        video_codec: video.map(|v| v.codec_name.clone()).unwrap_or_default(),
        audio_codec: audio.map(|a| a.codec_name.clone()).unwrap_or_default(),
        channels: audio.map_or(0, |a| a.channels),
        sample_rate: audio.map_or(0, |a| number(&a.sample_rate) as u32),
        bitrate: number(&probe.format.bit_rate) as u64,
        has_audio: audio.is_some(),
        alpha: video.is_some_and(|v| alpha_formats.iter().any(|f| v.pix_fmt.starts_with(f))),
        cover: kind == "audio" && probe.streams.iter().any(|s| s.disposition.attached_pic == 1),
    })
}

pub fn probe(engine: &Engine, path: &Path) -> Result<Media, String> {
    let size = std::fs::metadata(path).map_err(|_| "notFound")?.len();
    let out = engine::command(&engine.ffprobe)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(path)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("notMedia".into());
    }
    parse(path, size, &String::from_utf8_lossy(&out.stdout))
}

/// Files dropped as folders are opened up, keeping what looks like media.
const MEDIA_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mkv", "mov", "avi", "wmv", "webm", "flv", "mpg", "mpeg", "ts", "mts", "m2ts", "3gp", "ogv", "vob", "gif",
    "mp3", "wav", "flac", "m4a", "aac", "ogg", "oga", "opus", "wma", "aiff", "aif", "alac", "ape", "amr", "mka", "ac3", "dts",
    "jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "heic", "heif", "avif", "ico", "jxl", "tga", "psd", "jfif", "dds",
];

/// "*.mp4;*.mkv;…" for the Open dialog.
pub fn patterns() -> String {
    MEDIA_EXTENSIONS.iter().map(|e| format!("*.{e}")).collect::<Vec<_>>().join(";")
}

pub fn looks_like_media(path: &Path) -> bool {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .is_some_and(|e| MEDIA_EXTENSIONS.contains(&e.as_str()))
}

/// Files as given, and media files inside given folders (at most `limit`).
pub fn expand(paths: &[String], limit: usize) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut stack: Vec<PathBuf> = paths.iter().rev().map(PathBuf::from).collect();
    while let Some(path) = stack.pop() {
        if files.len() >= limit {
            break;
        }
        if path.is_dir() {
            let Ok(entries) = std::fs::read_dir(&path) else { continue };
            let mut children: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
            children.sort();
            for child in children.into_iter().rev() {
                if child.is_dir() || looks_like_media(&child) {
                    stack.push(child);
                }
            }
        } else if path.is_file() {
            files.push(path);
        }
    }
    files
}

/// A small JPEG of the picture, the frame a little way in, or the cover art.
pub fn thumbnail(engine: &Engine, media: &Media) -> Option<String> {
    let mut command = engine::command(&engine.ffmpeg);
    command.args(["-v", "error", "-nostdin"]);
    if media.kind == "video" && media.duration > 1.0 {
        command.args(["-ss", &format!("{:.2}", (media.duration * 0.1).min(5.0))]);
    }
    command.arg("-i").arg(&media.path);
    command.args(["-map", if media.kind == "audio" { "0:v:0" } else { "0:V:0" }]);
    command.args(["-frames:v", "1", "-vf", "scale=240:-2,format=yuvj420p"]);
    command.args(["-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "6", "pipe:1"]);
    let out = command.output().ok()?;
    (out.status.success() && !out.stdout.is_empty())
        .then(|| format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(&out.stdout)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn media(json: &str) -> Result<Media, String> {
        parse(Path::new(r"C:\in\file.x"), 10, json)
    }

    #[test]
    fn sorts_files_by_their_streams() {
        let video = r#"{"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"avg_frame_rate":"30000/1001","pix_fmt":"yuv420p"},{"codec_type":"audio","codec_name":"aac","channels":2,"sample_rate":"48000"}],"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"12.5","bit_rate":"5000000"}}"#;
        let m = media(video).unwrap();
        assert_eq!((m.kind, m.width, m.height, m.has_audio, m.channels), ("video", 1920, 1080, true, 2));
        assert!((m.fps - 29.97).abs() < 0.01 && m.duration == 12.5 && !m.alpha);

        let song = r#"{"streams":[{"codec_type":"audio","codec_name":"mp3","channels":2},{"codec_type":"video","codec_name":"mjpeg","disposition":{"attached_pic":1}}],"format":{"format_name":"mp3","duration":"200"}}"#;
        let m = media(song).unwrap();
        assert_eq!((m.kind, m.cover, m.width), ("audio", true, 0));

        let png = r#"{"streams":[{"codec_type":"video","codec_name":"png","width":30,"height":20,"pix_fmt":"rgba"}],"format":{"format_name":"png_pipe"}}"#;
        let m = media(png).unwrap();
        assert_eq!((m.kind, m.alpha, m.duration), ("image", true, 0.0));

        let still_gif = r#"{"streams":[{"codec_type":"video","codec_name":"gif","nb_frames":"1"}],"format":{"format_name":"gif","duration":"0.1"}}"#;
        assert_eq!(media(still_gif).unwrap().kind, "image");
        let animation = r#"{"streams":[{"codec_type":"video","codec_name":"gif","nb_frames":"40"}],"format":{"format_name":"gif","duration":"4"}}"#;
        assert_eq!(media(animation).unwrap().kind, "video");

        let text = r#"{"streams":[{"codec_type":"data"}],"format":{"format_name":"tty"}}"#;
        assert_eq!(media(text).err().as_deref(), Some("notMedia"));
    }

    #[test]
    fn recognizes_media_extensions() {
        assert!(looks_like_media(Path::new("a/Song.FLAC")));
        assert!(!looks_like_media(Path::new("a/notes.txt")));
        assert!(!looks_like_media(Path::new("a/noext")));
    }
}
