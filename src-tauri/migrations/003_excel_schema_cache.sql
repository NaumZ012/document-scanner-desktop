-- Migration 003: Excel schema cache (profile-centric)
-- Run when schema_version < 2. Drops old path-based excel_schemas and creates new tables.

-- Drop old excel_schemas (path-based cache)
DROP TABLE IF EXISTS excel_schemas;

-- Table: excel_schemas - complete snapshot of Excel file structure per profile
CREATE TABLE IF NOT EXISTS excel_schemas (
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

-- Table: column_formats - formatting details per column
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

-- Table: row_templates - row-level formatting
CREATE TABLE IF NOT EXISTS row_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL UNIQUE,

  template_row_index INTEGER,
  row_height REAL DEFAULT 15.0,
  use_alternating_colors INTEGER DEFAULT 0,

  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Table: cache_changes - audit log for cache updates
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

-- Add columns to profiles (ignore if already present)
ALTER TABLE profiles ADD COLUMN file_size INTEGER;
ALTER TABLE profiles ADD COLUMN file_mtime INTEGER;
ALTER TABLE profiles ADD COLUMN last_scanned_at TEXT;
