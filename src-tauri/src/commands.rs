use crate::cache::schema_cache;
use crate::db::Db;
use crate::excel;
use crate::models::ExcelSchema;
use crate::ocr;
use crate::services::excel_scanner;
use crate::types::{InvoiceData, RowCell, FailedScan, BatchScanResult};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io;
use std::path::Path;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize)]
pub struct ValidationResult {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct ExcelSchemaResponse {
    pub cached: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_json: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_bytes: Option<String>,
}

/// Schema from backend analysis (avoids loading full Excel into webview).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzedExcelSchema {
    pub worksheet_name: String,
    pub headers: Vec<String>,
    pub column_samples: Vec<Vec<String>>,
    pub last_data_row: u32,
    pub schema_hash: String,
}

pub struct AppState {
    pub db: Mutex<Option<Db>>,
}

#[derive(Deserialize)]
pub struct AppendRowPayload {
    pub path: String,
    pub sheet: String,
    pub row: Vec<RowCell>,
}

#[derive(Deserialize)]
pub struct SaveProfilePayload {
    pub id: Option<i64>,
    pub name: String,
    pub excel_path: String,
    pub sheet_name: String,
    pub column_mapping: Value,
}

#[derive(Deserialize)]
pub struct AddHistoryPayload {
    pub document_type: String,
    pub file_path_or_name: String,
    pub extracted_data: Value,
    pub status: String,
    pub excel_profile_id: Option<i64>,
    pub error_message: Option<String>,
    pub folder_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct GetHistoryPayload {
    pub search: Option<String>,
    pub folder_id: Option<i64>, // None = all, -1 = uncategorized
}

#[derive(Deserialize)]
pub struct UpdateHistoryPayload {
    pub id: i64,
    pub status: String,
    pub excel_profile_id: Option<i64>,
    pub error_message: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateHistoryRecordPayload {
    pub id: i64,
    pub document_type: String,
    pub file_path_or_name: String,
    pub extracted_data: Value,
    pub status: String,
    pub excel_profile_id: Option<i64>,
    pub error_message: Option<String>,
}

#[derive(Deserialize)]
pub struct GetLearnedMappingPayload {
    pub schema_hash: String,
    pub field_type: String,
}

#[derive(Deserialize)]
pub struct UpsertLearnedMappingPayload {
    pub schema_hash: String,
    pub field_type: String,
    pub column_index: i32,
    pub column_letter: String,
    pub action: String,
}

#[derive(Deserialize)]
pub struct GetColumnSamplesPayload {
    pub path: String,
    pub sheet: String,
    pub header_row: Option<u32>,
    pub max_rows: Option<usize>,
}

#[tauri::command]
pub fn get_app_data_path(app: AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    path.to_str()
        .map(String::from)
        .ok_or_else(|| "Invalid path".to_string())
}

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn get_azure_status() -> String {
    let _ = dotenvy::dotenv();
    match (
        std::env::var("AZURE_OCR_KEY"),
        std::env::var("AZURE_OCR_ENDPOINT"),
    ) {
        (Ok(k), Ok(e)) if !k.trim().is_empty() && !e.trim().is_empty() => "configured".to_string(),
        _ => "not_configured".to_string(),
    }
}

#[tauri::command]
pub fn open_app_data_folder(app: AppHandle) -> Result<(), String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    opener::open(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_ocr(file_path: String) -> Result<crate::types::OcrResult, String> {
    ocr::run_ocr(&file_path)
}

#[tauri::command]
pub async fn run_ocr_invoice(file_path: String, document_type: Option<String>) -> Result<crate::types::InvoiceData, String> {
    let path = file_path.clone();
    let doc_type = document_type.clone();
    tauri::async_runtime::spawn_blocking(move || ocr::run_ocr_invoice(&path, doc_type.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

/// Run OCR on up to 5 PDFs at a time; returns both successful and failed results.
#[tauri::command]
pub async fn batch_scan_invoices(pdf_paths: Vec<String>, document_type: Option<String>) -> Result<BatchScanResult, String> {
    const CONCURRENCY: usize = 5;
    let mut successes = Vec::new();
    let mut failures = Vec::new();
    let doc_type = document_type.clone();
    
    for chunk in pdf_paths.chunks(CONCURRENCY) {
        let chunk_paths: Vec<(String, String)> = chunk
            .iter()
            .map(|path| {
                let path = path.clone();
                let filename = Path::new(&path)
                    .file_name()
                    .and_then(|o| o.to_str())
                    .unwrap_or("")
                    .to_string();
                (path, filename)
            })
            .collect();
        
        let handles: Vec<_> = chunk_paths
            .iter()
            .map(|(path, _)| {
                let path = path.clone();
                let doc_type = doc_type.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    ocr::run_ocr_invoice(&path, doc_type.as_deref())
                })
            })
            .collect();
        
        for ((path, filename), h) in chunk_paths.into_iter().zip(handles) {
            match h.await {
                Ok(Ok(mut inv)) => {
                    inv.source_file = Some(filename.clone());
                    inv.source_file_path = Some(path.clone());
                    successes.push(inv);
                }
                Ok(Err(e)) => {
                    failures.push(FailedScan {
                        file_path: path,
                        file_name: filename,
                        error: e,
                    });
                }
                Err(e) => {
                    failures.push(FailedScan {
                        file_path: path,
                        file_name: filename,
                        error: format!("Task join error: {}", e),
                    });
                }
            }
        }
    }
    
    Ok(BatchScanResult { successes, failures })
}

#[tauri::command]
pub async fn export_invoices_to_excel(
    invoices: Vec<InvoiceData>,
    path: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        excel::export_invoices_to_excel(&invoices, path.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_invoices_to_new_excel(
    invoices: Vec<InvoiceData>,
    path: Option<String>,
    worksheet_name: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        excel::export_invoices_to_new_excel(&invoices, path.as_deref(), worksheet_name.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn append_invoices_to_existing_excel(
    excel_path: String,
    worksheet_name: String,
    header_row: u32,
    invoices: Vec<InvoiceData>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        excel::append_invoices_to_existing_excel(&excel_path, &worksheet_name, header_row, &invoices)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn validate_document_file(path: String) -> Result<ValidationResult, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Ok(ValidationResult {
            valid: false,
            error: Some("File not found.".to_string()),
        });
    }
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Ok(ValidationResult {
            valid: false,
            error: Some("File too large (max 50MB).".to_string()),
        });
    }
    let mut f = fs::File::open(path).map_err(|e| format!("Could not open: {}", e))?;
    let mut header = [0u8; 8];
    use std::io::Read;
    if f.read(&mut header).unwrap_or(0) < 5 {
        return Ok(ValidationResult {
            valid: false,
            error: Some("Not a valid PDF (could not read header).".to_string()),
        });
    }
    if !header.starts_with(b"%PDF-") {
        return Ok(ValidationResult {
            valid: false,
            error: Some("Not a valid PDF file.".to_string()),
        });
    }
    Ok(ValidationResult {
        valid: true,
        error: None,
    })
}

#[tauri::command]
pub fn validate_excel_file(path: String) -> Result<ValidationResult, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Ok(ValidationResult {
            valid: false,
            error: Some("File not found.".to_string()),
        });
    }
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > 100 * 1024 * 1024 {
        return Ok(ValidationResult {
            valid: false,
            error: Some("File too large (max 100MB).".to_string()),
        });
    }
    let mut f = fs::File::open(path).map_err(|e| format!("Could not open: {}", e))?;
    let mut header = [0u8; 4];
    use std::io::Read;
    if f.read(&mut header).unwrap_or(0) < 4 {
        return Ok(ValidationResult {
            valid: false,
            error: Some("Not a valid Excel file (could not read header).".to_string()),
        });
    }
    if header != [0x50, 0x4B, 0x03, 0x04] {
        return Ok(ValidationResult {
            valid: false,
            error: Some("Not a valid Excel file (.xlsx).".to_string()),
        });
    }
    match fs::OpenOptions::new().write(true).open(path) {
        Ok(_) => Ok(ValidationResult {
            valid: true,
            error: None,
        }),
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => Ok(ValidationResult {
            valid: false,
            error: Some("Excel file is open. Please close it and try again.".to_string()),
        }),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(Path::new(&path)).map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound {
            "File not found.".to_string()
        } else {
            format!("Could not read file: {}", e)
        }
    })?;
    Ok(BASE64.encode(&bytes))
}

#[tauri::command]
pub fn write_file_base64(path: String, base64_content: String) -> Result<(), String> {
    let bytes = BASE64.decode(&base64_content).map_err(|e| format!("Invalid base64: {}", e))?;
    fs::write(Path::new(&path), &bytes).map_err(|e| format!("Could not write file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn copy_file(src: String, dest: String) -> Result<(), String> {
    fs::copy(Path::new(&src), Path::new(&dest)).map_err(|e| format!("Could not copy file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(Path::new(&path)).map_err(|e| format!("Could not delete file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn get_excel_schema(state: State<AppState>, path: String) -> Result<ExcelSchemaResponse, String> {
    let metadata = fs::metadata(Path::new(&path)).map_err(|e| format!("File not found: {}", e))?;
    let mtime = metadata
        .modified()
        .map_err(|e| format!("Cannot get mtime: {}", e))?;
    let mtime_ms = mtime
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let cache_key = format!("{}:{}", path, mtime_ms);

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    if let Some(schema_json) = db.get_cached_schema(&cache_key)? {
        return Ok(ExcelSchemaResponse {
            cached: true,
            schema_json: Some(schema_json),
            file_bytes: None,
        });
    }

    // Do not send file_bytes: frontend will use analyze_excel_schema instead to avoid OOM.
    Ok(ExcelSchemaResponse {
        cached: false,
        schema_json: None,
        file_bytes: None,
    })
}

/// Scan Excel file and return full schema (headers, formats, next_free_row). Uses edit-xlsx for format reading.
#[tauri::command]
pub async fn scan_excel_schema(
    excel_path: String,
    worksheet_name: String,
) -> Result<ExcelSchema, String> {
    let path = excel_path.clone();
    let sheet = worksheet_name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::path::Path::new(&path);
        let (header_row, headers, last_data_row, next_free_row, total_rows, columns, row_template, file_size, file_mtime) =
            excel_scanner::scan_excel_file(path, &sheet)?;
        let total_columns = headers.len() as u16;
        Ok(ExcelSchema {
            header_row,
            first_data_row: header_row + 1,
            last_data_row,
            next_free_row,
            total_rows,
            total_columns,
            headers,
            columns,
            row_template,
            file_size,
            file_mtime,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Save scanned schema to database for the given profile (call after scan when creating/editing profile).
#[tauri::command]
pub fn save_excel_schema(
    state: State<AppState>,
    profile_id: i64,
    schema: ExcelSchema,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.save_excel_schema(profile_id, &schema)?;
    schema_cache::set_cached_schema(profile_id, schema);
    Ok(())
}

/// Get excel schema for a profile from cache or database. Validates cache with file mtime.
#[tauri::command]
pub fn get_excel_schema_for_profile(
    state: State<'_, AppState>,
    profile_id: i64,
    force_refresh: bool,
) -> Result<ExcelSchema, String> {
    if !force_refresh {
        if let Some(cached) = schema_cache::get_cached_schema(profile_id) {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let db = db.as_ref().ok_or("Database not initialized")?;
            if is_cache_valid(db, profile_id, &cached)? {
                return Ok(cached);
            }
            schema_cache::invalidate_cache(profile_id);
        }
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    let schema = db.load_excel_schema(profile_id)?;
    schema_cache::set_cached_schema(profile_id, schema.clone());
    Ok(schema)
}

fn is_cache_valid(db: &Db, profile_id: i64, cached: &ExcelSchema) -> Result<bool, String> {
    let (excel_path, _, _) = db.get_profile_by_id(profile_id)?;
    if !Path::new(&excel_path).exists() {
        return Ok(false);
    }
    let metadata = fs::metadata(&excel_path).map_err(|e| e.to_string())?;
    let current_mtime = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Ok(current_mtime == cached.file_mtime)
}

/// Fast append: use cached schema (next_free_row), write row, update cache and DB.
#[tauri::command]
pub async fn append_to_excel_fast(
    state: State<'_, AppState>,
    profile_id: i64,
    invoice_data: InvoiceData,
) -> Result<i64, String> {
    let schema = {
        if let Some(cached) = schema_cache::get_cached_schema(profile_id) {
            let db = state.db.lock().map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
            let db = db.as_ref().ok_or("Database not initialized")?;
            if is_cache_valid(db, profile_id, &cached)? {
                cached
            } else {
                schema_cache::invalidate_cache(profile_id);
                let db = state.db.lock().map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
                let db = db.as_ref().ok_or("Database not initialized")?;
                let s = db.load_excel_schema(profile_id)?;
                schema_cache::set_cached_schema(profile_id, s.clone());
                s
            }
        } else {
            let db = state.db.lock().map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
            let db = db.as_ref().ok_or("Database not initialized")?;
            let s = db.load_excel_schema(profile_id)?;
            schema_cache::set_cached_schema(profile_id, s.clone());
            s
        }
    };

    let (excel_path, sheet_name, column_mapping_json): (String, String, String) = {
        let db = state.db.lock().map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.get_profile_by_id(profile_id)?
    };

    let column_mapping: std::collections::HashMap<String, String> =
        serde_json::from_str(&column_mapping_json).unwrap_or_default();

    let row_number = schema.next_free_row;
    let mut column_values = Vec::new();
    for (idx, h) in schema.headers.iter().enumerate() {
        let value = if idx == 0 {
            invoice_data
                .fields
                .get("document_type")
                .map(|v| v.value.clone())
                .unwrap_or_else(|| "Фактура".to_string())
        } else {
            let field_key = column_mapping
                .get(&h.column_letter)
                .or_else(|| column_mapping.get(&h.column_letter.to_uppercase()))
                .map(String::from)
                .unwrap_or_else(|| format!("col_{}", h.column_letter));
            invoice_data
                .fields
                .get(&field_key)
                .map(|v| v.value.clone())
                .unwrap_or_default()
        };
        column_values.push((h.column_letter.clone(), value));
    }

    let path = excel_path.clone();
    let sheet = sheet_name.clone();
    let row_num = row_number;
    let values = column_values;
    tauri::async_runtime::spawn_blocking(move || {
        excel::append_row_to_excel_at_row(&path, &sheet, row_num, values)
    })
    .await
    .map_err(|e| e.to_string())??;

    let new_next = row_number + 1;
    {
        let db = state.db.lock().map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
        let db = db.as_ref().ok_or("Database not initialized")?;
        db.update_excel_schema_next_free_row(profile_id, new_next, row_number)?;
    }

    if let Some(mut cached) = schema_cache::get_cached_schema(profile_id) {
        cached.next_free_row = new_next;
        cached.last_data_row = row_number;
        schema_cache::set_cached_schema(profile_id, cached);
    }

    Ok(row_number as i64)
}

#[tauri::command]
pub async fn analyze_excel_schema(
    path: String,
    sheet_name: String,
    header_row: u32,
) -> Result<AnalyzedExcelSchema, String> {
    let path = path.clone();
    let sheet_name = sheet_name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        excel::analyze_excel_schema(&path, &sheet_name, header_row)
    })
    .await
    .map_err(|e| e.to_string())?
    .map(|(worksheet_name, headers, column_samples, last_data_row, schema_hash)| {
        AnalyzedExcelSchema {
            worksheet_name,
            headers,
            column_samples,
            last_data_row,
            schema_hash,
        }
    })
}

#[tauri::command]
pub fn cache_excel_schema(
    state: State<AppState>,
    path: String,
    schema_json: String,
    schema_hash: String,
    worksheet_name: String,
) -> Result<(), String> {
    let metadata = fs::metadata(Path::new(&path)).map_err(|e| format!("File not found: {}", e))?;
    let mtime = metadata
        .modified()
        .map_err(|e| format!("Cannot get mtime: {}", e))?;
    let mtime_ms = mtime
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let cache_key = format!("{}:{}", path, mtime_ms);
    let last_modified = mtime_ms.to_string();

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.upsert_schema_cache(
        &cache_key,
        &path,
        &schema_hash,
        &worksheet_name,
        &schema_json,
        &last_modified,
    )
}

/// Read Excel headers on a background thread so the UI stays responsive (avoids "Not Responding" on large or Cyrillic paths).
#[tauri::command]
pub async fn read_excel_headers(path: String, sheet: String, header_row: Option<u32>) -> Result<Vec<String>, String> {
    let path = path.clone();
    let sheet = sheet.clone();
    tauri::async_runtime::spawn_blocking(move || excel::read_excel_headers(&path, &sheet, header_row))
        .await
        .map_err(|e| e.to_string())?
}

/// Get Excel headers with column letter and index for visual mapping UI. Reads from local filesystem only.
#[tauri::command]
pub async fn get_excel_headers(
    excel_path: String,
    worksheet_name: String,
    header_row: i32,
) -> Result<Vec<excel::ExcelHeader>, String> {
    let path = excel_path.clone();
    let sheet = worksheet_name.clone();
    let row = header_row.max(1) as u32;
    tauri::async_runtime::spawn_blocking(move || excel::get_excel_headers(&path, &sheet, row))
        .await
        .map_err(|e| e.to_string())?
}

/// Read sheet names on a background thread so the UI stays responsive.
#[tauri::command]
pub async fn get_sheet_names(path: String) -> Result<Vec<String>, String> {
    let path = path.clone();
    tauri::async_runtime::spawn_blocking(move || excel::get_sheet_names(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Append row on a background thread so the UI stays responsive.
#[tauri::command]
pub async fn append_row_to_excel(payload: AppendRowPayload) -> Result<(), String> {
    let path = payload.path.clone();
    let sheet = payload.sheet.clone();
    let row: Vec<(String, String)> = payload
        .row
        .into_iter()
        .map(|c| (c.column, c.value))
        .collect();
    tauri::async_runtime::spawn_blocking(move || excel::append_row_to_excel(&path, &sheet, row))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_profiles(state: State<AppState>) -> Result<Vec<(i64, String, String, String, String)>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.get_profiles()
}

#[tauri::command]
pub fn save_profile(state: State<AppState>, payload: SaveProfilePayload) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.save_profile(
        payload.id,
        &payload.name,
        &payload.excel_path,
        &payload.sheet_name,
        &payload.column_mapping,
    )
}

#[tauri::command]
pub fn delete_profile(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.delete_profile(id)
}

#[tauri::command]
pub fn get_history(
    state: State<AppState>,
    payload: Option<GetHistoryPayload>,
) -> Result<Vec<(i64, String, String, String, String, String, Option<i64>, Option<String>)>, String>
{
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    let search = payload.as_ref().and_then(|p| p.search.clone());
    let folder_id = payload.as_ref().and_then(|p| p.folder_id);
    db.get_history(search.as_deref(), folder_id)
}

#[tauri::command]
pub fn create_folder(state: State<AppState>, name: String) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.create_folder(&name)
}

#[tauri::command]
pub fn get_folders(state: State<AppState>) -> Result<Vec<(i64, String, String)>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.get_folders()
}

#[tauri::command]
pub fn delete_folder(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.delete_folder(id)
}

#[tauri::command]
pub fn assign_history_to_folder(state: State<AppState>, history_id: i64, folder_id: Option<i64>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.assign_history_to_folder(history_id, folder_id)
}

#[tauri::command]
pub fn get_history_by_id(
    state: State<AppState>,
    id: i64,
) -> Result<Option<(String, String, String, String, Option<i64>)>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.get_history_by_id(id)
}

#[tauri::command]
pub fn add_history_record(state: State<AppState>, payload: AddHistoryPayload) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.add_history_record(
        &payload.document_type,
        &payload.file_path_or_name,
        &payload.extracted_data,
        &payload.status,
        payload.excel_profile_id,
        payload.error_message.as_deref(),
        payload.folder_id,
    )
}

#[tauri::command]
pub fn get_learned_mapping(
    state: State<AppState>,
    payload: GetLearnedMappingPayload,
) -> Result<Option<(String, f64)>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.get_learned_mapping(&payload.schema_hash, &payload.field_type)
}

#[tauri::command]
pub fn upsert_learned_mapping(
    state: State<AppState>,
    payload: UpsertLearnedMappingPayload,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.upsert_learned_mapping(
        &payload.schema_hash,
        &payload.field_type,
        payload.column_index,
        &payload.column_letter,
        &payload.action,
    )
}

#[tauri::command]
pub async fn get_column_samples(payload: GetColumnSamplesPayload) -> Result<Vec<Vec<String>>, String> {
    let path = payload.path.clone();
    let sheet = payload.sheet.clone();
    let header_row = payload.header_row;
    let max_rows = payload.max_rows.unwrap_or(10);
    tauri::async_runtime::spawn_blocking(move || {
        excel::read_excel_column_samples(&path, &sheet, header_row, max_rows)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn update_history_status(state: State<AppState>, payload: UpdateHistoryPayload) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.update_history_status(
        payload.id,
        &payload.status,
        payload.excel_profile_id,
        payload.error_message.as_deref(),
    )
}

#[tauri::command]
pub fn update_history_record(
    state: State<AppState>,
    payload: UpdateHistoryRecordPayload,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.update_history_record(
        payload.id,
        &payload.document_type,
        &payload.file_path_or_name,
        &payload.extracted_data,
        &payload.status,
        payload.excel_profile_id,
        payload.error_message.as_deref(),
    )
}

#[tauri::command]
pub fn clear_learned_mappings(state: State<AppState>) -> Result<u64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.clear_learned_mappings()
}

#[tauri::command]
pub fn delete_history_record(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;
    db.delete_history_record(id)
}
