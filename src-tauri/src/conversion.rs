//! Shared conversion completion policy for the window and MCP. Original deletion
//! is explicit, happens only after a verified output, and never makes a completed
//! conversion look failed when the original could not be removed.

use crate::{engine::Engine, formats, job, media};
use serde::Serialize;
use std::{fs, path::Path, time::SystemTime};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Completed {
    pub path: String,
    pub size: u64,
    pub original_deleted: bool,
    pub delete_original_error: Option<String>,
}

pub enum Outcome {
    Done(Completed),
    Cancelled,
}

#[derive(PartialEq, Debug)]
struct Snapshot {
    size: u64,
    modified: SystemTime,
}

impl Snapshot {
    fn read(source: &Path) -> Result<Self, String> {
        let metadata = fs::metadata(source).map_err(|e| e.to_string())?;
        if !metadata.is_file() {
            return Err("sourceChanged".into());
        }
        Ok(Self { size: metadata.len(), modified: metadata.modified().map_err(|e| e.to_string())? })
    }
}

fn remove_original(source: &Path, before: &Result<Snapshot, String>, output: &Path, verify: impl FnOnce() -> Result<(), String>, cancelled: impl FnOnce() -> bool) -> Result<(), String> {
    let before = before.as_ref().map_err(Clone::clone)?;
    let output_path = fs::canonicalize(output).map_err(|_| "outputNotVerified")?;
    let source_path = fs::canonicalize(source).map_err(|_| "sourceChanged")?;
    if source_path == output_path || !output.is_file() || fs::metadata(output).map_err(|_| "outputNotVerified")?.len() == 0 {
        return Err("outputNotVerified".into());
    }
    verify().map_err(|_| "outputNotVerified")?;
    // Check again after probing the output: the source may have changed while encoding.
    if &Snapshot::read(source)? != before {
        return Err("sourceChanged".into());
    }
    if cancelled() {
        return Err("deleteOriginalCancelled".into());
    }
    fs::remove_file(source).map_err(|e| e.to_string())
}

pub fn run(engine: &Engine, jobs: &job::Jobs, id: u32, source: &media::Media, format: &formats::Format, options: &formats::Options, output: &Path, progress: impl Fn(f64, f64, u64)) -> Result<Outcome, String> {
    jobs.begin_conversion(id);
    let result = run_active(engine, jobs, id, source, format, options, output, progress);
    jobs.end_conversion(id);
    result
}

