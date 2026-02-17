use calamine::{open_workbook_auto, DataType, Reader};
use edit_xlsx::{FormatAlignType, WorkSheetRow, Write};
use regex::Regex;
use std::io::{Read, Write as IoWrite};
use std::path::Path;
use zip::read::ZipArchive;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::types::InvoiceData;
use rust_xlsxwriter::{Format, FormatAlign, Workbook, Worksheet, XlsxError};

/// Column index to Excel letter (0→A, 1→B, 25→Z, 26→AA).
fn col_index_to_letter(index: u32) -> String {
    let mut n = index;
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

/// Structured header for UI: column letter, header text, column index.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelHeader {
    pub column_letter: String,
    pub header_text: String,
    pub column_index: u32,
}

/// Read headers from Excel with column letter and index. Used by visual mapping UI.
/// Reads from local filesystem only (no external calls).
pub fn get_excel_headers(
    path: &str,
    sheet_name: &str,
    header_row: u32,
) -> Result<Vec<ExcelHeader>, String> {
    let raw = read_excel_headers(path, sheet_name, Some(header_row))?;
    let out = raw
        .into_iter()
        .enumerate()
        .map(|(i, header_text)| ExcelHeader {
            column_letter: col_index_to_letter(i as u32),
            header_text,
            column_index: i as u32,
        })
        .collect();
    Ok(out)
}

/// Read a specific row from sheet as headers (1-based row index).
/// Returns header values in column order (A, B, C, ...).
pub fn read_excel_headers(path: &str, sheet_name: &str, header_row: Option<u32>) -> Result<Vec<String>, String> {
    let path = Path::new(path);
    if !path.exists() {
        return Err("File not found. Browse to select again.".to_string());
    }
    let mut workbook = open_workbook_auto(path).map_err(|e| format!("Could not open Excel file: {}", e))?;
    let range = workbook
        .worksheet_range(sheet_name)
        .map_err(|e| format!("Sheet not found: {}", e))?;
    let row_index = header_row.unwrap_or(1).saturating_sub(1) as usize; // 1-based -> 0-based
    let mut headers = Vec::new();
    if let Some(row) = range.rows().nth(row_index) {
        for cell in row {
            let s = cell.as_string().unwrap_or_default();
            headers.push(s);
        }
    }
    Ok(headers)
}

/// Read sample values from columns (rows below header). Returns Vec<Vec<String>>: columns × rows.
pub fn read_excel_column_samples(
    path: &str,
    sheet_name: &str,
    header_row: Option<u32>,
    max_rows: usize,
) -> Result<Vec<Vec<String>>, String> {
    let path = Path::new(path);
    if !path.exists() {
        return Err("File not found. Browse to select again.".to_string());
    }
    let mut workbook = open_workbook_auto(path).map_err(|e| format!("Could not open Excel file: {}", e))?;
    let range = workbook
        .worksheet_range(sheet_name)
        .map_err(|e| format!("Sheet not found: {}", e))?;
    let header_idx = header_row.unwrap_or(1).saturating_sub(1) as usize;
    let rows: Vec<Vec<String>> = range
        .rows()
        .skip(header_idx + 1)
        .take(max_rows)
        .map(|row| {
            row.iter()
                .map(|c| c.as_string().unwrap_or_default())
                .collect()
        })
        .collect();
    if rows.is_empty() {
        return Ok(vec![]);
    }
    let num_cols = rows[0].len();
    let mut columns = vec![Vec::<String>::new(); num_cols];
    for row in rows {
        for (col_idx, cell) in row.iter().enumerate() {
            if col_idx < num_cols && !cell.is_empty() {
                columns[col_idx].push(cell.clone());
            }
        }
    }
    Ok(columns)
}

/// Get list of sheet names from workbook.
pub fn get_sheet_names(path: &str) -> Result<Vec<String>, String> {
    let path = Path::new(path);
    if !path.exists() {
        return Err("File not found.".to_string());
    }
    let workbook = open_workbook_auto(path).map_err(|e| e.to_string())?;
    Ok(workbook.sheet_names().to_vec())
}

