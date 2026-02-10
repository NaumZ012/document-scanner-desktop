//! Excel structure and format scanning using edit-xlsx (1-based row/col).

use crate::models::{ColumnFormat, HeaderInfo, RowTemplate};
use edit_xlsx::Read;
use std::path::Path;

const HEADER_KEYWORDS: &[&str] = &[
    "број", "number", "датум", "date", "продавач", "seller", "купувач", "buyer", "вкупно", "total",
    "износ", "amount", "тип", "type", "опис", "description", "ддв", "vat", "tax",
];

/// Column index (0-based) to Excel letter (0→A, 1→B, 26→AA).
fn column_index_to_letter(index: u16) -> String {
    let mut n = index as u32;
    let mut s = String::new();
    loop {
        let r = (n % 26) as u8;
        s.insert(0, (b'A' + r) as char);
        if n < 26 {
            break;
        }
        n = n / 26 - 1;
    }
    s
}

/// Detect header row by scanning rows 1..=20 for keyword matches (edit-xlsx uses 1-based rows).
pub fn detect_header_row(workbook: &edit_xlsx::Workbook, sheet_name: &str) -> Result<u32, String> {
    let sheet = workbook
        .get_worksheet_by_name(sheet_name)
        .map_err(|e| format!("Worksheet '{}' not found: {}", sheet_name, e))?;
    for row in 1..=20u32 {
        let mut keyword_count = 0u32;
        for col in 1..=20u32 {
            if let Ok(cell) = sheet.read_cell((row, col)) {
                let value = cell
                    .text
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase();
                for keyword in HEADER_KEYWORDS {
                    if value.contains(keyword) {
                        keyword_count += 1;
                        break;
                    }
                }
            }
        }
        if keyword_count >= 3 {
            return Ok(row);
        }
    }
    Ok(1)
}

/// Extract headers from the given header row (1-based). Stops after 3 consecutive empty cells.
pub fn extract_headers(
    workbook: &edit_xlsx::Workbook,
    sheet_name: &str,
    header_row: u32,
) -> Result<Vec<HeaderInfo>, String> {
    let sheet = workbook
        .get_worksheet_by_name(sheet_name)
        .map_err(|e| format!("Worksheet not found: {}", e))?;
    let mut headers = Vec::new();
    let mut empty_count = 0u32;
    for col in 1..=50u32 {
        let text = sheet
            .read_cell((header_row, col))
            .ok()
            .and_then(|c| c.text)
            .unwrap_or_default();
        let text = text.trim().to_string();
        if text.is_empty() {
            empty_count += 1;
            if empty_count >= 3 {
                break;
            }
        } else {
            empty_count = 0;
            let col_index = (col - 1) as u16;
            headers.push(HeaderInfo {
                column_index: col_index,
                column_letter: column_index_to_letter(col_index),
                text,
            });
        }
    }
    Ok(headers)
}

/// Find last row that has data in the first 20 columns. Stops after 100 consecutive empty rows.
pub fn find_last_data_row(
    workbook: &edit_xlsx::Workbook,
    sheet_name: &str,
    header_row: u32,
) -> Result<u32, String> {
    let sheet = workbook
        .get_worksheet_by_name(sheet_name)
        .map_err(|e| format!("Worksheet not found: {}", e))?;
    let start_row = header_row + 1;
    let max_scan = start_row + 10_000;
    let mut last_row = header_row;
    let mut consecutive_empty = 0u32;
    for row in start_row..=max_scan {
        let mut has_data = false;
        for col in 1..=20u32 {
            if let Ok(cell) = sheet.read_cell((row, col)) {
                let s = cell.text.as_deref().unwrap_or("").trim();
                if !s.is_empty() {
                    has_data = true;
                    last_row = row;
                    consecutive_empty = 0;
                    break;
                }
            }
        }
        if !has_data {
            consecutive_empty += 1;
            if consecutive_empty >= 100 {
                break;
            }
        }
    }
    Ok(last_row)
}

/// FormatColor to hex string (best effort).
fn format_color_to_hex(color: &edit_xlsx::FormatColor) -> String {
    match color {
        edit_xlsx::FormatColor::RGB(r, g, b) => {
            format!("#{:02X}{:02X}{:02X}", r, g, b)
        }
        edit_xlsx::FormatColor::Default => "#000000".to_string(),
        edit_xlsx::FormatColor::Index(_) => "#000000".to_string(),
        edit_xlsx::FormatColor::Theme(_, _) => "#000000".to_string(),
    }
}

