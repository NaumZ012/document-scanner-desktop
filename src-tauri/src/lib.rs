mod cache;
mod commands;
mod db;
mod excel;
mod models;
mod ocr;
mod services;
mod types;

use commands::AppState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            // Load .env from app data dir so production users can place credentials there (Settings → Open app data folder)
            let env_path = app_data_dir.join(".env");
            if env_path.exists() {
                let _ = dotenvy::from_path(&env_path);
            }
            let db_path = app_data_dir.join("invoice_scanner.db");
            let db = db::Db::new(db_path)?;
            app.manage(AppState {
                db: Mutex::new(Some(db)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_data_path,
            commands::open_app_data_folder,
            commands::get_app_version,
            commands::get_azure_status,
            commands::clear_learned_mappings,
            commands::run_ocr,
            commands::run_ocr_invoice,
            commands::batch_scan_invoices,
            commands::export_invoices_to_excel,
            commands::export_invoices_to_new_excel,
            commands::append_invoices_to_existing_excel,
            commands::validate_document_file,
            commands::validate_excel_file,
            commands::read_file_base64,
            commands::write_file_base64,
            commands::copy_file,
            commands::delete_file,
            commands::get_excel_schema,
            commands::scan_excel_schema,
            commands::save_excel_schema,
            commands::get_excel_schema_for_profile,
            commands::append_to_excel_fast,
            commands::analyze_excel_schema,
            commands::cache_excel_schema,
            commands::read_excel_headers,
            commands::get_excel_headers,
            commands::get_sheet_names,
            commands::get_column_samples,
            commands::append_row_to_excel,
            commands::get_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::get_history,
            commands::get_history_by_id,
            commands::create_folder,
            commands::get_folders,
            commands::delete_folder,
            commands::assign_history_to_folder,
            commands::add_history_record,
            commands::update_history_status,
            commands::update_history_record,
            commands::delete_history_record,
            commands::get_learned_mapping,
            commands::upsert_learned_mapping,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