/// Find the last 1-based row index that contains any data in the sheet, scanning from header_row downward.
/// Stops after 100 consecutive empty rows. Returns header_row (1-based) if sheet is empty or only has header.
pub fn find_last_data_row(path: &Path, sheet_name: &str, header_row: u32) -> Result<u32, String> {
    let mut workbook = open_workbook_auto(path).map_err(|e| format!("Could not open Excel file: {}", e))?;
    let range = workbook
        .worksheet_range(sheet_name)
        .map_err(|e| format!("Sheet not found: {}", e))?;
    let start_row_0 = header_row.saturating_sub(1) as usize; // 1-based -> 0-based
    let mut last_data_row_0: Option<usize> = None;
    let mut empty_count = 0u32;
    for (row_idx, row) in range.rows().enumerate().skip(start_row_0) {
        let has_data = row.iter().any(|c| !c.is_empty());
        if has_data {
            last_data_row_0 = Some(row_idx);
            empty_count = 0;
        } else {
            empty_count += 1;
            if empty_count >= 100 {
                break;
            }
        }
    }
    let one_based = last_data_row_0
        .map(|r| (r + 1) as u32)
        .unwrap_or(header_row);
    Ok(one_based)
}

/// Schema hash matching frontend computeSchemaHash (deterministic from headers).
fn schema_hash(headers: &[String]) -> String {
    let mut sorted = headers.to_vec();
    sorted.sort();
    let normalized = sorted.join("|");
    let mut hash: i32 = 0;
    for b in normalized.bytes() {
        hash = hash.wrapping_shl(5).wrapping_sub(hash).wrapping_add(b as i32);
    }
    to_radix36(hash.unsigned_abs())
}

fn to_radix36(mut n: u32) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".to_string();
    }
    let mut s = Vec::new();
    while n > 0 {
        s.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    s.reverse();
    String::from_utf8(s).unwrap_or_default()
}

const SAMPLE_ROWS: usize = 5;
const MAX_LAST_ROW_SCAN: usize = 2000;

