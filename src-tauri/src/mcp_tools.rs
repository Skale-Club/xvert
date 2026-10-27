//! What Xvert offers over MCP (`Xvert.exe --mcp`): FFmpeg's status, reading
//! media files and converting them. Converting only adds new files; the
//! originals are never changed.

use crate::mcp::{self, Tool};
use crate::{engine, formats, job, media};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;

const INSTRUCTIONS: &str = "Xvert converts video, audio and images with FFmpeg. engine_status says whether \
FFmpeg is there and which formats it can write; probe reads a file or folder (kind, duration, size, \
codecs); convert writes a converted copy beside the original or in out_dir, never overwriting anything. \
Video can become video, audio or GIF; audio becomes audio; images become images.";

type Shared = Rc<RefCell<Option<engine::Engine>>>;

/// FFmpeg, looked for once and again whenever it was missing.
fn current(engine: &Shared) -> Result<engine::Engine, String> {
    if engine.borrow().is_none() {
        *engine.borrow_mut() = engine::find();
    }
    engine.borrow().clone().ok_or_else(|| {
        "FFmpeg was not found. Open Xvert and download it on the Engine page, or put ffmpeg.exe and \
         ffprobe.exe beside Xvert.exe."
            .into()
    })
}

fn status(engine: &Shared) -> Value {
    *engine.borrow_mut() = engine::find();
    let found = engine.borrow().clone();
    let available = found.as_ref().map(|e| formats::available(&e.encoders)).unwrap_or_default();
    json!({ "engine": found, "formats": formats::FORMATS, "available": available })
}

fn convert(engine: &Shared, jobs: &job::Jobs, id: u32, args: &Value) -> Result<Value, String> {
    let engine = current(engine)?;
    let source = PathBuf::from(mcp::text(args, "path")?);
    if !source.is_file() {
        return Err(format!("{} is not a file.", source.display()));
    }
    let wanted = mcp::text(args, "format")?;
    let format = formats::get(&wanted).ok_or_else(|| format!("Unknown format {wanted}."))?;
    if !formats::available(&engine.encoders).contains(&format.id) {
        return Err(format!("This FFmpeg can't write {}.", format.id));
    }
    let media = media::probe(&engine, &source)?;
    if !formats::accepts(format, media.kind) {
        return Err(format!("A {} file can't become {}.", media.kind, format.id));
    }
    let dir = match mcp::optional_text(args, "out_dir") {
        Some(dir) => PathBuf::from(dir),
        None => source.parent().map(Path::to_path_buf).ok_or("No folder.")?,
    };
    if !dir.is_dir() {
        return Err(format!("{} is not a folder.", dir.display()));
    }
    let options = formats::Options {
        quality: mcp::optional_text(args, "quality").unwrap_or_else(|| "balanced".into()),
        max_height: mcp::number(args, "max_height", 0) as u32,
        mute: mcp::flag(args, "mute"),
    };
    let output = job::reserve(jobs, &dir, &source, format.ext);
    let ffmpeg_args = formats::args(&media, format, &options, &job::part_path(&output), &engine.encoders);
    let outcome = ffmpeg_args.and_then(|a| job::run(&engine, jobs, id, &a, &output, |_, _| {}));
    job::release(jobs, &output);
    match outcome? {
        job::Outcome::Done(path, size) => Ok(json!({ "path": path.display().to_string(), "size": size })),
        job::Outcome::Cancelled => Err("Cancelled.".into()),
    }
}

pub fn serve() {
    let engine: Shared = Rc::new(RefCell::new(None));
    let jobs = Rc::new(job::Jobs::default());
    let next_job = Rc::new(RefCell::new(0u32));
    let tools = vec![
        Tool::new(
            "engine_status",
            "Whether FFmpeg was found (path, version, where it is) and the formats: every format Xvert \
             knows, and the ids this FFmpeg can write.",
            mcp::no_input(),
            {
                let engine = engine.clone();
                move |_| Ok(status(&engine))
            },
        ),
        Tool::new(
            "probe",
            "Reads a media file, or the media files in a folder: kind (video, audio or image), size, \
             duration in seconds, width, height, fps, codecs, channels, sample rate, bit rate.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path of a file or folder." },
                    "limit": { "type": "integer", "description": "Most files to read from a folder (default 100)." },
                },
                "required": ["path"],
            }),
            {
                let engine = engine.clone();
                move |args| {
                    let engine = current(&engine)?;
                    let files = media::expand(&[mcp::text(args, "path")?], mcp::number(args, "limit", 100) as usize);
                    if files.is_empty() {
                        return Err("No media files there.".into());
                    }
                    Ok(json!(files
                        .iter()
                        .map(|path| match media::probe(&engine, path) {
                            Ok(media) => json!(media),
                            Err(error) => json!({ "path": path.display().to_string(), "error": error }),
                        })
                        .collect::<Vec<_>>()))
                }
            },
        ),
        Tool::new(
            "convert",
            "Converts one file and returns the new file's path and size. The output gets the original's \
             name with the new extension, plus \" (2)\" and so on if that name is taken.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path of the file to convert." },
                    "format": {
                        "type": "string",
                        "description": "Format id.",
                        "enum": formats::FORMATS.iter().map(|f| f.id).collect::<Vec<_>>(),
                    },
                    "quality": { "type": "string", "enum": ["high", "balanced", "small"], "description": "Default balanced; lossless formats ignore it." },
                    "max_height": { "type": "integer", "description": "Largest picture height in pixels, never upscaled; 0 keeps the original." },
                    "mute": { "type": "boolean", "description": "Leave the sound out of a video." },
                    "out_dir": { "type": "string", "description": "Folder for the new file; default beside the original." },
                },
                "required": ["path", "format"],
            }),
            move |args| {
                *next_job.borrow_mut() += 1;
                let id = *next_job.borrow();
                convert(&engine, &jobs, id, args)
            },
        )
        .changing(),
    ];
    mcp::serve("Xvert", "xvert.json", INSTRUCTIONS, tools);
}
