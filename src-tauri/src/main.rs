// Xvert: portable video, audio and image converter for Windows. Drop files,
// pick a format per kind (videos, music, pictures) and convert; FFmpeg does
// the work. The originals are never changed. No installer, no administrator
// rights.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod formats;
mod job;
mod mcp;
mod mcp_tools;
mod media;
mod portable;
mod updater;
mod win;

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::{fs, process::Command};
use tauri::{AppHandle, Emitter, Manager, State};

/// The format each kind of file becomes.
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
struct Targets {
    video: String,
    audio: String,
    image: String,
}

impl Default for Targets {
    fn default() -> Self {
        Self { video: "mp4".into(), audio: "mp3".into(), image: "jpg".into() }
    }
}

/// Settings kept in Data/xvert.json beside the executable.
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Settings {
    language: String,
    /// Where converted files go; empty means beside each original.
    out_dir: String,
    options: formats::Options,
    targets: Targets,
}

impl Default for Settings {
    fn default() -> Self {
        Self { language: "en".into(), out_dir: String::new(), options: formats::Options::default(), targets: Targets::default() }
    }
}

struct AppState {
    settings: Mutex<Settings>,
    engine: Mutex<Option<Arc<engine::Engine>>>,
    /// Files added to the list, by id.
    media: Mutex<HashMap<u32, media::Media>>,
    next_id: Mutex<u32>,
    jobs: job::Jobs,
}

fn save_settings(settings: &Settings) {
    if let Ok(text) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(portable::data_dir().join("xvert.json"), text);
    }
}