/// Analyze Excel sheet and return schema (headers, samples, last row, hash).
/// Used by frontend instead of loading full file into webview to avoid OOM.
pub fn analyze_excel_schema(
    path_str: &str,
    sheet_name: &str,
    header_row: u32,
) -> Result<(String, Vec<String>, Vec<Vec<String>>, u32, String), String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err("File not found. Browse to select again.".to_string());
    }
    let mut workbook = open_workbook_auto(path).map_err(|e| format!("Could not open Excel file: {}", e))?;
    let range = workbook
        .worksheet_range(sheet_name)
        .map_err(|e| format!("Sheet not found: {}", e))?;
    let header_idx = header_row.saturating_sub(1) as usize;

    let headers = range
        .rows()
        .nth(header_idx)
        .map(|row| {
            row.iter()
                .map(|c| c.as_string().unwrap_or_default())
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();
    let mut trim = headers.len();
    while trim > 0 && headers.get(trim - 1).map(|s| s.trim().is_empty()).unwrap_or(true) {
        trim -= 1;
    }
    let headers: Vec<String> = headers.into_iter().take(trim).collect();

    let column_samples = read_excel_column_samples(path_str, sheet_name, Some(header_row), SAMPLE_ROWS)?;

    let mut last_data_row = header_idx as u32 + 1;
    for (i, row) in range.rows().skip(header_idx + 1).take(MAX_LAST_ROW_SCAN).enumerate() {
        let has_content = row
            .iter()
            .any(|c| !c.as_string().unwrap_or_default().trim().is_empty());
        if has_content {
            last_data_row = (header_idx + 2 + i) as u32;
        }
    }

    let hash = schema_hash(&headers);
    let worksheet_name = sheet_name.to_string();
    Ok((worksheet_name, headers, column_samples, last_data_row, hash))
}

/// Strip drawing and image parts from an xlsx (zip) file so Excel won't
/// show "Repairs to ... Removed Part: Drawing shape" when opening.
/// We do NOT modify worksheet XML (sheet1.xml etc.) to avoid corrupting cell data.
fn strip_drawings_from_xlsx(path: &Path) -> Result<(), String> {
    use std::fs::File;

    let file = File::open(path).map_err(|e| format!("Could not open for strip: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid zip: {}", e))?;

    let temp_path = path.with_extension("tmp.xlsx");
    let out_file = File::create(&temp_path).map_err(|e| format!("Could not create temp: {}", e))?;
    let mut zip_writer = ZipWriter::new(out_file);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let rel_drawing_re = Regex::new(r#"<Relationship[^>]*drawing[^>]*/>"#).expect("rel drawing regex");
    let ct_drawing_re = Regex::new(r#"<Override\s+PartName="/xl/drawings/[^"]*"[^>]*/>"#).expect("ct drawing regex");
    let ct_media_re = Regex::new(r#"<Override\s+PartName="/xl/media/[^"]*"[^>]*/>"#).expect("ct media regex");

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Entry {}: {}", i, e))?;
        let name = entry.name().replace('\\', "/");
        let is_drawing = name.starts_with("xl/drawings/") || name.starts_with("xl/media/");
        if is_drawing {
            continue;
        }
        let mut data = Vec::new();
        entry.read_to_end(&mut data).map_err(|e| format!("Read {}: {}", name, e))?;

        if name == "[Content_Types].xml" {
            let s = String::from_utf8_lossy(&data);
            let out = ct_drawing_re.replace_all(&s, "");
            let out = ct_media_re.replace_all(&out, "");
            zip_writer.start_file(&name, opts).map_err(|e| e.to_string())?;
            zip_writer.write_all(out.as_bytes()).map_err(|e| e.to_string())?;
        } else if name.contains("worksheets/_rels/") && name.ends_with(".rels") {
            let s = String::from_utf8_lossy(&data);
            let out = rel_drawing_re.replace_all(&s, "").to_string();
            zip_writer.start_file(&name, opts).map_err(|e| e.to_string())?;
            zip_writer.write_all(out.as_bytes()).map_err(|e| e.to_string())?;
        } else {
            // Copy all other parts (including sheet*.xml) unchanged - do not modify worksheet XML
            zip_writer.start_file(&name, opts).map_err(|e| e.to_string())?;
            zip_writer.write_all(&data).map_err(|e| e.to_string())?;
        }
    }
    zip_writer.finish().map_err(|e| e.to_string())?;
    std::fs::rename(&temp_path, path).map_err(|e| format!("Replace file: {}", e))?;
    Ok(())
}

/// Append one row to existing Excel file.
/// Uses edit_xlsx to preserve template formatting, styles, and formulas.
/// column_values: (column_letter, value) e.g. ("A", "123"), ("B", "Invoice")
pub fn append_row_to_excel(
    path: &str,
    sheet_name: &str,
    column_values: Vec<(String, String)>,
) -> Result<(), String> {
    let path = Path::new(path);
    if !path.exists() {
        return Err("File not found. Browse to select again.".to_string());
    }

    let mut workbook = edit_xlsx::Workbook::from_path(path).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("Could not open") || msg.contains("permission") || msg.contains("Permission") {
            "Please close the file in Excel first.".to_string()
        } else {
            format!("Could not open Excel file: {}", msg)
        }
    })?;

    let worksheet = workbook
        .get_worksheet_mut_by_name(sheet_name)
        .map_err(|e| format!("Sheet not found: {}", e))?;

    let new_row = worksheet.max_row() + 1;
    let format = data_cell_format();
    for (col_letter, value) in column_values {
        let cell_ref = format!("{}{}", col_letter.to_uppercase(), new_row);
        let safe_value = sanitize_cell(&value);
        worksheet
            .write_string_with_format(&cell_ref, safe_value, &format)
            .map_err(|e| e.to_string())?;
    }
    let _ = worksheet.set_row_height_with_format(new_row, 96.0, &format);

    workbook.save_as(path).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("Permission denied") || msg.contains("being used") {
            "Please close the file in Excel first.".to_string()
        } else {
            format!("Cannot write to file: {}", msg)
        }
    })?;

    // Strip drawing parts so Excel won't show "Repairs... Removed Part: Drawing shape"
    strip_drawings_from_xlsx(path).map_err(|e| format!("Could not strip drawings: {}", e))?;
    Ok(())
}

/// Data row format: smaller font (9pt), normal weight, top+left align so multi-line text is readable and not cut off.
/// edit_xlsx does not expose wrap_text; we rely on tall row height and vertical Top alignment.
fn data_cell_format() -> edit_xlsx::Format {
    edit_xlsx::Format::default()
        .set_size(9)
        .set_align(FormatAlignType::Top)
        .set_align(FormatAlignType::Left)
}

