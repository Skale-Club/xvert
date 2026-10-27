//! Runs one conversion: FFmpeg writes to `<name>.part.<ext>` beside the final
//! name, and only a finished file is renamed into place, so a cancelled or
//! failed job never leaves a half-written file under the real name.

use crate::engine::{self, Engine};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};

/// Jobs running now, so they can be cancelled, and the names they will take,
/// so two jobs never pick the same one.
#[derive(Default)]
pub struct Jobs {
    running: Mutex<HashMap<u32, Arc<Mutex<Child>>>>,
    cancelled: Mutex<HashSet<u32>>,
    reserved: Mutex<HashSet<PathBuf>>,
}

impl Jobs {
    pub fn cancel(&self, id: u32) {
        self.cancelled.lock().unwrap().insert(id);
        if let Some(child) = self.running.lock().unwrap().get(&id) {
            let _ = child.lock().unwrap().kill();
        }
    }

    pub fn cancel_all(&self) {
        let ids: Vec<u32> = self.running.lock().unwrap().keys().copied().collect();
        for id in ids {
            self.cancel(id);
        }
    }
}

/// `dir\stem.ext`, or `dir\stem (2).ext` and so on when that is taken (on
/// disk, by the source itself, or by another job).
pub fn output_path(dir: &Path, stem: &str, ext: &str, source: &Path, reserved: &HashSet<PathBuf>) -> PathBuf {
    let taken = |p: &Path| p.exists() || p == source || reserved.contains(p);
    let mut path = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while taken(&path) || taken(&part_path(&path)) {
        path = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    path
}

/// "a.mp4" -> "a.part.mp4": FFmpeg still sees the real extension.
pub fn part_path(path: &Path) -> PathBuf {
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!("{stem}.part.{ext}"))
}

/// Seconds from a progress block's `out_time_us=` (or `out_time_ms=`, which
/// FFmpeg also gives in microseconds).
fn seconds(line: &str) -> Option<f64> {
    let value = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms="))?;
    value.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0).filter(|s| *s >= 0.0)
}

/// "1.25x" -> 1.25
fn speed(line: &str) -> Option<f64> {
    line.strip_prefix("speed=")?.trim().trim_end_matches('x').parse().ok()
}

pub enum Outcome {
    Done(PathBuf, u64),
    Cancelled,
}

/// Picks the output name and holds it until `release`.
pub fn reserve(jobs: &Jobs, dir: &Path, source: &Path, ext: &str) -> PathBuf {
    let stem = source.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "output".into());
    let mut reserved = jobs.reserved.lock().unwrap();
    let path = output_path(dir, &stem, ext, source, &reserved);
    reserved.insert(path.clone());
    path
}

pub fn release(jobs: &Jobs, path: &Path) {
    jobs.reserved.lock().unwrap().remove(path);
}

/// Runs FFmpeg with `args` (whose last item is the part file) and reports
/// (seconds written, speed) as it goes.
pub fn run(engine: &Engine, jobs: &Jobs, id: u32, args: &[String], output: &Path, progress: impl Fn(f64, f64)) -> Result<Outcome, String> {
    let part = part_path(output);
    let mut child = engine::command(&engine.ffmpeg)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("no output")?;
    let mut stderr = child.stderr.take().ok_or("no output")?;
    let child = Arc::new(Mutex::new(child));
    jobs.running.lock().unwrap().insert(id, child.clone());
    // Cancelled while starting: ids are never reused, so the mark is for this run.
    if jobs.cancelled.lock().unwrap().contains(&id) {
        let _ = child.lock().unwrap().kill();
    }

    // Read errors on the side so a chatty FFmpeg never blocks on a full pipe.
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        text
    });
    let (mut at, mut rate) = (0.0, 0.0);
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Some(s) = seconds(&line) {
            at = s;
        } else if let Some(s) = speed(&line) {
            rate = s;
        } else if line.starts_with("progress=") {
            progress(at, rate);
        }
    }
    let status = child.lock().unwrap().wait().map_err(|e| e.to_string());
    jobs.running.lock().unwrap().remove(&id);
    let errors = errors.join().unwrap_or_default();
    let cancelled = jobs.cancelled.lock().unwrap().remove(&id);

    if cancelled || !status.as_ref().is_ok_and(|s| s.success()) {
        let _ = std::fs::remove_file(&part);
        if cancelled {
            return Ok(Outcome::Cancelled);
        }
        let last = errors.lines().map(str::trim).filter(|l| !l.is_empty()).last().unwrap_or("FFmpeg stopped").to_string();
        return Err(status.err().unwrap_or(last));
    }
    std::fs::rename(&part, output).map_err(|e| {
        let _ = std::fs::remove_file(&part);
        e.to_string()
    })?;
    let size = std::fs::metadata(output).map(|m| m.len()).unwrap_or(0);
    Ok(Outcome::Done(output.to_path_buf(), size))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_progress_lines() {
        assert_eq!(seconds("out_time_us=2500000"), Some(2.5));
        assert_eq!(seconds("out_time_ms=1000000"), Some(1.0));
        assert_eq!(seconds("out_time_us=N/A"), None);
        assert_eq!(speed("speed=12.1x"), Some(12.1));
        assert_eq!(speed("speed=N/A"), None);
    }

    #[test]
    fn never_reuses_a_name() {
        let dir = std::env::temp_dir().join(format!("xvert-names-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("song.mp3");
        std::fs::write(&source, "x").unwrap();
        let none = HashSet::new();
        // Same format as the source: the source keeps its name.
        assert_eq!(output_path(&dir, "song", "mp3", &source, &none), dir.join("song (2).mp3"));
        assert_eq!(output_path(&dir, "song", "wav", &source, &none), dir.join("song.wav"));
        let reserved: HashSet<PathBuf> = [dir.join("song.wav")].into_iter().collect();
        assert_eq!(output_path(&dir, "song", "wav", &source, &reserved), dir.join("song (2).wav"));
        assert_eq!(part_path(&dir.join("a.b.mp4")), dir.join("a.b.part.mp4"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
