//! Dump Excel file structure to JSON so the AI and app can understand template layout.
//!
//! Single file:
//!   cargo run --bin dump_excel -- "path/to/file.xlsx"
//!   cargo run --bin dump_excel -- "path/to/file.xlsx" output.json
//!   cargo run --bin dump_excel -- "path/to/file.xlsx" output.json 40
//!
//! All example templates (from project root):
//!   npm run excel:dump
//!   or: cd src-tauri && cargo run --bin dump_excel -- --all

use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 2 && args[1] == "--all" {
        dump_all_example_templates();
        return;
    }
    let path = args.get(1).expect("Usage: dump_excel <path-to-xlsx> [output.json] [max_rows]");
    let out_path = args
        .get(2)
        .map(String::as_str)
        .unwrap_or("excel-dump.json");
    let max_rows: usize = args
        .get(3)
        .and_then(|s| s.parse().ok())
        .unwrap_or(50);
    let json = invoice_scanner_lib::excel::dump_excel_structure(path, max_rows).expect("dump failed");
    fs::write(out_path, &json).expect("write failed");
    println!("Wrote {} ({} bytes)", out_path, json.len());
}

fn visit_xlsx(dir: &Path, files: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                visit_xlsx(&path, files);
            } else if path.extension().map_or(false, |e| e == "xlsx") {
                files.push(path);
            }
        }
    }
}

fn dump_all_example_templates() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let project_root = Path::new(&manifest_dir).parent().unwrap_or(Path::new("."));
    let example_dir = project_root.join("example");
    let out_dir = project_root.join("excel-structures");
    if !example_dir.exists() {
        eprintln!("Example dir not found: {}", example_dir.display());
        std::process::exit(1);
    }
    fs::create_dir_all(&out_dir).expect("create excel-structures");
    let mut xlsx_files = Vec::new();
    visit_xlsx(&example_dir, &mut xlsx_files);
    let mut count = 0;
    for path in xlsx_files {
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("sheet")
            .to_string();
        let safe: String = name
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect();
        let out_path = out_dir.join(format!("{}.json", safe));
        if let Ok(json) = invoice_scanner_lib::excel::dump_excel_structure(path.to_str().unwrap(), 50) {
            fs::write(&out_path, &json).expect("write");
            println!("{} -> {}", path.display(), out_path.display());
            count += 1;
        } else {
            eprintln!("Skip {} (open failed)", path.display());
        }
    }
    println!("Dumped {} files to {}", count, out_dir.display());
}