/// Append one row at a specific row number (for fast append when next_free_row is cached).
/// Uses larger row height so multi-line cells (e.g. Опис) are fully visible, and smaller font.
pub fn append_row_to_excel_at_row(
    path: &str,
    sheet_name: &str,
    row_number: u32,
    column_values: Vec<(String, String)>,
) -> Result<(), String> {
    let path = Path::new(path);
    if !path.exists() {
        return Err("File not found. Browse to select again.".to_string());
    }

    let mut workbook = edit_xlsx::Workbook::from_path(path).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("Could not open") || msg.contains("permission") || msg.contains("Permission") {
            "Please close the file in Excel first.".to_string()
        } else {
            format!("Could not open Excel file: {}", msg)
        }
    })?;

    let worksheet = workbook
        .get_worksheet_mut_by_name(sheet_name)
        .map_err(|e| format!("Sheet not found: {}", e))?;

    let format = data_cell_format();
    for (col_letter, value) in &column_values {
        let cell_ref = format!("{}{}", col_letter.to_uppercase(), row_number);
        let safe_value = sanitize_cell(value);
        worksheet
            .write_string_with_format(&cell_ref, safe_value, &format)
            .map_err(|e| e.to_string())?;
    }

    // Tall row so multi-line text (e.g. Опис) is fully visible; 96pt fits ~6–8 lines at 9pt.
    let row_height = 96.0;
    let _ = worksheet.set_row_height_with_format(row_number, row_height, &format);

    workbook.save_as(path).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("Permission denied") || msg.contains("being used") {
            "Please close the file in Excel first.".to_string()
        } else {
            format!("Cannot write to file: {}", msg)
        }
    })?;

    strip_drawings_from_xlsx(path).map_err(|e| format!("Could not strip drawings: {}", e))?;
    Ok(())
}

/// Column keys for batch export (order matches header row). First column = document type (Тип на документ).
const EXPORT_FIELDS: &[&str] = &[
    "document_type",
    "invoice_number",
    "date",
    "seller_name",
    "buyer_name",
    "description",
    "net_amount",
    "tax_amount",
    "total_amount",
];

/// Remove or replace characters that can corrupt Excel's sheet XML and cause "unreadable content".
/// Drops control chars (except tab, newline, CR). Replaces & < > so raw XML is never broken.
fn sanitize_cell(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        let u = c as u32;
        if c == '\t' || c == '\n' || c == '\r' {
            out.push(c);
        } else if u < 0x20 || u == 0x7F || u == 0xFFFE || u == 0xFFFF {
            // skip control and invalid
        } else {
            match c {
                '&' => out.push_str(" and "),
                '<' => out.push(' '),
                '>' => out.push(' '),
                _ => out.push(c),
            }
        }
    }
    out
}

/// Write text cell with sanitized value (always write, use empty string if sanitized is empty).
fn write_text_cell_safe(
    worksheet: &mut Worksheet,
    row: u32,
    col: u16,
    text: &str,
    format: &Format,
) -> Result<(), XlsxError> {
    let cleaned = sanitize_cell(text);
    worksheet.write_string_with_format(row, col, &cleaned, format).map(|_| ())
}

/// Write number cell: parse as f64 and write number, or write sanitized text on parse failure.
fn write_number_cell_safe(
    worksheet: &mut Worksheet,
    row: u32,
    col: u16,
    value: &str,
    number_format: &Format,
    text_format: &Format,
) -> Result<(), XlsxError> {
    let cleaned = value.replace(',', "").replace(' ', "").trim().to_string();
    match cleaned.parse::<f64>() {
        Ok(num) => worksheet.write_number_with_format(row, col, num, number_format).map(|_| ()),
        Err(_) => {
            let text = sanitize_cell(value);
            worksheet.write_string_with_format(row, col, &text, text_format).map(|_| ())
        }
    }
}

/// Format amount with thousands separator and two decimals (e.g. 27826.17 -> "27,826.17").
fn format_amount(n: f64) -> String {
    let s = format!("{:.2}", n);
    let (int_part, dec_part) = if let Some(dot) = s.find('.') {
        (&s[..dot], &s[dot..])
    } else {
        (s.as_str(), "")
    };
    let (sign, digits) = if int_part.starts_with('-') {
        ("-", &int_part[1..])
    } else {
        ("", int_part)
    };
    let mut out = String::from(sign);
    let chars: Vec<char> = digits.chars().collect();
    let len = chars.len();
    for (i, c) in chars.into_iter().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out.push_str(dec_part);
    out
}

