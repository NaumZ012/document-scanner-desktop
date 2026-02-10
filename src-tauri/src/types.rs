use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrLine {
    pub text: String,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrResult {
    pub lines: Vec<OcrLine>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExcelProfile {
    pub id: i64,
    pub name: String,
    pub excel_path: String,
    pub sheet_name: String,
    pub column_mapping: serde_json::Value,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryRecord {
    pub id: i64,
    pub created_at: String,
    pub document_type: String,
    pub file_path_or_name: String,
    pub extracted_data: serde_json::Value,
    pub status: String,
    pub excel_profile_id: Option<i64>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RowCell {
    pub column: String,
    pub value: String,
}

/// Single field from Azure prebuilt-invoice (value + optional confidence).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceFieldValue {
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
}

/// Structured invoice data from Azure prebuilt-invoice, keyed by our internal field keys.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceData {
    pub fields: std::collections::HashMap<String, InvoiceFieldValue>,
    /// Original PDF filename (set by batch_scan_invoices).
    #[serde(default)]
    pub source_file: Option<String>,
}