fn load_settings() -> Settings {
    match fs::read_to_string(portable::data_dir().join("xvert.json")) {
        // Some editors save UTF-8 with a BOM, which serde_json rejects.
        Ok(text) => serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap_or_default(),
        Err(_) => {
            let settings = Settings::default();
            save_settings(&settings);
            settings
        }
    }
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn set_settings(state: State<AppState>, settings: Settings) {
    save_settings(&settings);
    *state.settings.lock().unwrap() = settings;
}

fn current_engine(state: &AppState) -> Result<Arc<engine::Engine>, String> {
    state.engine.lock().unwrap().clone().ok_or_else(|| "noEngine".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineStatus {
    engine: Option<Arc<engine::Engine>>,
    formats: &'static [formats::Format],
    /// Format ids this FFmpeg can write.
    available: Vec<&'static str>,
}

fn status(engine: Option<Arc<engine::Engine>>) -> EngineStatus {
    let available = engine.as_ref().map(|e| formats::available(&e.encoders)).unwrap_or_default();
    EngineStatus { engine, formats: formats::FORMATS, available }
}

/// Looks for FFmpeg again and says what it can do.
#[tauri::command]
async fn engine_status(app: AppHandle) -> EngineStatus {
    let found = tauri::async_runtime::spawn_blocking(engine::find).await.ok().flatten().map(Arc::new);
    *app.state::<AppState>().engine.lock().unwrap() = found.clone();
    status(found)
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    done: u64,
    total: u64,
}

/// Downloads FFmpeg into Data\ffmpeg, sending "engine-progress" events.
#[tauri::command]
async fn download_engine(app: AppHandle) -> Result<EngineStatus, String> {
    let emitter = app.clone();
    let found = tauri::async_runtime::spawn_blocking(move || {
        let mut last = Instant::now() - Duration::from_secs(1);
        engine::download(|done, total| {
            if last.elapsed() >= Duration::from_millis(150) || done == total {
                last = Instant::now();
                let _ = emitter.emit("engine-progress", DownloadProgress { done, total });
            }
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    let found = Arc::new(found);
    *app.state::<AppState>().engine.lock().unwrap() = Some(found.clone());
    Ok(status(Some(found)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Added {
    id: u32,
    #[serde(flatten)]
    media: media::Media,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AddResult {
    added: Vec<Added>,
    /// Names of files that are not video, audio or pictures.
    skipped: Vec<String>,
}

/// Reads the dropped or chosen files (folders are opened up) and keeps the
/// ones that are media.
#[tauri::command]
async fn add_files(app: AppHandle, paths: Vec<String>) -> Result<AddResult, String> {
    let engine = current_engine(&app.state::<AppState>())?;
    let probed = tauri::async_runtime::spawn_blocking(move || {
        let files = media::expand(&paths, 2000);
        files.par_iter().map(|path| (path.clone(), media::probe(&engine, path))).collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    let mut list = state.media.lock().unwrap();
    let mut next = state.next_id.lock().unwrap();
    let mut result = AddResult { added: Vec::new(), skipped: Vec::new() };
    for (path, probe) in probed {
        match probe {
            Ok(media) => {
                *next += 1;
                list.insert(*next, media.clone());
                result.added.push(Added { id: *next, media });
            }
            Err(_) => result.skipped.push(path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()),
        }
    }
    Ok(result)
}

#[tauri::command]
fn remove_files(state: State<AppState>, ids: Vec<u32>) {
    let mut list = state.media.lock().unwrap();
    for id in ids {
        list.remove(&id);
    }
}

#[tauri::command]
async fn thumbnail(app: AppHandle, id: u32) -> Option<String> {
    let state = app.state::<AppState>();
    let engine = current_engine(&state).ok()?;
    let media = state.media.lock().unwrap().get(&id)?.clone();
    tauri::async_runtime::spawn_blocking(move || media::thumbnail(&engine, &media)).await.ok().flatten()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct JobProgress {
    job: u32,
    seconds: f64,
    speed: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Converted {
    path: String,
    size: u64,
}

/// Converts file `id` to `format`. `job` is a fresh number for each run, used
/// for "job" progress events and to cancel. None when cancelled.
#[tauri::command]
async fn convert(app: AppHandle, job: u32, id: u32, format: String, options: formats::Options, out_dir: String) -> Result<Option<Converted>, String> {
    let state = app.state::<AppState>();
    let engine = current_engine(&state)?;
    let media = state.media.lock().unwrap().get(&id).cloned().ok_or("notFound")?;
    let format = formats::get(&format).ok_or("cannotConvert")?;
    let source = PathBuf::from(&media.path);
    if !source.is_file() {
        return Err("notFound".into());
    }
    let dir = match out_dir.trim() {
        "" => source.parent().map(Path::to_path_buf).ok_or("notFound")?,
        dir => PathBuf::from(dir),
    };
    if !dir.is_dir() {
        return Err("noOutDir".into());
    }
    let output = job::reserve(&state.jobs, &dir, &source, format.ext);
    let app2 = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = app2.state::<AppState>();
        let args = formats::args(&media, format, &options, &job::part_path(&output), &engine.encoders)?;
        let outcome = job::run(&engine, &state.jobs, job, &args, &output, |seconds, speed| {
            let _ = app2.emit("job", JobProgress { job, seconds, speed });
        });
        job::release(&state.jobs, &output);
        outcome
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(match result {
        job::Outcome::Done(path, size) => Some(Converted { path: path.display().to_string(), size }),
        job::Outcome::Cancelled => None,
    })
}

#[tauri::command]
fn cancel(state: State<AppState>, job: u32) {
    state.jobs.cancel(job);
}

#[tauri::command]
fn cancel_all(state: State<AppState>) {
    state.jobs.cancel_all();
}

#[tauri::command]
async fn pick_files(window: tauri::WebviewWindow, media_label: String, all_label: String) -> Result<Vec<String>, String> {
    let owner = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    tauri::async_runtime::spawn_blocking(move || win::pick_files(owner, &media_label, &all_label, &media::patterns()))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pick_folder(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    let owner = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    tauri::async_runtime::spawn_blocking(move || win::pick_folder(owner)).await.map_err(|e| e.to_string())?
}

/// Shows a file in Explorer; `open` opens a folder instead.
#[tauri::command]
fn reveal(path: String, open: bool) -> Result<(), String> {
    win::reveal(&path, open)
}

/// Opens the Skale Club website in the default browser.
#[tauri::command]
fn open_site() {
    let _ = Command::new("explorer.exe").arg("https://skale.club").spawn();
}

/// Where the background updater stands, for the updates panel.
#[tauri::command]
fn update_status() -> updater::Status {
    updater::status()
}

/// Looks for a newer release now; the result arrives as `update-status`.
#[tauri::command]
fn check_update() {
    updater::check_now();
}

/// Installs the downloaded update now and restarts into it.
#[tauri::command]
fn restart_to_update(app: AppHandle) -> Result<(), String> {
    app.state::<AppState>().jobs.cancel_all();
    updater::restart()?;
    app.exit(0);
    Ok(())
}

fn main() {
    updater::finish_previous();
    portable::sync_appinfo();
    if mcp::requested() {
        return mcp_tools::serve();
    }
    tauri::Builder::default()
        .manage(AppState {
            settings: Mutex::new(load_settings()),
            engine: Mutex::new(None),
            media: Mutex::new(HashMap::new()),
            next_id: Mutex::new(0),
            jobs: job::Jobs::default(),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            updater::start(move |status| {
                let _ = handle.emit("update-status", status);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_settings,
            engine_status,
            download_engine,
            add_files,
            remove_files,
            thumbnail,
            convert,
            cancel,
            cancel_all,
            pick_files,
            pick_folder,
            reveal,
            open_site,
            update_status,
            check_update,
            restart_to_update
        ])
        .on_window_event(|window, event| {
            // Closing the window stops any FFmpeg still running.
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<AppState>().jobs.cancel_all();
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to start Xvert")
        .run(|_, event| {
            // A downloaded update replaces the exe once the app closes.
            if let tauri::RunEvent::Exit = event {
                updater::apply();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Converts a made-up video, song and see-through picture into every
    /// format this FFmpeg can write, and reads each result back.
    #[test]
    fn converts_to_every_format() {
        let Some(engine) = engine::find() else {
            eprintln!("FFmpeg not found; skipping");
            return;
        };
        let dir = std::env::temp_dir().join(format!("xvert-convert-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let make = |args: &[&str]| {
            let ok = engine::command(&engine.ffmpeg).args(["-v", "error", "-y"]).args(args).status().unwrap().success();
            assert!(ok, "could not make {args:?}");
        };
        let clip = dir.join("clip.mkv");
        let tone = dir.join("tone.wav");
        let picture = dir.join("see through.png");
        make(&["-f", "lavfi", "-i", "testsrc2=s=321x241:d=2:r=25", "-f", "lavfi", "-i", "sine=d=2", "-c:v", "libx264", "-pix_fmt", "yuv444p", "-c:a", "aac", clip.to_str().unwrap()]);
        make(&["-f", "lavfi", "-i", "sine=f=220:d=2", tone.to_str().unwrap()]);
        make(&["-f", "lavfi", "-i", "color=c=red@0.5:s=301x201,format=rgba", "-frames:v", "1", picture.to_str().unwrap()]);

        let jobs = job::Jobs::default();
        let mut n = 0;
        for (source, kind) in [(&clip, "video"), (&tone, "audio"), (&picture, "image")] {
            let m = media::probe(&engine, source).unwrap();
            assert_eq!(m.kind, kind, "{}", m.name);
            assert!(media::thumbnail(&engine, &m).is_some() || kind == "audio");
            for id in formats::available(&engine.encoders) {
                let format = formats::get(id).unwrap();
                if !formats::accepts(format, kind) {
                    continue;
                }
                let options = formats::Options { max_height: if n % 2 == 0 { 120 } else { 0 }, ..Default::default() };
                let output = job::reserve(&jobs, &dir, source, format.ext);
                let args = formats::args(&m, format, &options, &job::part_path(&output), &engine.encoders).unwrap();
                n += 1;
                let outcome = job::run(&engine, &jobs, n, &args, &output, |_, _| {});
                job::release(&jobs, &output);
                let Ok(job::Outcome::Done(path, size)) = outcome else {
                    panic!("{} -> {id} failed: {:?}", m.name, outcome.err());
                };
                assert!(size > 0 && !job::part_path(&path).exists());
                let back = media::probe(&engine, &path).unwrap_or_else(|e| panic!("{} -> {id}: {e}", m.name));
                let expected = if id == "gif" { "video" } else { format.kind };
                assert_eq!(back.kind, expected, "{} -> {id}", m.name);
                if options.max_height > 0 && back.height > 0 && id != "ico" {
                    assert!(back.height <= 120, "{} -> {id} is {}px high", m.name, back.height);
                }
            }
        }
        assert!(n >= 15, "only {n} conversions ran");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn cancelling_removes_the_part_file() {
        let Some(engine) = engine::find() else { return };
        let dir = std::env::temp_dir().join(format!("xvert-cancel-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let output = dir.join("long.mp4");
        let args: Vec<String> = ["-hide_banner", "-nostdin", "-y", "-v", "error", "-re", "-f", "lavfi", "-i", "testsrc2=d=60", "-c:v", "libx264", "-progress", "pipe:1", "-nostats", "-stats_period", "0.5"]
            .iter()
            .map(|s| s.to_string())
            .chain([job::part_path(&output).display().to_string()])
            .collect();
        let jobs = Arc::new(job::Jobs::default());
        let canceller = jobs.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1500));
            canceller.cancel(7);
        });
        let started = Instant::now();
        let outcome = job::run(&engine, &jobs, 7, &args, &output, |_, _| {}).unwrap();
        assert!(matches!(outcome, job::Outcome::Cancelled));
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(!output.exists() && !job::part_path(&output).exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