/// Estimate column width from text length (char count × 1.2, clamped 10–50).
fn estimate_text_width(text: &str) -> f64 {
    let w = text.chars().count() as f64 * 1.2;
    w.clamp(10.0, 50.0)
}

/// Compute per-column widths for export: max of header width and cell widths; amount columns fixed at 14.
fn calculate_export_column_widths(invoices: &[InvoiceData]) -> Vec<f64> {
    const AMOUNT_WIDTH: f64 = 14.0;
    let mut max_widths: Vec<f64> = EXPORT_HEADERS
        .iter()
        .map(|h| estimate_text_width(h))
        .collect();
    let amount_indices: [usize; 3] = [5, 6, 7]; // net_amount, tax_amount, total_amount
    for inv in invoices {
        for (col_idx, &field_key) in EXPORT_FIELDS.iter().enumerate() {
            if amount_indices.contains(&col_idx) {
                continue;
            }
            let value = inv
                .fields
                .get(field_key)
                .map(|f| f.value.as_str())
                .unwrap_or("");
            let w = estimate_text_width(value);
            if col_idx < max_widths.len() && w > max_widths[col_idx] {
                max_widths[col_idx] = w.min(50.0);
            }
        }
    }
    for &idx in &amount_indices {
        if idx < max_widths.len() {
            max_widths[idx] = AMOUNT_WIDTH;
        }
    }
    max_widths
}

/// Headers for batch export Excel (Macedonian). First column = type of document.
const EXPORT_HEADERS: &[&str] = &[
    "Тип на документ",
    "Број на документ",
    "Дата на документ",
    "Продавач",
    "Купувач",
    "Опис",
    "Нето износ",
    "ДДВ",
    "бруто износ",
];

/// Append invoice rows to an existing Excel file. Uses calamine to find last data row, then edit_xlsx to write.
/// Creates headers if sheet is empty or only has header row.
pub fn append_invoices_to_existing_excel(
    path: &str,
    worksheet_name: &str,
    header_row: u32,
    invoices: &[InvoiceData],
) -> Result<(), String> {
    let path = Path::new(path);
    let last_row = find_last_data_row(path, worksheet_name, header_row)?;
    let mut next_row = last_row + 1;

    let mut workbook = edit_xlsx::Workbook::from_path(path).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("Could not open") || msg.contains("permission") || msg.contains("Permission") {
            "Please close the file in Excel first.".to_string()
        } else {
            format!("Could not open Excel file: {}", msg)
        }
    })?;

    let worksheet = workbook
        .get_worksheet_mut_by_name(worksheet_name)
        .map_err(|_| format!("Sheet '{}' not found.", worksheet_name))?;

    // If sheet has no data rows (only header or empty), write headers at header_row and data from header_row+1
    if next_row <= header_row {
        for (col_idx, header) in EXPORT_HEADERS.iter().enumerate() {
            let cell_ref = format!("{}{}", col_index_to_letter(col_idx as u32), header_row);
            worksheet
                .write_string(&cell_ref, sanitize_cell(header))
                .map_err(|e| e.to_string())?;
        }
        next_row = header_row + 1;
    }

    for inv in invoices {
        for (col_idx, &field_key) in EXPORT_FIELDS.iter().enumerate() {
            let value = inv
                .fields
                .get(field_key)
                .map(|f| f.value.as_str())
                .unwrap_or("");
            let cell_value = if field_key == "net_amount" || field_key == "tax_amount" || field_key == "total_amount" {
                let num: f64 = value.replace(',', ".").trim().parse().unwrap_or(0.0);
                format_amount(num)
            } else {
                sanitize_cell(value)
            };
            let cell_ref = format!("{}{}", col_index_to_letter(col_idx as u32), next_row);
            worksheet.write_string(&cell_ref, cell_value).map_err(|e| e.to_string())?;
        }
        next_row += 1;
    }

    workbook.save_as(path).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("Permission denied") || msg.contains("being used") {
            "Please close the file in Excel first.".to_string()
        } else {
            format!("Cannot write to file: {}", msg)
        }
    })?;

    Ok(())
}

/// Append to sheet "Invoices" at default header row 1 (used by legacy export_invoices_to_excel when user picks existing file).
fn append_invoices_to_existing(path: &Path, invoices: &[InvoiceData]) -> Result<(), String> {
    append_invoices_to_existing_excel(
        path.to_str().ok_or("Invalid path.")?,
        "Invoices",
        1,
        invoices,
    )
}

