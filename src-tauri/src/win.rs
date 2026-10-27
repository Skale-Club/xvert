//! Windows bits: the file and folder pickers and showing a path in Explorer.

use std::ffi::c_void;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use std::ptr::null;

#[repr(C)]
struct BrowseInfo {
    owner: isize,
    root: *const c_void,
    display: *mut u16,
    title: *const u16,
    flags: u32,
    callback: isize,
    data: isize,
    image: i32,
}

#[link(name = "shell32")]
extern "system" {
    fn SHBrowseForFolderW(data: *mut BrowseInfo) -> *mut c_void;
    fn SHGetPathFromIDListEx(id: *const c_void, path: *mut u16, len: u32, flags: u32) -> i32;
}

#[link(name = "ole32")]
extern "system" {
    fn CoInitializeEx(reserved: *const c_void, flags: u32) -> i32;
    fn CoUninitialize();
    fn CoTaskMemFree(data: *const c_void);
}

fn text(buffer: &[u16]) -> String {
    String::from_utf16_lossy(&buffer[..buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len())])
}

#[repr(C)]
struct OpenFileName {
    size: u32,
    owner: isize,
    instance: isize,
    filter: *const u16,
    custom_filter: *mut u16,
    max_custom_filter: u32,
    filter_index: u32,
    file: *mut u16,
    max_file: u32,
    file_title: *mut u16,
    max_file_title: u32,
    initial_dir: *const u16,
    title: *const u16,
    flags: u32,
    file_offset: u16,
    file_extension: u16,
    default_ext: *const u16,
    custom_data: isize,
    hook: isize,
    template_name: *const u16,
    reserved_ptr: *mut c_void,
    reserved: u32,
    flags_ex: u32,
}

#[link(name = "comdlg32")]
extern "system" {
    fn GetOpenFileNameW(data: *mut OpenFileName) -> i32;
}

/// Splits the dialog's answer: one full path, or the folder followed by the
/// chosen names, each ending in a NUL and the list in two.
fn chosen(buffer: &[u16]) -> Vec<String> {
    let parts: Vec<String> = buffer
        .split(|c| *c == 0)
        .take_while(|part| !part.is_empty())
        .map(String::from_utf16_lossy)
        .collect();
    match parts.as_slice() {
        [] => Vec::new(),
        [one] => vec![one.clone()],
        [dir, names @ ..] => names.iter().map(|name| Path::new(dir).join(name).display().to_string()).collect(),
    }
}

/// The Open dialog with several files allowed; empty when the user cancels.
pub fn pick_files(owner: isize, media_label: &str, all_label: &str, patterns: &str) -> Vec<String> {
    let filter: Vec<u16> = format!("{media_label}\0{patterns}\0{all_label}\0*.*\0\0").encode_utf16().collect();
    let mut buffer = vec![0u16; 1 << 16];
    let mut data = OpenFileName {
        size: std::mem::size_of::<OpenFileName>() as u32,
        owner,
        instance: 0,
        filter: filter.as_ptr(),
        custom_filter: std::ptr::null_mut(),
        max_custom_filter: 0,
        filter_index: 1,
        file: buffer.as_mut_ptr(),
        max_file: buffer.len() as u32,
        file_title: std::ptr::null_mut(),
        max_file_title: 0,
        initial_dir: null(),
        title: null(),
        // explorer style, several files, must exist, keep the working folder
        flags: 0x0008_0000 | 0x200 | 0x1000 | 0x800 | 0x8,
        file_offset: 0,
        file_extension: 0,
        default_ext: null(),
        custom_data: 0,
        hook: 0,
        template_name: null(),
        reserved_ptr: std::ptr::null_mut(),
        reserved: 0,
        flags_ex: 0,
    };
    if unsafe { GetOpenFileNameW(&mut data) } == 0 {
        return Vec::new();
    }
    chosen(&buffer)
}

/// The classic folder dialog; None when the user cancels.
pub fn pick_folder(owner: isize) -> Result<Option<String>, String> {
    let initialized = unsafe { CoInitializeEx(null(), 2) };
    if initialized < 0 {
        return Err(format!("COM: {initialized}"));
    }
    let mut display = [0u16; 260];
    let mut data = BrowseInfo {
        owner,
        root: null(),
        display: display.as_mut_ptr(),
        title: null(),
        flags: 0x41, // folders only, new dialog style
        callback: 0,
        data: 0,
        image: 0,
    };
    let id = unsafe { SHBrowseForFolderW(&mut data) };
    let result = if id.is_null() {
        Ok(None)
    } else {
        let mut path = vec![0u16; 32768];
        let ok = unsafe { SHGetPathFromIDListEx(id, path.as_mut_ptr(), path.len() as u32, 0) };
        unsafe { CoTaskMemFree(id) };
        if ok == 0 { Err("This place is not a folder on disk.".into()) } else { Ok(Some(text(&path))) }
    };
    unsafe { CoUninitialize() };
    result
}

/// Opens Explorer with `path` selected (or, for a folder, opened).
pub fn reveal(path: &str, open: bool) -> Result<(), String> {
    let path = Path::new(path);
    // A quote can't be in a Windows name, and would break the argument.
    if !path.is_absolute() || path.to_string_lossy().contains('"') || !path.exists() {
        return Err("notFound".into());
    }
    let shown = path.to_string_lossy();
    let mut command = Command::new("explorer.exe");
    if open {
        command.raw_arg(format!("\"{shown}\""));
    } else {
        command.raw_arg(format!("/select,\"{shown}\""));
    }
    command.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn buffer(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    #[test]
    fn reads_the_open_dialog_answer() {
        assert_eq!(chosen(&buffer("C:\\in\\a.mp4\0\0")), vec![r"C:\in\a.mp4"]);
        assert_eq!(chosen(&buffer("C:\\in\0a.mp4\0b c.mov\0\0")), vec![r"C:\in\a.mp4", r"C:\in\b c.mov"]);
        assert!(chosen(&buffer("\0\0")).is_empty());
    }
}
