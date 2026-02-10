use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelSchema {
    pub header_row: u32,
    pub first_data_row: u32,
    pub last_data_row: u32,
    pub next_free_row: u32,
    pub total_rows: u32,
    pub total_columns: u16,

    pub headers: Vec<HeaderInfo>,
    pub columns: Vec<ColumnFormat>,
    pub row_template: RowTemplate,

    pub file_size: u64,
    pub file_mtime: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderInfo {
    pub column_index: u16,
    pub column_letter: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnFormat {
    pub column_index: u16,
    pub column_letter: String,
    pub header_text: String,

    pub font_name: String,
    pub font_size: u16,
    pub font_color: String,
    pub font_bold: bool,
    pub font_italic: bool,

    pub background_color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color_alt: Option<String>,

    pub border_style: String,
    pub border_color: String,

    pub alignment: String,

    pub data_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,

    pub column_width: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowTemplate {
    pub template_row_index: u32,
    pub row_height: f64,
    pub use_alternating_colors: bool,
}