/// Create a new Excel workbook with invoice data and save to the given path, or to Downloads if path is None. Returns the file path.
/// When path_override points to an existing file with sheet "Invoices", appends rows instead of overwriting.
pub fn export_invoices_to_excel(invoices: &[InvoiceData], path_override: Option<&str>) -> Result<String, String> {
    let path = if let Some(p) = path_override {
        let p = p.trim();
        if p.is_empty() {
            None
        } else {
            let mut pb = std::path::PathBuf::from(p);
            if pb.extension().map(|e| e.to_str()) != Some(Some("xlsx")) {
                pb.set_extension("xlsx");
            }
            Some(pb)
        }
    } else {
        None
    };

    let path = match path {
        Some(p) => p,
        None => {
            let dir = dirs::download_dir()
                .or_else(dirs::desktop_dir)
                .ok_or("Could not find Downloads or Desktop folder.")?;
            let now = chrono::Local::now();
            let base_name = format!(
                "Invoices_{}.xlsx",
                now.format("%Y%m%d_%H%M%S")
            );
            let mut p = dir.join(&base_name);
            let mut counter = 2u32;
            while p.exists() {
                p = dir.join(format!(
                    "Invoices_{}_{}.xlsx",
                    now.format("%Y%m%d_%H%M%S"),
                    counter
                ));
                counter += 1;
            }
            p
        }
    };

    let path_str = path
        .to_str()
        .ok_or("Invalid path characters.")?
        .to_string();

    // If user chose an existing file, append to it instead of overwriting
    if path.exists() && path_override.is_some() {
        append_invoices_to_existing(&path, invoices)?;
        return Ok(path_str);
    }

    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet.set_name("Invoices").map_err(|e: XlsxError| e.to_string())?;

    let header_format = Format::new()
        .set_bold()
        .set_background_color(rust_xlsxwriter::Color::RGB(0x2563EB))
        .set_font_color(rust_xlsxwriter::Color::RGB(0xFFFFFF));
    let text_format_wrap = Format::new().set_text_wrap();

    let col_widths = calculate_export_column_widths(invoices);
    for (col, &w) in col_widths.iter().enumerate() {
        worksheet
            .set_column_width(col as u16, w)
            .map_err(|e: XlsxError| e.to_string())?;
    }

    for (col, header) in EXPORT_HEADERS.iter().enumerate() {
        write_text_cell_safe(worksheet, 0, col as u16, header, &header_format)
            .map_err(|e: XlsxError| e.to_string())?;
    }

    for (row_idx, inv) in invoices.iter().enumerate() {
        let row = (row_idx + 1) as u32;
        let description_value = inv
            .fields
            .get("description")
            .map(|f| f.value.as_str())
            .unwrap_or("");
        let description_len = description_value.chars().count();
        let mut max_text_len = description_len;
        for (col_idx, &field_key) in EXPORT_FIELDS.iter().enumerate() {
            let value = inv
                .fields
                .get(field_key)
                .map(|f| f.value.as_str())
                .unwrap_or("");
            let is_amount = field_key == "net_amount"
                || field_key == "tax_amount"
                || field_key == "total_amount";
            // Apply text wrap to all columns for better readability
            let cell_format = &text_format_wrap;
            if is_amount {
                let amount_format_wrap = Format::new()
                    .set_num_format("#,##0.00")
                    .set_align(FormatAlign::Right)
                    .set_text_wrap();
                write_number_cell_safe(
                    worksheet,
                    row,
                    col_idx as u16,
                    value,
                    &amount_format_wrap,
                    &text_format_wrap,
                )
                .map_err(|e: XlsxError| e.to_string())?;
            } else {
                if value.chars().count() > max_text_len {
                    max_text_len = value.chars().count();
                }
                write_text_cell_safe(worksheet, row, col_idx as u16, value, cell_format)
                    .map_err(|e: XlsxError| e.to_string())?;
            }
        }
        // Set row height for every row so wrap text is visible (dynamic based on content length)
        let row_height = if max_text_len > 80 {
            ((max_text_len as f64 / 50.0).ceil() * 15.0).min(100.0)
        } else if max_text_len > 40 {
            30.0
        } else {
            15.0
        };
        let _ = worksheet.set_row_height(row, row_height);
    }

    let _ = worksheet.set_freeze_panes(1, 0);
    workbook.save(&path).map_err(|e: XlsxError| e.to_string())?;
    Ok(path_str)
}

