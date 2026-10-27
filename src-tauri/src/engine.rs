//! The conversion engine is FFmpeg. Xvert looks for it beside the exe, then
//! in `Data\ffmpeg\` (where its own download goes), then on PATH. When none is
//! found it can download the gyan.dev "essentials" build, the Windows build
//! linked from ffmpeg.org, check it against the published SHA-256 and keep
//! only ffmpeg.exe and ffprobe.exe.

use crate::portable;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

const ZIP_URL: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const SHA_URL: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256";
const MAX_DOWNLOAD: u64 = 400 * 1024 * 1024;
/// Child processes get no console window.
pub const NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Engine {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub version: String,
    /// "beside", "data" or "system".
    pub source: &'static str,
    #[serde(skip)]
    pub encoders: HashSet<String>,
}

pub fn command(program: &Path) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(NO_WINDOW);
    command
}

fn data_folder() -> PathBuf {
    portable::data_dir().join("ffmpeg")
}

fn on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|dir| dir.join(name)).find(|file| file.is_file())
}

fn candidates() -> Vec<(PathBuf, PathBuf, &'static str)> {
    let mut list = Vec::new();
    for (dir, source) in [(portable::exe_dir(), "beside"), (data_folder(), "data")] {
        list.push((dir.join("ffmpeg.exe"), dir.join("ffprobe.exe"), source));
    }
    if let (Some(ffmpeg), Some(ffprobe)) = (on_path("ffmpeg.exe"), on_path("ffprobe.exe")) {
        list.push((ffmpeg, ffprobe, "system"));
    }
    list
}

/// "ffmpeg version 8.1.1-full_build-www.gyan.dev Copyright…" -> "8.1.1-full_build-www.gyan.dev".
fn parse_version(text: &str) -> Option<String> {
    let line = text.lines().next()?;
    let rest = line.strip_prefix("ffmpeg version ")?;
    Some(rest.split_whitespace().next()?.to_string())
}

/// Encoder names from `ffmpeg -encoders`, listed under the "------" line.
fn parse_encoders(text: &str) -> HashSet<String> {
    text.lines()
        .skip_while(|line| !line.trim_start().starts_with("------"))
        .skip(1)
        .filter_map(|line| line.split_whitespace().nth(1).map(String::from))
        .collect()
}

fn output(program: &Path, args: &[&str]) -> Option<String> {
    let out = command(program).args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The first working FFmpeg, with its version and encoders.
pub fn find() -> Option<Engine> {
    candidates().into_iter().find_map(|(ffmpeg, ffprobe, source)| {
        if !ffmpeg.is_file() || !ffprobe.is_file() {
            return None;
        }
        let version = parse_version(&output(&ffmpeg, &["-hide_banner", "-version"])?)?;
        let encoders = parse_encoders(&output(&ffmpeg, &["-hide_banner", "-encoders"])?);
        Some(Engine { ffmpeg, ffprobe, version, source, encoders })
    })
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().user_agent("skale-xvert").timeout_connect(Duration::from_secs(15)).build()
}

/// The first hex word of a ".sha256" file.
fn parse_sha(text: &str) -> Option<String> {
    let word = text.split_whitespace().next()?.to_ascii_lowercase();
    (word.len() == 64 && word.chars().all(|c| c.is_ascii_hexdigit())).then_some(word)
}

/// Writes ffmpeg.exe and ffprobe.exe from the build's `bin\` folder into `dir`.
fn extract(zip_path: &Path, dir: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(fs::File::open(zip_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mut found = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().replace('\\', "/");
        let Some(file) = ["ffmpeg.exe", "ffprobe.exe"].into_iter().find(|f| name.ends_with(&format!("/bin/{f}"))) else {
            continue;
        };
        let part = dir.join(format!("{file}.part"));
        let mut out = fs::File::create(&part).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        drop(out);
        fs::rename(&part, dir.join(file)).map_err(|e| e.to_string())?;
        found += 1;
    }
    if found == 2 { Ok(()) } else { Err("the download does not contain ffmpeg.exe and ffprobe.exe".into()) }
}

/// Downloads FFmpeg into `Data\ffmpeg\`, reporting (bytes so far, total).
pub fn download(mut progress: impl FnMut(u64, u64)) -> Result<Engine, String> {
    let agent = agent();
    let expected = agent
        .get(SHA_URL)
        .timeout(Duration::from_secs(30))
        .call()
        .map_err(|e| e.to_string())?
        .into_string()
        .map_err(|e| e.to_string())?;
    let expected = parse_sha(&expected).ok_or("the checksum file is not valid")?;

    let response = agent.get(ZIP_URL).timeout(Duration::from_secs(1800)).call().map_err(|e| e.to_string())?;
    let total: u64 = response.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let dir = data_folder();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let zip_path = dir.join("ffmpeg-download.zip");
    let result = (|| {
        let mut file = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
        let mut reader = response.into_reader().take(MAX_DOWNLOAD);
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 256 * 1024];
        let mut done = 0u64;
        loop {
            let n = reader.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
            file.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
            done += n as u64;
            progress(done, total);
        }
        drop(file);
        let actual: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if actual != expected {
            return Err("the download is damaged (checksum mismatch)".to_string());
        }
        extract(&zip_path, &dir)
    })();
    let _ = fs::remove_file(&zip_path);
    result?;
    find().ok_or_else(|| "FFmpeg was downloaded but does not start".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_version_and_encoders() {
        assert_eq!(
            parse_version("ffmpeg version 8.1.1-full_build-www.gyan.dev Copyright (c) 2000-2026\nbuilt with gcc").as_deref(),
            Some("8.1.1-full_build-www.gyan.dev")
        );
        assert_eq!(parse_version("garbage"), None);
        let list = "Encoders:\n V..... = Video\n ------\n V....D libx264              H.264\n A....D aac                  AAC\n";
        let encoders = parse_encoders(list);
        assert!(encoders.contains("libx264") && encoders.contains("aac"));
        assert!(!encoders.contains("="));
    }

    #[test]
    fn reads_checksum_files() {
        let sha = "a".repeat(64);
        assert_eq!(parse_sha(&format!("{sha}  ffmpeg.zip\n")), Some(sha));
        assert_eq!(parse_sha("not a hash"), None);
    }

    #[test]
    fn extracts_only_the_two_programs() {
        let dir = std::env::temp_dir().join(format!("xvert-extract-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let zip_path = dir.join("build.zip");
        let mut writer = zip::ZipWriter::new(fs::File::create(&zip_path).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        for (name, body) in [
            ("ffmpeg-8.0-essentials/bin/ffmpeg.exe", "engine"),
            ("ffmpeg-8.0-essentials/bin/ffprobe.exe", "probe"),
            ("ffmpeg-8.0-essentials/bin/ffplay.exe", "player"),
            ("ffmpeg-8.0-essentials/README.txt", "readme"),
        ] {
            writer.start_file(name, options).unwrap();
            writer.write_all(body.as_bytes()).unwrap();
        }
        writer.finish().unwrap();
        extract(&zip_path, &dir).unwrap();
        assert_eq!(fs::read_to_string(dir.join("ffmpeg.exe")).unwrap(), "engine");
        assert_eq!(fs::read_to_string(dir.join("ffprobe.exe")).unwrap(), "probe");
        assert!(!dir.join("ffplay.exe").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
