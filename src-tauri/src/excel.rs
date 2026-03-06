use calamine::{open_workbook_auto, DataType, Reader};
use edit_xlsx::{FormatAlignType, WorkSheetRow, Write};
use quick_xml::events::{BytesEnd, BytesStart, BytesText, Event};
use quick_xml::Reader as XmlReader;
use quick_xml::Writer;
use regex::Regex;
use std::collections::HashMap;
use std::io::{Cursor, Read, Write as IoWrite};
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

/// Dump Excel structure to JSON (sheet names + first N rows per sheet, cell-by-cell).
/// Use this to inspect real layout (merged cells show as one cell with content, rest empty).
pub fn dump_excel_structure(path: &str, max_rows: usize) -> Result<String, String> {
    let path = Path::new(path);
    if !path.exists() {
        return Err("File not found.".to_string());
    }
    let mut workbook = open_workbook_auto(path).map_err(|e| format!("Open failed: {}", e))?;
    let sheet_names = workbook.sheet_names().to_vec();
    let mut sheets = serde_json::Map::new();
    for name in &sheet_names {
        let range = workbook
            .worksheet_range(name)
            .map_err(|e| format!("Sheet '{}': {}", name, e))?;
        let mut rows: Vec<Vec<String>> = Vec::new();
        for (row_idx, row) in range.rows().enumerate() {
            if row_idx >= max_rows {
                break;
            }
            let cells: Vec<String> = row
                .iter()
                .map(|c| c.as_string().map(String::from).unwrap_or_else(|| format!("{:?}", c)))
                .collect();
            rows.push(cells);
        }
        let arr: serde_json::Value = serde_json::to_value(rows).map_err(|e| e.to_string())?;
        sheets.insert(name.clone(), arr);
    }
    let out = serde_json::json!({
        "path": path.to_string_lossy(),
        "sheet_names": sheet_names,
        "sheets": sheets,
    });
    serde_json::to_string_pretty(&out).map_err(|e| e.to_string())
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

/// Parse declaration period string (e.g. "05/2025", "5/2025", "05.2025") to month 1–12. Returns None if unparseable.
fn parse_plata_month(declaration_period: &str) -> Option<u32> {
    let s = declaration_period.trim();
    if s.is_empty() {
        return None;
    }
    // "05/2025" or "5/2025"
    if let Some(slash) = s.find('/') {
        let month_str = s[..slash].trim();
        if let Ok(m) = month_str.parse::<u32>() {
            if (1..=12).contains(&m) {
                return Some(m);
            }
        }
    }
    // "05.2025" or "5.2025"
    if let Some(dot) = s.find('.') {
        let month_str = s[..dot].trim();
        if let Ok(m) = month_str.parse::<u32>() {
            if (1..=12).contains(&m) {
                return Some(m);
            }
        }
    }
    // "2025-05"
    if s.len() >= 7 && s.chars().nth(4) == Some('-') {
        if let Ok(m) = s[5..7].trim().parse::<u32>() {
            if (1..=12).contains(&m) {
                return Some(m);
            }
        }
    }
    None
}

/// Parse tax period or date string (e.g. "01/03/2024 - 31/03/2024", "01.03.2024", "03/2024") and return
/// only the month as two digits "01".."12" for use in DDV template Период column. Returns None if unparseable.
pub fn period_to_month_only(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    // Take first part if range: "01/03/2024 - 31/03/2024" -> "01/03/2024"
    let first = s.split('-').next().map(str::trim).unwrap_or(s);
    let first = first.trim_end_matches(|c: char| c == '-' || c == ' ');

    // DD/MM/YYYY or D/M/YYYY
    if let Some(slash1) = first.find('/') {
        let after_first = first[slash1 + 1..].trim_start();
        if let Some(slash2) = after_first.find('/') {
            let month_str = after_first[..slash2].trim();
            if let Ok(m) = month_str.parse::<u32>() {
                if (1..=12).contains(&m) {
                    return Some(format!("{:02}", m));
                }
            }
        } else {
            // "03/2024" style
            let month_str = first[..slash1].trim();
            if let Ok(m) = month_str.parse::<u32>() {
                if (1..=12).contains(&m) {
                    return Some(format!("{:02}", m));
                }
            }
        }
    }
    // DD.MM.YYYY or D.M.YYYY
    if let Some(dot1) = first.find('.') {
        let after_first = first[dot1 + 1..].trim_start();
        if let Some(dot2) = after_first.find('.') {
            let month_str = after_first[..dot2].trim();
            if let Ok(m) = month_str.parse::<u32>() {
                if (1..=12).contains(&m) {
                    return Some(format!("{:02}", m));
                }
            }
        }
    }
    // YYYY-MM-DD
    if first.len() >= 7 && first.chars().nth(4) == Some('-') {
        if let Ok(m) = first[5..7].trim().parse::<u32>() {
            if (1..=12).contains(&m) {
                return Some(format!("{:02}", m));
            }
        }
    }
    None
}

/// Parse tax period or date string and return Macedonian month name ("Јануари".."Декември") for DDV template.
/// Examples:
/// - "01/02/2024 - 29/02/2024" -> "Февруари"
/// - "01.03.2024" -> "Март"
/// - "2024-12-01" -> "Декември"
pub fn period_to_month_name_mk(s: &str) -> Option<String> {
    const MK_MONTHS: [&str; 12] = [
        "Јануари",
        "Февруари",
        "Март",
        "Април",
        "Мај",
        "Јуни",
        "Јули",
        "Август",
        "Септември",
        "Октомври",
        "Ноември",
        "Декември",
    ];
    let mm = period_to_month_only(s)?;
    let m = mm.parse::<usize>().ok()?;
    if !(1..=12).contains(&m) {
        return None;
    }
    Some(MK_MONTHS[m - 1].to_string())
}

/// Row numbers (1-based) in Пресметка на плата template: title row 1, months row 2, data 3–13, declaration 15–18, employee 21–22, tax 25–27.
const PLATA_ROW_BRUTO: u32 = 3;
const PLATA_ROW_PIO: u32 = 4;
const PLATA_ROW_HEALTH: u32 = 5;
const PLATA_ROW_PROF: u32 = 6;
const PLATA_ROW_VRABOTUVANJE: u32 = 7;
const PLATA_ROW_EXEMPTION: u32 = 10;
const PLATA_ROW_PERSONAL_TAX: u32 = 12;
const PLATA_ROW_DECLARATION_NET: u32 = 15;
const PLATA_ROW_EMPLOYEE_COUNT: u32 = 21;

/// Write payroll data into the Пресметка на плата grid by month column.
/// Month from declarationPeriod (e.g. "02/2024") → column: F=Jan(01), G=Feb(02), …, Q=Dec(12).
/// OCR JSON → rows: brutoPlata→3, pridonesPIO→4, pridonesZdravstvo→5, pridonesProfesionalnoZaboluvanje→6,
/// pridonesVrabotuvanje→7, personalenDanok→12, vkupnaNetoPlata→15, brojVraboteni→21.
pub fn write_plata_to_template(
    path: &str,
    sheet_name: &str,
    declaration_period: &str,
    fields: &std::collections::HashMap<String, crate::types::InvoiceFieldValue>,
) -> Result<(), String> {
    let month = parse_plata_month(declaration_period)
        .ok_or_else(|| format!("Could not parse declaration period '{}' (use MM/YYYY e.g. 05/2025)", declaration_period))?;
    let col_letter = col_index_to_letter(5 + (month - 1)); // F=Jan (01), G=Feb (02), …, Q=Dec (12)

    let get = |key: &str| {
        fields
            .get(key)
            .map(|v| v.value.trim().to_string())
            .unwrap_or_default()
    };

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

    let mut write_cell = |row: u32, value: &str| -> Result<(), String> {
        if value.is_empty() {
            return Ok(());
        }
        let cell_ref = format!("{}{}", col_letter, row);
        worksheet
            .write_string_with_format(&cell_ref, sanitize_cell(value), &format)
            .map_err(|e| e.to_string())
    };

    let bruto = get("brutoPlata");
    let bruto_val = if !bruto.is_empty() { bruto } else { get("totalGrossSalary") };
    write_cell(PLATA_ROW_BRUTO, &bruto_val)?;
    write_cell(PLATA_ROW_PIO, &get("pridonesPIO"))?;
    write_cell(PLATA_ROW_HEALTH, &get("pridonesZdravstvo"))?;
    write_cell(PLATA_ROW_PROF, &get("pridonesProfesionalnoZaboluvanje"))?;
    write_cell(PLATA_ROW_VRABOTUVANJE, &get("pridonesVrabotuvanje"))?;
    let exempt = get("taxExemption");
    let exempt_val = if !exempt.is_empty() { exempt } else { get("даночно ослободување") };
    write_cell(PLATA_ROW_EXEMPTION, &exempt_val)?;
    write_cell(PLATA_ROW_PERSONAL_TAX, &get("personalenDanok"))?;
    let net = get("vkupnaNetoPlata");
    let net_val = if !net.is_empty() { net } else { get("totalNetSalary") };
    write_cell(PLATA_ROW_DECLARATION_NET, &net_val)?;
    write_cell(PLATA_ROW_EMPLOYEE_COUNT, &get("brojVraboteni"))?;

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

/// Write a single cell in an existing Excel file (e.g. template form: write value to row 10, column D).
pub fn write_excel_cell(
    path: &str,
    sheet_name: &str,
    row_1based: u32,
    col_letter: &str,
    value: &str,
) -> Result<(), String> {
    write_excel_cells(path, sheet_name, &[(row_1based, col_letter, value)])
}

/// Escape text for use inside XML element content (e.g. <t>value</t>).
fn escape_xml_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

/// Patch worksheet XML: replace cell values for given cell refs (e.g. D10, D11) with new values.
/// Only the first worksheet file (sheet1.xml) is patched; styles.xml and all other parts are untouched.
fn patch_worksheet_cell_values(xml: &[u8], cell_values: &HashMap<String, String>) -> Result<Vec<u8>, String> {
    let mut reader = XmlReader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let is_cell = e.name().as_ref() == b"c";
                let mut cell_ref: Option<String> = None;
                if is_cell {
                    for attr in e.attributes() {
                        let attr = attr.map_err(|e| e.to_string())?;
                        if attr.key.as_ref() == b"r" {
                            cell_ref = Some(std::str::from_utf8(&attr.value).map_err(|e| e.to_string())?.to_string());
                            break;
                        }
                    }
                }
                if is_cell && cell_ref.as_ref().map_or(false, |r| cell_values.contains_key(r)) {
                    let r = cell_ref.as_ref().unwrap();
                    let value = cell_values.get(r).unwrap();
                    let escaped = escape_xml_text(&sanitize_cell(value));
                    let mut c_start = BytesStart::new("c");
                    c_start.push_attribute(("r", r.as_str()));
                    c_start.push_attribute(("t", "inlineStr"));
                    writer.write_event(Event::Start(c_start)).map_err(|e| e.to_string())?;
                    writer.write_event(Event::Start(BytesStart::new("is"))).map_err(|e| e.to_string())?;
                    writer.write_event(Event::Start(BytesStart::new("t"))).map_err(|e| e.to_string())?;
                    writer.write_event(Event::Text(BytesText::from_escaped(escaped.as_str()))).map_err(|e| e.to_string())?;
                    writer.write_event(Event::End(BytesEnd::new("t"))).map_err(|e| e.to_string())?;
                    writer.write_event(Event::End(BytesEnd::new("is"))).map_err(|e| e.to_string())?;
                    writer.write_event(Event::End(BytesEnd::new("c"))).map_err(|e| e.to_string())?;
                    buf.clear();
                    loop {
                        match reader.read_event_into(&mut buf) {
                            Ok(Event::End(ee)) if ee.name().as_ref() == b"c" => {
                                buf.clear();
                                break;
                            }
                            Ok(Event::Eof) => break,
                            Ok(_) => { buf.clear(); }
                                    Err(er) => return Err(er.to_string()),
                                }
                            }
                } else {
                    writer.write_event(Event::Start(e)).map_err(|e| e.to_string())?;
                    if is_cell {
                        loop {
                            match reader.read_event_into(&mut buf) {
                                Ok(Event::End(ee)) if ee.name().as_ref() == b"c" => {
                                    writer.write_event(Event::End(ee)).map_err(|e| e.to_string())?;
                                    buf.clear();
                                    break;
                                }
                                Ok(Event::Eof) => break,
                                Ok(ev) => {
                                    writer.write_event(ev).map_err(|e| e.to_string())?;
                                    buf.clear();
                                }
                                Err(er) => return Err(er.to_string()),
                            }
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(ev) => writer.write_event(ev).map_err(|e| e.to_string())?,
            Err(er) => return Err(er.to_string()),
        }
        buf.clear();
    }
    Ok(writer.into_inner().into_inner())
}

/// Remove the <definedNames>...</definedNames> block from workbook.xml so Excel does not
/// report "Removed Records: Named range" when opening (template often has names pointing to missing sheets).
fn strip_defined_names_from_workbook(xml: &[u8]) -> Vec<u8> {
    let s = match std::str::from_utf8(xml) {
        Ok(s) => s,
        Err(_) => return xml.to_vec(),
    };
    let open_tag = "<definedNames>";
    let close_tag = "</definedNames>";
    let Some(start) = s.find(open_tag) else {
        return xml.to_vec();
    };
    let rest = &s[start..];
    let Some(close_pos) = rest.find(close_tag) else {
        return xml.to_vec();
    };
    let end = start + close_pos + close_tag.len();
    let mut out = String::with_capacity(s.len());
    out.push_str(&s[..start]);
    out.push_str(&s[end..]);
    out.into_bytes()
}

/// Fill tax balance cells by patching only the worksheet XML inside the xlsx zip.
/// Also strips definedNames from workbook.xml so Excel does not report "Removed Records: Named range".
/// Does not use edit-xlsx, so styles.xml is never re-serialized — avoids "unreadable content" errors.
pub fn fill_tax_balance_cells_via_zip(
    path: &Path,
    updates: &[(u32, &str, &str)],
) -> Result<(), String> {
    use std::fs::File;

    let cell_values: HashMap<String, String> = updates
        .iter()
        .map(|(row, col, val)| (format!("{}{}", col.to_uppercase(), row), sanitize_cell(val)))
        .collect();
    if cell_values.is_empty() {
        return Ok(());
    }

    let file = File::open(path).map_err(|e| format!("Open: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid zip: {}", e))?;

    let temp_path = path.with_extension("tmp.xlsx");
    let out_file = File::create(&temp_path).map_err(|e| format!("Create temp: {}", e))?;
    let mut zip_writer = ZipWriter::new(out_file);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let worksheet_name = "xl/worksheets/sheet1.xml";
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Entry {}: {}", i, e))?;
        let name = entry.name().replace('\\', "/");
        let mut data = Vec::new();
        entry.read_to_end(&mut data).map_err(|e| format!("Read {}: {}", name, e))?;

        if name == worksheet_name {
            let patched = patch_worksheet_cell_values(&data, &cell_values)?;
            zip_writer.start_file(&name, opts).map_err(|e| e.to_string())?;
            zip_writer.write_all(&patched).map_err(|e| e.to_string())?;
        } else if name == "xl/workbook.xml" {
            let patched = strip_defined_names_from_workbook(&data);
            zip_writer.start_file(&name, opts).map_err(|e| e.to_string())?;
            zip_writer.write_all(&patched).map_err(|e| e.to_string())?;
        } else {
            zip_writer.start_file(&name, opts).map_err(|e| e.to_string())?;
            zip_writer.write_all(&data).map_err(|e| e.to_string())?;
        }
    }
    zip_writer.finish().map_err(|e| e.to_string())?;
    drop(archive);
    std::fs::rename(&temp_path, path).map_err(|e| format!("Replace: {}", e))?;
    Ok(())
}

/// Write multiple cells in one open/save cycle so the template layout (merges, formatting) is preserved.
/// Uses write_string (no custom format) to avoid edit-xlsx adding style entries that can corrupt
/// styles.xml and cause "Undeclared prefix" / "unreadable content" when Excel opens the file.
pub fn write_excel_cells(
    path: &str,
    sheet_name: &str,
    updates: &[(u32, &str, &str)],
) -> Result<(), String> {
    let path = Path::new(path);
    if !path.exists() {
        return Err("File not found.".to_string());
    }
    let mut workbook = edit_xlsx::Workbook::from_path(path).map_err(|e| e.to_string())?;
    let worksheet = workbook
        .get_worksheet_mut_by_name(sheet_name)
        .map_err(|e| format!("Sheet not found: {}", e))?;
    for (row_1based, col_letter, value) in updates {
        let cell_ref = format!("{}{}", col_letter.to_uppercase(), row_1based);
        let safe_value = sanitize_cell(value);
        worksheet
            .write_string(&cell_ref, safe_value)
            .map_err(|e| e.to_string())?;
    }
    workbook.save_as(path).map_err(|e| e.to_string())?;
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
/// Normalize amount string to parseable form: dot (.) as decimal, no thousands separators.
/// Handles European "27.826,17" (dot thousands, comma decimal) and US "27,826.17" (comma thousands, dot decimal).
fn normalize_amount_string(value: &str) -> String {
    let s = value.trim().replace(' ', "");
    if s.is_empty() {
        return s;
    }
    let last_comma = s.rfind(',');
    let last_dot = s.rfind('.');
    // European: comma is decimal (e.g. "27.826,17" -> last separator is comma)
    let european = match (last_comma, last_dot) {
        (Some(c), Some(d)) => c > d,
        (Some(_), None) => true,
        (None, _) => false,
    };
    if european {
        s.replace('.', "").replace(',', ".")
    } else {
        s.replace(',', "")
    }
}

fn write_number_cell_safe(
    worksheet: &mut Worksheet,
    row: u32,
    col: u16,
    value: &str,
    number_format: &Format,
    text_format: &Format,
) -> Result<(), XlsxError> {
    let cleaned = normalize_amount_string(value);
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

/// Field keys that should be written as numbers in Excel (invoice + analyzer amount fields).
fn is_amount_field(key: &str) -> bool {
    matches!(
        key,
        "net_amount"
            | "tax_amount"
            | "total_amount"
            | "financialResultFromPL"
            | "nonRecognizedExpensesTotal"
            | "taxBaseBeforeReduction"
            | "taxBaseReductionTotal"
            | "taxBaseAfterReduction"
            | "calculatedProfitTax"
            | "calculatedTaxReductionTotal"
            | "calculatedTaxAfterReduction"
            | "advanceTaxPaid"
            | "overpaidCarriedForward"
            | "amountToPayOrOverpaid"
            | "totalTaxBase"
            | "totalOutputVat"
            | "totalInputVat"
            | "vatPayableOrRefund"
            | "totalGrossSalary"
            | "totalNetSalary"
            | "totalPayrollCost"
            // Plata (payroll) schema numeric fields
            | "brojVraboteni"
            | "brutoPlata"
            | "pridonesPIO"
            | "pridonesZdravstvo"
            | "pridonesProfesionalnoZaboluvanje"
            | "pridonesVrabotuvanje"
            | "personalenDanok"
            | "vkupnaNetoPlata"
            // DDV box fields (01–19: основа/ДДВ and single numeric columns)
            | "prometOpshtaStapkaOsnova"
            | "prometOpshtaStapkaDDV"
            | "prometPovlastenaStapka10Osnova"
            | "prometPovlastenaStapka10DDV"
            | "prometPovlastenaStapka5Osnova"
            | "prometPovlastenaStapka5DDV"
            | "izvoz"
            | "oslobodenSOPravoNaOdbivka"
            | "oslobodenBezPravoNaOdbivka"
            | "prometNerezidentiNeOdanocliv"
            | "prometPrenesuvanjeDanocnaObvrska"
            | "primenPrometNerezidentiOpshtaOsnova"
            | "primenPrometNerezidentiOpshtaDDV"
            | "primenPrometNerezidentiPovlastenaOsnova"
            | "primenPrometNerezidentiPovlastenaDDV"
            | "primenPrometZemjaOpshtaOsnova"
            | "primenPrometZemjaOpshtaDDV"
            | "primenPrometZemjaPovlastenaOsnova"
            | "primenPrometZemjaPovlastenaDDV"
    )
}

/// Create a new Excel file with custom headers and column mapping (no template).
/// Uses rust_xlsxwriter only — no edit_xlsx, so no named ranges or calc chain (avoids "unreadable content").
/// Returns the saved file path.
pub fn export_to_new_excel_with_columns(
    path: &str,
    worksheet_name: &str,
    headers: &[String],
    column_field_keys: &[String],
    invoices: &[InvoiceData],
) -> Result<String, String> {
    if headers.len() != column_field_keys.len() {
        return Err("headers and column_field_keys must have the same length".to_string());
    }
    let path_buf = std::path::PathBuf::from(path);
    let path_str = path_buf
        .to_str()
        .ok_or("Invalid path")?
        .to_string();

    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name(worksheet_name)
        .map_err(|e: XlsxError| e.to_string())?;

    let header_format = Format::new()
        .set_bold()
        .set_background_color(rust_xlsxwriter::Color::RGB(0x2563EB))
        .set_font_color(rust_xlsxwriter::Color::RGB(0xFFFFFF));
    let text_format_wrap = Format::new().set_text_wrap();
    let amount_format_wrap = Format::new()
        .set_num_format("#,##0.00")
        .set_align(FormatAlign::Right)
        .set_text_wrap();

    const COL_WIDTH: f64 = 18.0;
    for col in 0..headers.len() {
        let _ = worksheet.set_column_width(col as u16, COL_WIDTH);
    }

    for (col, header) in headers.iter().enumerate() {
        write_text_cell_safe(worksheet, 0, col as u16, header, &header_format)
            .map_err(|e: XlsxError| e.to_string())?;
    }

    for (row_idx, inv) in invoices.iter().enumerate() {
        let row = (row_idx + 1) as u32;
        for (col_idx, field_key) in column_field_keys.iter().enumerate() {
            // rowOrder is 1-based row index (matches РД-ДДВ "Ред." column).
            let (mut value, is_number) = if field_key == "rowOrder" {
                ((row_idx + 1).to_string(), true)
            } else {
                let v = inv
                    .fields
                    .get(field_key)
                    .map(|f| f.value.as_str())
                    .unwrap_or("");
                (v.to_string(), is_amount_field(field_key))
            };
            // DDV export (screen export): write Macedonian month name in Период instead of full date/range.
            if !is_number && worksheet_name == "ДДВ" && field_key == "taxPeriod" {
                if let Some(month_name) = period_to_month_name_mk(&value) {
                    value = month_name;
                }
            }
            if is_number {
                write_number_cell_safe(
                    worksheet,
                    row,
                    col_idx as u16,
                    &value,
                    &amount_format_wrap,
                    &text_format_wrap,
                )
                .map_err(|e: XlsxError| e.to_string())?;
            } else {
                write_text_cell_safe(worksheet, row, col_idx as u16, &value, &text_format_wrap)
                    .map_err(|e: XlsxError| e.to_string())?;
            }
        }
    }

    let _ = worksheet.set_freeze_panes(1, 0);
    workbook.save(&path_buf).map_err(|e: XlsxError| e.to_string())?;
    Ok(path_str)
}

/// DDV (РД-ДДВ) template – exact official sub-headers (row that defines each column). Matches РД-ДДВ-Example.xlsx.
/// Columns: Период, 1–19 (Даночна основа без ДДВ/ДДВ or full text), Вкупно, Реф.
const DDV_TEMPLATE_HEADERS: [&str; 22] = [
    "Период",
    "Даночна основа без ДДВ",
    "ДДВ",
    "Даночна основа без ДДВ",
    "ДДВ",
    "Даночна основа без ДДВ",
    "ДДВ",
    "Извоз",
    "Промет ослободен од данок со право на одбивка на претходен данок",
    "Промет ослободен од данок без право на одбивка на претходен данок",
    "Промет извршен спрема даночни обврзници кои немаат седиште во земјата, кој не е предмет на оданочување во земјата",
    "Промет во земјата за кој данокот го пресметува примателот на прометот (пренесување на даночна обврска согласно член 32-а)",
    "Даночна основа без ДДВ",
    "ДДВ",
    "Даночна основа без ДДВ",
    "ДДВ",
    "Даночна основа без ДДВ",
    "ДДВ",
    "Даночна основа без ДДВ",
    "ДДВ",
    "Вкупно",
    "Реф.",
];

/// Month labels and total row for РД-ДДВ (data block rows 5–18 in official template).
const DDV_PERIOD_ROW_LABELS: [&str; 13] = [
    "Јануари",
    "Февруари",
    "Март",
    "Април",
    "Мај",
    "Јуни",
    "Јули",
    "Август",
    "Септември",
    "Октомври",
    "Ноември",
    "Декември",
    "Вкупно",
];

/// Create a DDV (VAT return) Excel template matching РД-ДДВ-Example.xlsx: exact headers, period rows, Вкупно formula.
/// Formula for column 20 (Вкупно): =(2+4+6+13+15+17+19) → sum of VAT columns B,D,F,M,O,Q,S.
pub fn create_ddv_template_xlsx(path: &str) -> Result<(), String> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name("ДДВ")
        .map_err(|e: XlsxError| e.to_string())?;

    let header_format = Format::new()
        .set_bold()
        .set_background_color(rust_xlsxwriter::Color::RGB(0xE0E0E0))
        .set_text_wrap();
    let text_format_wrap = Format::new().set_text_wrap();

    const COL_WIDTH: f64 = 16.0;
    for col in 0..DDV_TEMPLATE_HEADERS.len() {
        let _ = worksheet.set_column_width(col as u16, COL_WIDTH);
    }

    for (col, header) in DDV_TEMPLATE_HEADERS.iter().enumerate() {
        write_text_cell_safe(worksheet, 0, col as u16, header, &header_format)
            .map_err(|e: XlsxError| e.to_string())?;
    }

    for (row_idx, period_label) in DDV_PERIOD_ROW_LABELS.iter().enumerate() {
        let row = (row_idx + 1) as u32;
        worksheet
            .write_string_with_format(row, 0, *period_label, &text_format_wrap)
            .map_err(|e: XlsxError| e.to_string())?;
        for col in 1..20u16 {
            let _ = worksheet.write_string_with_format(row, col, "", &text_format_wrap);
        }
        let excel_row = row + 1u32;
        let formula = format!(
            "=B{}+D{}+F{}+M{}+O{}+Q{}+S{}",
            excel_row, excel_row, excel_row, excel_row, excel_row, excel_row, excel_row
        );
        worksheet
            .write_formula(row, 20, formula.as_str())
            .map_err(|e: XlsxError| e.to_string())?;
        let _ = worksheet.write_string_with_format(row, 21, "", &text_format_wrap);
    }

    let _ = worksheet.set_freeze_panes(1, 0);
    workbook
        .save(path)
        .map_err(|e: XlsxError| e.to_string())?;
    Ok(())
}

// --- Plata (РД-Трошоци за вработени) templates ---

/// Simple table layout for Plata export: one header row (A1–K1), one data row per document.
/// Matches user image: dark blue header, white bold centered; columns = Company, EDB, Period, Count, Bruto, PIO, Health, Prof, Employment, Personal tax, Net.
const PLATA_SIMPLE_HEADERS: [&str; 11] = [
    "Назив на компанија",
    "ЕДБ",
    "Даночен период (м)",
    "Број на осигурени лица",
    "Бруто плата (Бруто)",
    "Придонес за ПИО",
    "Придонес за здравство",
    "Придонес за профес.",
    "Придонес за вработ.",
    "Персонален данок",
    "Вкупна нето плата",
];

/// Create the simple Plata export template: sheet "Плати", row 1 = headers A1–K1 (dark blue bg, white bold centered).
/// Data rows are appended on export (one row per document). Structure and formatting match user image.
pub fn create_plata_simple_table_xlsx(path: &str) -> Result<(), String> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name("Плати")
        .map_err(|e: XlsxError| e.to_string())?;

    let header_fmt = Format::new()
        .set_bold()
        .set_text_wrap()
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter)
        .set_background_color(rust_xlsxwriter::Color::RGB(0x1E3A5F))
        .set_font_color(rust_xlsxwriter::Color::RGB(0xFFFFFF));

    let col_widths = [22.0, 16.0, 14.0, 12.0, 18.0, 14.0, 14.0, 12.0, 12.0, 16.0, 16.0];
    for (col, &header) in PLATA_SIMPLE_HEADERS.iter().enumerate() {
        let w = col_widths.get(col).copied().unwrap_or(18.0);
        worksheet
            .set_column_width(col as u16, w)
            .map_err(|e: XlsxError| e.to_string())?;
        worksheet
            .write_string_with_format(0, col as u16, header, &header_fmt)
            .map_err(|e: XlsxError| e.to_string())?;
    }
    worksheet.set_row_height(0, 24.0).map_err(|e: XlsxError| e.to_string())?;

    let _ = worksheet.set_freeze_panes(1, 0);
    workbook
        .save(path)
        .map_err(|e: XlsxError| e.to_string())?;
    Ok(())
}

/// Month column headers for payroll (Пресметка на плата). Must match example file exactly.
const PLATA_MONTH_HEADERS: [&str; 12] = [
    "Јануари",
    "Фебруари",
    "Март",
    "Април",
    "Мај",
    "Јуни",
    "Јули",
    "Август",
    "Септември",
    "Октомври",
    "Ноември",
    "Декември",
];

/// Payroll section layout (match screenshot): A = row#, B = label, C = %, F–Q = months (F=Jan).
fn write_plata_main_section(
    worksheet: &mut Worksheet,
    start_row: u32,
    _header_fmt: &Format,
    cell_fmt: &Format,
    pct_fmt: &Format,
    light_blue_fmt: &Format,
) -> Result<(), XlsxError> {
    let rows: [(&str, &str); 11] = [
        ("Бруто плата (Бруто 2)", ""),
        ("Придонес за ПИО", "18.80%"),
        ("Придонес за здравство", "7.50%"),
        ("Придонес за профес. здравствено осигурување", "0.50%"),
        ("Придонес за вработување", "1.20%"),
        ("Вкупни придонеси (2+3+4+5)", "28.00%"),
        ("Бруто основа (Бруто 1) (1-6)", ""),
        ("Даночно ослободување", ""),
        ("Вкупна даночна основа (7-8)", ""),
        ("Персонален данок", "10.00%"),
        ("Нето плата (7-11)", ""),
    ];
    const COL_LABEL: u16 = 1;   // B (row labels)
    const COL_PCT: u16 = 2;    // C (percentage)
    let month_start_col: u16 = 5;  // F (January)
    let month_end_col: u16 = 16;    // Q (December)

    for (i, (label, pct)) in rows.iter().enumerate() {
        let r = start_row + i as u32;
        // Highlight only summary rows: Вкупни придонеси (5), Вкупна даночна основа (8), Нето плата (10)
        let fmt = if i == 5 || i == 8 || i == 10 {
            light_blue_fmt
        } else {
            cell_fmt
        };
        worksheet.write_number_with_format(r, 0, (i + 1) as u32, fmt)?;
        worksheet.write_string_with_format(r, COL_LABEL, *label, fmt)?;
        if !pct.is_empty() {
            worksheet.write_string_with_format(r, COL_PCT, *pct, pct_fmt)?;
        }
        // Do not write empty string to formula rows (5,6,9,10) so formulas are preserved
        for col in month_start_col..=month_end_col {
            if i != 5 && i != 6 && i != 9 && i != 10 {
                let _ = worksheet.write_string_with_format(r, col, "", fmt);
            }
        }
    }
    let excel_base = start_row + 1; // first data row Excel 1-based (e.g. 3)
    for col_idx in 0..12u32 {
        let col = col_idx + 5; // F=5 .. Q=16
        let l = col_index_to_letter(col);
        // Row 8: Вкупни придонеси = K4+K5+K6+K7
        let formula_row8 = format!(
            "={}{}+{}{}+{}{}+{}{}",
            l, excel_base + 1, l, excel_base + 2, l, excel_base + 3, l, excel_base + 4
        );
        worksheet.write_formula(start_row + 5, col as u16, formula_row8.as_str())?;
        // Row 9: Бруто основа = row3 - row8
        let formula_row9 = format!("={}{}-{}{}", l, excel_base, l, excel_base + 5);
        worksheet.write_formula(start_row + 6, col as u16, formula_row9.as_str())?;
        // Row 12: Вкупна даночна основа = row9 - row10
        let formula_row12 = format!("={}{}-{}{}", l, excel_base + 6, l, excel_base + 7);
        worksheet.write_formula(start_row + 9, col as u16, formula_row12.as_str())?;
        // Row 13: Нето плата = row9 - row12
        let formula_row13 = format!("={}{}-{}{}", l, excel_base + 6, l, excel_base + 9);
        worksheet.write_formula(start_row + 10, col as u16, formula_row13.as_str())?;
    }
    Ok(())
}

/// Create Plata template: "just the table" — no metadata. Row 1 = title, row 2 = months, rows 3–13 = main table, 15–18 declaration, 21–22 employee, 25–27 tax.
pub fn create_plata_template_xlsx(path: &str) -> Result<(), String> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name("МПИН")
        .map_err(|e: XlsxError| e.to_string())?;

    let title_fmt = Format::new()
        .set_bold()
        .set_align(FormatAlign::Center)
        .set_background_color(rust_xlsxwriter::Color::RGB(0xCC6600))
        .set_font_color(rust_xlsxwriter::Color::RGB(0xFFFFFF));
    let month_header_fmt = Format::new()
        .set_bold()
        .set_text_wrap()
        .set_align(FormatAlign::Center)
        .set_background_color(rust_xlsxwriter::Color::RGB(0x1E3A5F))
        .set_font_color(rust_xlsxwriter::Color::RGB(0xFFFFFF));
    let header_fmt = Format::new().set_bold().set_text_wrap();
    let cell_fmt = Format::new().set_text_wrap();
    let pct_fmt = Format::new().set_text_wrap().set_align(FormatAlign::Right);
    let light_green_fmt = Format::new()
        .set_text_wrap()
        .set_background_color(rust_xlsxwriter::Color::RGB(0xC6EFCE));

    worksheet.set_column_width(0, 5.0).map_err(|e: XlsxError| e.to_string())?;
    worksheet.set_column_width(1, 42.0).map_err(|e: XlsxError| e.to_string())?; // B = labels
    worksheet.set_column_width(2, 10.0).map_err(|e: XlsxError| e.to_string())?; // C = %
    worksheet.set_column_width(3, 8.0).map_err(|e: XlsxError| e.to_string())?;
    worksheet.set_column_width(4, 8.0).map_err(|e: XlsxError| e.to_string())?;
    for col in 5..16u16 {
        let _ = worksheet.set_column_width(col, 12.0); // F–P months
    }
    worksheet.set_column_width(16, 14.0).map_err(|e: XlsxError| e.to_string())?; // Q for "Декември"

    // --- Row 1: merged B1:E1 "Пресметка на плата", orange ---
    worksheet
        .merge_range(0, 1, 0, 4, "Пресметка на плата", &title_fmt)
        .map_err(|e: XlsxError| e.to_string())?;

    // --- Row 2: C2="%", F2:Q2 = month names (F=Jan), blue ---
    worksheet
        .write_string_with_format(1, 2, "%", &month_header_fmt)
        .map_err(|e: XlsxError| e.to_string())?;
    for (col, month) in PLATA_MONTH_HEADERS.iter().enumerate() {
        worksheet
            .write_string_with_format(1, col as u16 + 5, *month, &month_header_fmt)
            .map_err(|e: XlsxError| e.to_string())?;
    }

    // --- Main payroll section: rows 3–13 (0-based 2–12) ---
    write_plata_main_section(worksheet, 2, &header_fmt, &cell_fmt, &pct_fmt, &light_green_fmt)
        .map_err(|e: XlsxError| e.to_string())?;

    // --- Row 14 empty; declaration rows 15–18 (0-based 14–17) ---
    let decl_labels = [
        "Вкупно нето ефективна плата по декларација",
        "Разлика по декларација за ПДД и одбитоци",
        "Задршки",
        "Разлика",
    ];
    for (i, label) in decl_labels.iter().enumerate() {
        let r = 14u32 + i as u32;
        worksheet
            .write_string_with_format(r, 1, *label, &light_green_fmt)
            .map_err(|e: XlsxError| e.to_string())?;
        for col in 5..17u16 {
            let _ = worksheet.write_string_with_format(r, col, "0", &light_green_fmt);
        }
    }

    // --- Rows 19–20 empty; employee rows 21–22 (0-based 20–21) ---
    worksheet
        .write_string_with_format(
            20,
            1,
            "Број на вработени за кои се пресметува плата",
            &light_green_fmt,
        )
        .map_err(|e: XlsxError| e.to_string())?;
    worksheet
        .write_string_with_format(
            21,
            1,
            "Максимално дозволено даночно ослободување",
            &light_green_fmt,
        )
        .map_err(|e: XlsxError| e.to_string())?;
    for col in 5..17u16 {
        let _ = worksheet.write_string_with_format(20, col, "", &light_green_fmt);
        let _ = worksheet.write_string_with_format(21, col, "", &light_green_fmt);
    }

    // --- Rows 23–24 empty; tax block rows 25–27 (0-based 24–26) ---
    let tax_labels = [
        "Даночно ослободување",
        "Максимално дозволено даночно ослободување",
        "Разлика (не смее да биде негативна)",
    ];
    for (i, label) in tax_labels.iter().enumerate() {
        let r = 24u32 + i as u32;
        worksheet
            .write_string_with_format(r, 1, *label, &light_green_fmt)
            .map_err(|e: XlsxError| e.to_string())?;
        for col in 5..17u16 {
            let _ = worksheet.write_string_with_format(r, col, "", &light_green_fmt);
        }
    }

    let _ = worksheet.set_freeze_panes(2, 0);
    workbook.save(path).map_err(|e: XlsxError| e.to_string())?;
    Ok(())
}