/// Create a new Excel file with the given (or default) path and worksheet name. Never appends.
/// Returns the saved file path.
pub fn export_invoices_to_new_excel(
    invoices: &[InvoiceData],
    path_override: Option<&str>,
    worksheet_name: Option<&str>,
) -> Result<String, String> {
    let path = if let Some(p) = path_override.filter(|s| !s.trim().is_empty()) {
        let mut pb = std::path::PathBuf::from(p.trim());
        if pb.extension().map(|e| e.to_str()) != Some(Some("xlsx")) {
            pb.set_extension("xlsx");
        }
        pb
    } else {
        let dir = dirs::download_dir()
            .or_else(dirs::desktop_dir)
            .ok_or("Could not find Downloads or Desktop folder.")?;
        let now = chrono::Local::now();
        let base_name = format!("Invoices_{}.xlsx", now.format("%Y%m%d_%H%M%S"));
        let mut p = dir.join(&base_name);
        let mut counter = 2u32;
        while p.exists() {
            p = dir.join(format!(
                "Invoices_{}_{}.xlsx",
                now.format("%Y%m%d_%H%M%S"),
                counter
            ));
            counter += 1;
        }
        p
    };

    let path_str = path
        .to_str()
        .ok_or("Invalid path characters.")?
        .to_string();

    let sheet_name = worksheet_name.unwrap_or("Invoices").trim();
    let sheet_name = if sheet_name.is_empty() { "Invoices" } else { sheet_name };

    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet.set_name(sheet_name).map_err(|e: XlsxError| e.to_string())?;

    let header_format = Format::new()
        .set_bold()
        .set_background_color(rust_xlsxwriter::Color::RGB(0x2563EB))
        .set_font_color(rust_xlsxwriter::Color::RGB(0xFFFFFF));
    let text_format_wrap = Format::new().set_text_wrap();

    let col_widths = calculate_export_column_widths(invoices);
    for (col, &w) in col_widths.iter().enumerate() {
        worksheet
            .set_column_width(col as u16, w)
            .map_err(|e: XlsxError| e.to_string())?;
    }

    for (col, header) in EXPORT_HEADERS.iter().enumerate() {
        write_text_cell_safe(worksheet, 0, col as u16, header, &header_format)
            .map_err(|e: XlsxError| e.to_string())?;
    }

    for (row_idx, inv) in invoices.iter().enumerate() {
        let row = (row_idx + 1) as u32;
        let description_value = inv
            .fields
            .get("description")
            .map(|f| f.value.as_str())
            .unwrap_or("");
        let description_len = description_value.chars().count();
        let mut max_text_len = description_len;
        for (col_idx, &field_key) in EXPORT_FIELDS.iter().enumerate() {
            let value = inv
                .fields
                .get(field_key)
                .map(|f| f.value.as_str())
                .unwrap_or("");
            let is_amount = field_key == "net_amount"
                || field_key == "tax_amount"
                || field_key == "total_amount";
            let cell_format = &text_format_wrap;
            if is_amount {
                let amount_format_wrap = Format::new()
                    .set_num_format("#,##0.00")
                    .set_align(FormatAlign::Right)
                    .set_text_wrap();
                write_number_cell_safe(
                    worksheet,
                    row,
                    col_idx as u16,
                    value,
                    &amount_format_wrap,
                    &text_format_wrap,
                )
                .map_err(|e: XlsxError| e.to_string())?;
            } else {
                if value.chars().count() > max_text_len {
                    max_text_len = value.chars().count();
                }
                write_text_cell_safe(worksheet, row, col_idx as u16, value, cell_format)
                    .map_err(|e: XlsxError| e.to_string())?;
            }
        }
        // Set row height for every row so wrap text is visible (dynamic based on content length)
        let row_height = if max_text_len > 80 {
            ((max_text_len as f64 / 50.0).ceil() * 15.0).min(100.0)
        } else if max_text_len > 40 {
            30.0
        } else {
            15.0
        };
        let _ = worksheet.set_row_height(row, row_height);
    }

    let _ = worksheet.set_freeze_panes(1, 0);
    workbook.save(&path).map_err(|e: XlsxError| e.to_string())?;
    Ok(path_str)
}