/// Extract ColumnFormat from a data row cell (1-based row/col).
fn cell_to_column_format(
    workbook: &edit_xlsx::Workbook,
    sheet_name: &str,
    header: &HeaderInfo,
    template_row: u32,
) -> Result<ColumnFormat, String> {
    let sheet = workbook
        .get_worksheet_by_name(sheet_name)
        .map_err(|e| format!("Worksheet not found: {}", e))?;
    let col_1based = header.column_index + 1;
    let cell = sheet
        .read_cell((template_row, col_1based as u32))
        .unwrap_or_default();
    let (font_name, font_size, font_color, font_bold, font_italic, background_color, border_style, border_color, alignment, number_format) =
        if let Some(ref fmt) = cell.format {
            let font_name = fmt.get_font().to_string();
            let font_size = fmt.get_size() as u16;
            let font_color = format_color_to_hex(fmt.get_color());
            let font_bold = fmt.is_bold();
            let font_italic = fmt.is_italic();
            let background_color = format_color_to_hex(fmt.get_background_color());
            let border_style = "thin".to_string();
            let border_color = "#000000".to_string();
            let alignment = "left".to_string();
            let number_format = None::<String>;
            (font_name, font_size, font_color, font_bold, font_italic, background_color, border_style, border_color, alignment, number_format)
        } else {
            (
                "Arial".to_string(),
                11,
                "#000000".to_string(),
                false,
                false,
                "#FFFFFF".to_string(),
                "thin".to_string(),
                "#000000".to_string(),
                "left".to_string(),
                None,
            )
        };
    let alt_bg = if template_row + 1 <= sheet.max_row() {
        if let Ok(next_cell) = sheet.read_cell((template_row + 1, col_1based as u32)) {
            if let Some(ref next_fmt) = next_cell.format {
                let next_bg = format_color_to_hex(next_fmt.get_background_color());
                if next_bg != background_color {
                    Some(next_bg)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };
    let cell_text = cell.text.as_deref().unwrap_or("");
    let data_type = detect_data_type(cell_text);
    let column_width = 10.0;
    Ok(ColumnFormat {
        column_index: header.column_index,
        column_letter: header.column_letter.clone(),
        header_text: header.text.clone(),
        font_name,
        font_size,
        font_color,
        font_bold,
        font_italic,
        background_color,
        background_color_alt: alt_bg,
        border_style,
        border_color,
        alignment,
        data_type,
        number_format,
        column_width,
    })
}

fn detect_data_type(value: &str) -> String {
    let v = value.trim();
    if v.is_empty() {
        return "text".to_string();
    }
    if v.parse::<f64>().is_ok() {
        return "number".to_string();
    }
    if v.contains('.') && v.replace(',', "").chars().all(|c| c.is_numeric() || c == '.') {
        return "number".to_string();
    }
    if v.contains('/') || v.contains('-') {
        if v.chars().filter(|c| c.is_ascii_digit()).count() >= 4 {
            return "date".to_string();
        }
    }
    "text".to_string()
}

/// Analyze column formats from the first data row (template row).
pub fn analyze_column_formats(
    workbook: &edit_xlsx::Workbook,
    sheet_name: &str,
    headers: &[HeaderInfo],
    template_row: u32,
) -> Result<Vec<ColumnFormat>, String> {
    let mut columns = Vec::new();
    for header in headers {
        columns.push(cell_to_column_format(workbook, sheet_name, header, template_row)?);
    }
    Ok(columns)
}

/// Full scan: open workbook and return (header_row, headers, last_data_row, next_free_row, total_rows, columns, row_template, file_size, file_mtime).
pub fn scan_excel_file(
    path: &Path,
    sheet_name: &str,
) -> Result<
    (
        u32,
        Vec<HeaderInfo>,
        u32,
        u32,
        u32,
        Vec<ColumnFormat>,
        RowTemplate,
        u64,
        u64,
    ),
    String,
> {
    let mut workbook =
        edit_xlsx::Workbook::from_path(path).map_err(|e| format!("Could not open Excel file: {}", e))?;
    workbook.finish();
    let header_row = detect_header_row(&workbook, sheet_name)?;
    let headers = extract_headers(&workbook, sheet_name, header_row)?;
    if headers.is_empty() {
        return Err("No headers found".to_string());
    }
    let last_data_row = find_last_data_row(&workbook, sheet_name, header_row)?;
    let next_free_row = last_data_row + 1;
    let template_row = header_row + 1;
    let columns = analyze_column_formats(&workbook, sheet_name, &headers, template_row)?;
    let sheet = workbook
        .get_worksheet_by_name(sheet_name)
        .map_err(|e| format!("Worksheet not found: {}", e))?;
    let row_height = sheet.get_default_row();
    let use_alternating_colors = columns.iter().any(|c| c.background_color_alt.is_some());
    let row_template = RowTemplate {
        template_row_index: template_row,
        row_height,
        use_alternating_colors,
    };
    let total_rows = sheet.max_row();
    let metadata = std::fs::metadata(path).map_err(|e| format!("Failed to read file metadata: {}", e))?;
    let file_size = metadata.len();
    let file_mtime = metadata
        .modified()
        .map_err(|e| format!("Failed to get modification time: {}", e))?
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    Ok((
        header_row,
        headers,
        last_data_row,
        next_free_row,
        total_rows,
        columns,
        row_template,
        file_size,
        file_mtime,
    ))
}
