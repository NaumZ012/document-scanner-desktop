use crate::models::ExcelSchema;
use rusqlite::{params, Connection};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn new(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO schema_version (version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version LIMIT 1);
            CREATE TABLE IF NOT EXISTS profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                excel_path TEXT NOT NULL,
                sheet_name TEXT NOT NULL,
                column_mapping TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                document_type TEXT NOT NULL,
                file_path_or_name TEXT NOT NULL,
                extracted_data TEXT NOT NULL,
                status TEXT NOT NULL,
                excel_profile_id INTEGER,
                error_message TEXT,
                FOREIGN KEY (excel_profile_id) REFERENCES profiles(id)
            );
            CREATE TABLE IF NOT EXISTS learned_mappings (
                schema_hash TEXT NOT NULL,
                field_type TEXT NOT NULL,
                column_index INTEGER NOT NULL,
                column_letter TEXT NOT NULL,
                confidence REAL NOT NULL,
                usage_count INTEGER DEFAULT 1,
                last_used TEXT NOT NULL,
                PRIMARY KEY (schema_hash, field_type)
            );
            ",
        )
        .map_err(|e| e.to_string())?;

        // Normalize schema_version to a single row (fixes DBs that had two rows from old INSERT OR IGNORE)
        let _ = conn.execute(
            "DELETE FROM schema_version WHERE version < (SELECT MAX(version) FROM schema_version)",
            [],
        );

        // Migration 002: profile-centric excel schema cache (run once when version < 2)
        let current_version: i64 = conn
            .query_row("SELECT version FROM schema_version LIMIT 1", [], |r| r.get(0))
            .unwrap_or(1);
        if current_version < 2 {
            conn.execute_batch(
                "
                DROP TABLE IF EXISTS excel_schemas;
                CREATE TABLE excel_schemas (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    profile_id INTEGER NOT NULL UNIQUE,
                    header_row INTEGER NOT NULL,
                    first_data_row INTEGER NOT NULL,
                    last_data_row INTEGER NOT NULL,
                    next_free_row INTEGER NOT NULL,
                    total_rows INTEGER,
                    total_columns INTEGER,
                    headers_json TEXT NOT NULL,
                    file_size INTEGER,
                    file_mtime INTEGER,
                    scanned_at TEXT NOT NULL,
                    is_valid INTEGER DEFAULT 1,
                    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS column_formats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    profile_id INTEGER NOT NULL,
                    column_index INTEGER NOT NULL,
                    column_letter TEXT NOT NULL,
                    header_text TEXT,
                    font_name TEXT DEFAULT 'Arial',
                    font_size INTEGER DEFAULT 11,
                    font_color TEXT DEFAULT '#000000',
                    font_bold INTEGER DEFAULT 0,
                    font_italic INTEGER DEFAULT 0,
                    background_color TEXT DEFAULT '#FFFFFF',
                    background_color_alt TEXT,
                    border_style TEXT DEFAULT 'thin',
                    border_color TEXT DEFAULT '#000000',
                    alignment TEXT DEFAULT 'left',
                    data_type TEXT DEFAULT 'text',
                    number_format TEXT,
                    column_width REAL,
                    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
                    UNIQUE(profile_id, column_index)
                );
                CREATE TABLE IF NOT EXISTS row_templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    profile_id INTEGER NOT NULL UNIQUE,
                    template_row_index INTEGER,
                    row_height REAL DEFAULT 15.0,
                    use_alternating_colors INTEGER DEFAULT 0,
                    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS cache_changes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    profile_id INTEGER NOT NULL,
                    changed_at TEXT NOT NULL,
                    reason TEXT,
                    old_next_free_row INTEGER,
                    new_next_free_row INTEGER,
                    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_excel_schemas_profile ON excel_schemas(profile_id);
                CREATE INDEX IF NOT EXISTS idx_column_formats_profile ON column_formats(profile_id);
                CREATE INDEX IF NOT EXISTS idx_cache_changes_profile ON cache_changes(profile_id);
                ",
            )
            .map_err(|e| e.to_string())?;
            for alter_sql in &[
                "ALTER TABLE profiles ADD COLUMN file_size INTEGER",
                "ALTER TABLE profiles ADD COLUMN file_mtime INTEGER",
                "ALTER TABLE profiles ADD COLUMN last_scanned_at TEXT",
            ] {
                if let Err(e) = conn.execute(alter_sql, []) {
                    if !e.to_string().contains("duplicate column") {
                        return Err(e.to_string());
                    }
                }
            }
            conn.execute("UPDATE schema_version SET version = 2", [])
                .map_err(|e| e.to_string())?;
        }

        // Migration 003: folders table and folder_id on history (run once when version < 3)
        let current_version: i64 = conn
            .query_row("SELECT version FROM schema_version LIMIT 1", [], |r| r.get(0))
            .unwrap_or(1);
        if current_version < 3 {
            conn.execute(
                "CREATE TABLE IF NOT EXISTS folders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )",
                [],
            )
            .map_err(|e| e.to_string())?;
            if let Err(e) = conn.execute("ALTER TABLE history ADD COLUMN folder_id INTEGER REFERENCES folders(id)", []) {
                if !e.to_string().contains("duplicate column") {
                    return Err(e.to_string());
                }
            }
            conn.execute("UPDATE schema_version SET version = 3", [])
                .map_err(|e| e.to_string())?;
        }

        Ok(Db {
            conn: Mutex::new(conn),
        })
    }

    /// Path-based schema cache removed in migration 003; returns None so frontend falls back to analyze_excel_schema.
    pub fn get_cached_schema(&self, _cache_key: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    /// Path-based schema cache removed in migration 003; no-op for backward compatibility.
    pub fn upsert_schema_cache(
        &self,
        _cache_key: &str,
        _file_path: &str,
        _schema_hash: &str,
        _worksheet_name: &str,
        _schema_json: &str,
        _last_modified: &str,
    ) -> Result<(), String> {
        Ok(())
    }

    /// Get profile by id (excel_path, sheet_name, column_mapping).
    pub fn get_profile_by_id(
        &self,
        id: i64,
    ) -> Result<(String, String, String), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let (excel_path, sheet_name, column_mapping): (String, String, String) = conn
            .query_row(
                "SELECT excel_path, sheet_name, column_mapping FROM profiles WHERE id = ?",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|e| format!("Profile not found: {}", e))?;
        Ok((excel_path, sheet_name, column_mapping))
    }

    /// Save full excel schema for a profile (replaces existing).
    pub fn save_excel_schema(&self, profile_id: i64, schema: &ExcelSchema) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let headers_json =
            serde_json::to_string(&schema.headers).map_err(|e| format!("Serialize headers: {}", e))?;
        conn.execute(
            "INSERT OR REPLACE INTO excel_schemas
             (profile_id, header_row, first_data_row, last_data_row, next_free_row,
              total_rows, total_columns, headers_json, file_size, file_mtime, scanned_at, is_valid)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'), 1)",
            params![
                profile_id,
                schema.header_row as i64,
                schema.first_data_row as i64,
                schema.last_data_row as i64,
                schema.next_free_row as i64,
                schema.total_rows as i64,
                schema.total_columns as i64,
                headers_json,
                schema.file_size as i64,
                schema.file_mtime as i64,
            ],
        )
        .map_err(|e| format!("Failed to save excel_schemas: {}", e))?;

        conn.execute("DELETE FROM column_formats WHERE profile_id = ?1", params![profile_id])
            .map_err(|e| format!("Failed to delete old column_formats: {}", e))?;

        for col in &schema.columns {
            conn.execute(
                "INSERT INTO column_formats
                 (profile_id, column_index, column_letter, header_text,
                  font_name, font_size, font_color, font_bold, font_italic,
                  background_color, background_color_alt,
                  border_style, border_color, alignment,
                  data_type, number_format, column_width)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                params![
                    profile_id,
                    col.column_index as i64,
                    &col.column_letter,
                    &col.header_text,
                    &col.font_name,
                    col.font_size as i64,
                    &col.font_color,
                    col.font_bold as i32,
                    col.font_italic as i32,
                    &col.background_color,
                    col.background_color_alt,
                    &col.border_style,
                    &col.border_color,
                    &col.alignment,
                    &col.data_type,
                    col.number_format,
                    col.column_width,
                ],
            )
            .map_err(|e| format!("Failed to save column_format: {}", e))?;
        }

        conn.execute(
            "INSERT OR REPLACE INTO row_templates
             (profile_id, template_row_index, row_height, use_alternating_colors)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                profile_id,
                schema.row_template.template_row_index as i64,
                schema.row_template.row_height,
                schema.row_template.use_alternating_colors as i32,
            ],
        )
        .map_err(|e| format!("Failed to save row_template: {}", e))?;

        conn.execute(
            "UPDATE profiles SET file_size = ?1, file_mtime = ?2, last_scanned_at = datetime('now') WHERE id = ?3",
            params![schema.file_size as i64, schema.file_mtime as i64, profile_id],
        )
        .map_err(|e| format!("Failed to update profile: {}", e))?;

        Ok(())
    }

    /// Load excel schema for a profile.
    pub fn load_excel_schema(&self, profile_id: i64) -> Result<ExcelSchema, String> {
        use crate::models::{ColumnFormat, HeaderInfo, RowTemplate};

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let (
            header_row,
            first_data_row,
            last_data_row,
            next_free_row,
            total_rows,
            total_columns,
            headers_json,
            file_size,
            file_mtime,
        ): (i64, i64, i64, i64, i64, i64, String, i64, i64) = conn
            .query_row(
                "SELECT header_row, first_data_row, last_data_row, next_free_row,
                        total_rows, total_columns, headers_json, file_size, file_mtime
                 FROM excel_schemas WHERE profile_id = ?1 AND is_valid = 1",
                params![profile_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                    ))
                },
            )
            .map_err(|e| format!("Schema not found for profile {}: {}", profile_id, e))?;

        let headers: Vec<HeaderInfo> =
            serde_json::from_str(&headers_json).map_err(|e| format!("Parse headers_json: {}", e))?;

        let mut stmt = conn
            .prepare(
                "SELECT column_index, column_letter, header_text,
                        font_name, font_size, font_color, font_bold, font_italic,
                        background_color, background_color_alt,
                        border_style, border_color, alignment,
                        data_type, number_format, column_width
                 FROM column_formats WHERE profile_id = ?1 ORDER BY column_index",
            )
            .map_err(|e| e.to_string())?;

        let columns: Vec<ColumnFormat> = stmt
            .query_map(params![profile_id], |row| {
                Ok(ColumnFormat {
                    column_index: row.get::<_, i64>(0)? as u16,
                    column_letter: row.get(1)?,
                    header_text: row.get(2)?,
                    font_name: row.get(3)?,
                    font_size: row.get::<_, i64>(4)? as u16,
                    font_color: row.get(5)?,
                    font_bold: row.get::<_, i64>(6)? != 0,
                    font_italic: row.get::<_, i64>(7)? != 0,
                    background_color: row.get(8)?,
                    background_color_alt: row.get(9)?,
                    border_style: row.get(10)?,
                    border_color: row.get(11)?,
                    alignment: row.get(12)?,
                    data_type: row.get(13)?,
                    number_format: row.get(14)?,
                    column_width: row.get(15)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let row_template: RowTemplate = conn
            .query_row(
                "SELECT template_row_index, row_height, use_alternating_colors
                 FROM row_templates WHERE profile_id = ?1",
                params![profile_id],
                |row| {
                    Ok(RowTemplate {
                        template_row_index: row.get::<_, i64>(0)? as u32,
                        row_height: row.get(1)?,
                        use_alternating_colors: row.get::<_, i64>(2)? != 0,
                    })
                },
            )
            .map_err(|e| format!("row_template not found: {}", e))?;

        Ok(ExcelSchema {
            header_row: header_row as u32,
            first_data_row: first_data_row as u32,
            last_data_row: last_data_row as u32,
            next_free_row: next_free_row as u32,
            total_rows: total_rows as u32,
            total_columns: total_columns as u16,
            headers,
            columns,
            row_template,
            file_size: file_size as u64,
            file_mtime: file_mtime as u64,
        })
    }

    /// Update next_free_row and last_data_row after appending a row; log to cache_changes.
    pub fn update_excel_schema_next_free_row(
        &self,
        profile_id: i64,
        new_next_free_row: u32,
        old_next_free_row: u32,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE excel_schemas SET next_free_row = ?1, last_data_row = ?2 WHERE profile_id = ?3",
            params![new_next_free_row as i64, (new_next_free_row - 1) as i64, profile_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO cache_changes (profile_id, changed_at, reason, old_next_free_row, new_next_free_row)
             VALUES (?1, datetime('now'), 'row_added', ?2, ?3)",
            params![profile_id, old_next_free_row as i64, new_next_free_row as i64],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_profiles(&self) -> Result<Vec<(i64, String, String, String, String)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, excel_path, sheet_name, column_mapping FROM profiles ORDER BY name",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn save_profile(
        &self,
        id: Option<i64>,
        name: &str,
        excel_path: &str,
        sheet_name: &str,
        column_mapping: &Value,
    ) -> Result<i64, String> {
        let mapping_str = serde_json::to_string(column_mapping).map_err(|e| e.to_string())?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        if let Some(id) = id {
            conn.execute(
                "UPDATE profiles SET name = ?, excel_path = ?, sheet_name = ?, column_mapping = ? WHERE id = ?",
                params![name, excel_path, sheet_name, mapping_str, id],
            )
            .map_err(|e| e.to_string())?;
            Ok(id)
        } else {
            conn.execute(
                "INSERT INTO profiles (name, excel_path, sheet_name, column_mapping) VALUES (?, ?, ?, ?)",
                params![name, excel_path, sheet_name, mapping_str],
            )
            .map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        }
    }

    pub fn delete_profile(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM profiles WHERE id = ?", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_history_record(
        &self,
        document_type: &str,
        file_path_or_name: &str,
        extracted_data: &Value,
        status: &str,
        excel_profile_id: Option<i64>,
        error_message: Option<&str>,
        folder_id: Option<i64>,
    ) -> Result<i64, String> {
        let created_at = chrono::Utc::now().to_rfc3339();
        let data_str = serde_json::to_string(extracted_data).map_err(|e| e.to_string())?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO history (created_at, document_type, file_path_or_name, extracted_data, status, excel_profile_id, error_message, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                created_at,
                document_type,
                file_path_or_name,
                data_str,
                status,
                excel_profile_id,
                error_message,
                folder_id
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn create_folder(&self, name: &str) -> Result<i64, String> {
        let created_at = chrono::Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO folders (name, created_at) VALUES (?, ?)",
            params![name.trim(), created_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_folders(&self) -> Result<Vec<(i64, String, String)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, created_at FROM folders ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn delete_folder(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("UPDATE history SET folder_id = NULL WHERE folder_id = ?", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM folders WHERE id = ?", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn assign_history_to_folder(&self, history_id: i64, folder_id: Option<i64>) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("UPDATE history SET folder_id = ? WHERE id = ?", params![folder_id, history_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_history(
        &self,
        search: Option<&str>,
        folder_id: Option<i64>,
    ) -> Result<
        Vec<(i64, String, String, String, String, String, Option<i64>, Option<String>)>,
        String,
    >
    {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let base = "SELECT id, created_at, document_type, file_path_or_name, extracted_data, status, excel_profile_id, error_message FROM history";
        // folder_id: None = all, Some(-1) = uncategorized (NULL), Some(id) = specific folder
        let (sql, params): (String, Vec<Box<dyn rusqlite::ToSql + '_>>) = match (search, folder_id) {
            (None, None) => (format!("{} ORDER BY created_at DESC", base), vec![]),
            (Some(s), None) => {
                let pattern = format!("%{}%", s);
                (
                    format!("{} WHERE (file_path_or_name LIKE ?1 OR extracted_data LIKE ?1) ORDER BY created_at DESC", base),
                    vec![Box::new(pattern)],
                )
            }
            (None, Some(-1)) => (
                format!("{} WHERE folder_id IS NULL ORDER BY created_at DESC", base),
                vec![],
            ),
            (None, Some(fid)) => (
                format!("{} WHERE folder_id = ?1 ORDER BY created_at DESC", base),
                vec![Box::new(fid)],
            ),
            (Some(s), Some(-1)) => {
                let pattern = format!("%{}%", s);
                (
                    format!("{} WHERE (file_path_or_name LIKE ?1 OR extracted_data LIKE ?1) AND folder_id IS NULL ORDER BY created_at DESC", base),
                    vec![Box::new(pattern)],
                )
            }
            (Some(s), Some(fid)) => {
                let pattern = format!("%{}%", s);
                (
                    format!("{} WHERE (file_path_or_name LIKE ?1 OR extracted_data LIKE ?1) AND folder_id = ?2 ORDER BY created_at DESC", base),
                    vec![Box::new(pattern), Box::new(fid)],
                )
            }
        };
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt
            .query_map(rusqlite::params_from_iter(param_refs), |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let out: Vec<_> = rows.filter_map(|r| r.ok()).collect();
        Ok(out)
    }

    pub fn get_history_by_id(
        &self,
        id: i64,
    ) -> Result<Option<(String, String, String, String, Option<i64>)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT created_at, document_type, file_path_or_name, extracted_data, excel_profile_id FROM history WHERE id = ?")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![id]).map_err(|e| e.to_string())?;
        let next = rows.next().map_err(|e| e.to_string())?;
        if let Some(row) = next {
            Ok(Some((
                row.get::<_, String>(0).map_err(|e: rusqlite::Error| e.to_string())?,
                row.get::<_, String>(1).map_err(|e: rusqlite::Error| e.to_string())?,
                row.get::<_, String>(2).map_err(|e: rusqlite::Error| e.to_string())?,
                row.get::<_, String>(3).map_err(|e: rusqlite::Error| e.to_string())?,
                row.get::<_, Option<i64>>(4).map_err(|e: rusqlite::Error| e.to_string())?,
            )))
        } else {
            Ok(None)
        }
    }

    pub fn get_learned_mapping(
        &self,
        schema_hash: &str,
        field_type: &str,
    ) -> Result<Option<(String, f64)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT column_letter, confidence, last_used, usage_count FROM learned_mappings WHERE schema_hash = ? AND field_type = ?",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query(params![schema_hash, field_type])
            .map_err(|e| e.to_string())?;
        let row = rows.next().map_err(|e| e.to_string())?;
        if let Some(r) = row {
            let column_letter: String = r.get(0).map_err(|e: rusqlite::Error| e.to_string())?;
            let confidence: f64 = r.get(1).map_err(|e: rusqlite::Error| e.to_string())?;
            let last_used: String = r.get(2).map_err(|e: rusqlite::Error| e.to_string())?;
            let usage_count: i64 = r.get(3).map_err(|e: rusqlite::Error| e.to_string())?;
            let now = chrono::Utc::now();
            let last = chrono::DateTime::parse_from_rfc3339(&last_used)
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .unwrap_or(now);
            let age_days = (now - last).num_days() as f64;
            let lambda = 0.023;
            let decay = (-lambda * age_days).exp();
            let freq_boost = (usage_count as f64 + 1.0).ln() * 0.05;
            let adj = (confidence * decay + freq_boost).min(0.95);
            Ok(Some((column_letter, adj)))
        } else {
            Ok(None)
        }
    }

    pub fn upsert_learned_mapping(
        &self,
        schema_hash: &str,
        field_type: &str,
        column_index: i32,
        column_letter: &str,
        action: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        let (reward, base_conf): (f64, f64) = match action {
            "ACCEPT" => (1.0, 0.85),
            "REJECT" | "MANUAL_SELECT" => (-0.5, 0.70),
            "EDIT" => (-0.2, 0.75),
            _ => (0.0, 0.75),
        };
        let raw = base_conf + reward * 0.1_f64;
        let confidence = raw.max(0.05).min(0.95);
        conn.execute(
            "INSERT INTO learned_mappings (schema_hash, field_type, column_index, column_letter, confidence, usage_count, last_used)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)
             ON CONFLICT(schema_hash, field_type) DO UPDATE SET
               column_index = excluded.column_index,
               column_letter = excluded.column_letter,
               confidence = excluded.confidence,
               usage_count = usage_count + 1,
               last_used = excluded.last_used",
            params![schema_hash, field_type, column_index, column_letter, confidence, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_history_status(
        &self,
        id: i64,
        status: &str,
        excel_profile_id: Option<i64>,
        error_message: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE history SET status = ?, excel_profile_id = ?, error_message = ? WHERE id = ?",
            params![status, excel_profile_id, error_message, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_history_record(
        &self,
        id: i64,
        document_type: &str,
        file_path_or_name: &str,
        extracted_data: &Value,
        status: &str,
        excel_profile_id: Option<i64>,
        error_message: Option<&str>,
    ) -> Result<(), String> {
        let data_str = serde_json::to_string(extracted_data).map_err(|e| e.to_string())?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE history SET document_type = ?, file_path_or_name = ?, extracted_data = ?, status = ?, excel_profile_id = ?, error_message = ? WHERE id = ?",
            params![
                document_type,
                file_path_or_name,
                data_str,
                status,
                excel_profile_id,
                error_message,
                id,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_history_record(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM history WHERE id = ?", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn clear_learned_mappings(&self) -> Result<u64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count = conn
            .execute("DELETE FROM learned_mappings", [])
            .map_err(|e| e.to_string())?;
        Ok(count as u64)
    }
}