fn run_active(engine: &Engine, jobs: &job::Jobs, id: u32, source: &media::Media, format: &formats::Format, options: &formats::Options, output: &Path, progress: impl Fn(f64, f64, u64)) -> Result<Outcome, String> {
    let source_path = Path::new(&source.path);
    let before = options.delete_original.then(|| Snapshot::read(source_path));
    let args = formats::args(source, format, options, &job::part_path(output), &engine.encoders)?;
    match job::run(engine, jobs, id, &args, output, progress)? {
        job::Outcome::Cancelled => Ok(Outcome::Cancelled),
        job::Outcome::Done(path, size) => {
            let deletion = before.map(|snapshot| remove_original(source_path, &snapshot, &path, || {
                let converted = media::probe(engine, &path)?;
                if converted.kind != format.kind {
                    return Err("outputNotVerified".into());
                }
                if format.kind == "image" {
                    if converted.width == 0 || converted.height == 0 {
                        return Err("outputNotVerified".into());
                    }
                } else if converted.duration <= 0.0 || (source.duration > 0.0
                    && (converted.duration - source.duration).abs() > (source.duration * 0.02).max(2.0)) {
                    return Err("outputNotVerified".into());
                }
                Ok(())
            }, || jobs.is_cancelled(id)));
            let original_deleted = matches!(deletion, Some(Ok(())));
            let delete_original_error = deletion.and_then(Result::err);
            Ok(Outcome::Done(Completed { path: path.display().to_string(), size, original_deleted, delete_original_error }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("xvert-cleanup-{name}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn preserves_source_when_output_is_missing_empty_same_or_unverified() {
        let dir = folder("invalid-output");
        let source = dir.join("original.txt");
        let output = dir.join("output.txt");
        fs::write(&source, "original").unwrap();
        let before = Snapshot::read(&source);
        assert!(remove_original(&source, &before, &output, || Ok(()), || false).is_err());
        fs::write(&output, "").unwrap();
        assert!(remove_original(&source, &before, &output, || Ok(()), || false).is_err());
        assert!(remove_original(&source, &before, &source, || Ok(()), || false).is_err());
        fs::write(&output, "converted").unwrap();
        assert!(remove_original(&source, &before, &output, || Err("bad output".into()), || false).is_err());
        assert_eq!(remove_original(&source, &before, &output, || Ok(()), || true).unwrap_err(), "deleteOriginalCancelled");
        assert_eq!(fs::read_to_string(&source).unwrap(), "original");
        assert_eq!(fs::read_to_string(&output).unwrap(), "converted");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn preserves_changed_source_and_reports_deletion_failure() {
        let dir = folder("changed");
        let source = dir.join("original.txt");
        let output = dir.join("output.txt");
        fs::write(&source, "original").unwrap();
        fs::write(&output, "converted").unwrap();
        let before = Snapshot::read(&source);
        fs::write(&source, "a new, different original").unwrap();
        assert_eq!(remove_original(&source, &before, &output, || Ok(()), || false).unwrap_err(), "sourceChanged");
        assert!(source.exists() && output.exists());
        let before = Snapshot::read(&source);
        let held = fs::OpenOptions::new().read(true).share_mode(1).open(&source).unwrap();
        assert!(remove_original(&source, &before, &output, || Ok(()), || false).is_err());
        assert!(source.exists() && output.exists());
        drop(held);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn removes_only_the_source_after_verified_success() {
        let dir = folder("success");
        let source = dir.join("original.txt");
        let output = dir.join("output.txt");
        fs::write(&source, "original").unwrap();
        fs::write(&output, "converted").unwrap();
        let before = Snapshot::read(&source);
        remove_original(&source, &before, &output, || Ok(()), || false).unwrap();
        assert!(!source.exists());
        assert_eq!(fs::read_to_string(&output).unwrap(), "converted");
        fs::remove_dir_all(dir).unwrap();
    }

    use std::os::windows::fs::OpenOptionsExt;

    #[test]
    fn real_conversions_delete_only_with_opt_in_and_keep_sources_on_failure_or_cancel() {
        let Some(engine) = crate::engine::find() else { return };
        let dir = folder("real");
        let original = dir.join("original.wav");
        assert!(crate::engine::command(&engine.ffmpeg).args(["-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=1"])
            .arg(&original).status().unwrap().success());
        let jobs = job::Jobs::default();
        let format = formats::get("m4a").unwrap();
        for (id, remove) in [(1, false), (2, true)] {
            let source_path = dir.join(format!("source-{id}.wav"));
            fs::copy(&original, &source_path).unwrap();
            let source = media::probe(&engine, &source_path).unwrap();
            let output = dir.join(format!("output-{id}.m4a"));
            let options = formats::Options { delete_original: remove, ..Default::default() };
            let Outcome::Done(done) = run(&engine, &jobs, id, &source, format, &options, &output, |_, _, _| {}).unwrap() else { panic!("cancelled") };
            assert_eq!(done.original_deleted, remove);
            assert!(done.delete_original_error.is_none() && output.is_file());
            assert_eq!(source_path.exists(), !remove);
        }
        let source = media::probe(&engine, &original).unwrap();
        let options = formats::Options { delete_original: true, ..Default::default() };
        jobs.cancel(3);
        let output = dir.join("cancelled.m4a");
        assert!(matches!(run(&engine, &jobs, 3, &source, format, &options, &output, |_, _, _| {}).unwrap(), Outcome::Cancelled));
        assert!(original.exists() && !output.exists());
        let invalid = media::Media { path: dir.join("invalid.wav").display().to_string(), ..source.clone() };
        fs::write(&invalid.path, "not a media file").unwrap();
        assert!(run(&engine, &jobs, 4, &invalid, format, &options, &dir.join("failed.m4a"), |_, _, _| {}).is_err());
        assert!(Path::new(&invalid.path).exists());
        let held = fs::OpenOptions::new().read(true).share_mode(1).open(&original).unwrap();
        let output = dir.join("kept-original.m4a");
        let Outcome::Done(done) = run(&engine, &jobs, 5, &source, format, &options, &output, |_, _, _| {}).unwrap() else { panic!("cancelled") };
        assert!(!done.original_deleted && done.delete_original_error.is_some());
        assert!(original.exists() && output.exists());
        drop(held);
        // Exercise source deletion for each media kind, not only audio extraction.
        for (id, input, target, args) in [
            (6, "video.mp4", "mp4", vec!["-f", "lavfi", "-i", "testsrc2=s=64x64:d=1:r=15", "-c:v", "libx264"]),
            (7, "image.png", "jpg", vec!["-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1"]),
        ] {
            let input = dir.join(input);
            assert!(crate::engine::command(&engine.ffmpeg).args(["-v", "error", "-y"]).args(args).arg(&input).status().unwrap().success());
            let source = media::probe(&engine, &input).unwrap();
            let format = formats::get(target).unwrap();
            let output = dir.join(format!("output-{id}.{}", format.ext));
            let Outcome::Done(done) = run(&engine, &jobs, id, &source, format, &options, &output, |_, _, _| {}).unwrap() else { panic!("cancelled") };
            assert!(done.original_deleted && done.delete_original_error.is_none());
            assert!(!input.exists() && output.exists());
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
