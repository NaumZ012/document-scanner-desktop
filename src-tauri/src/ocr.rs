use crate::types::{InvoiceData, InvoiceFieldValue, OcrInvoiceResult, OcrLine, OcrResult};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use lopdf::Document;
use reqwest::blocking::Client;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

fn load_env() {
    let _ = dotenvy::dotenv();
}

/// Parse DDV amount string (handles European number format: dots as thousand sep).
fn parse_ddv_amt(s: &str) -> f64 {
    let s = s.trim().replace(',', "").replace('.', "");
    if s.is_empty() {
        return 0.0;
    }
    s.parse::<f64>().unwrap_or(0.0)
}

fn count_pages_best_effort(file_path: &str) -> Option<u32> {
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if ext == "pdf" {
        if let Ok(doc) = Document::load(file_path) {
            let pages = doc.get_pages().len() as u32;
            return Some(if pages == 0 { 1 } else { pages });
        }
        return None;
    }
    Some(1)
}

fn azure_env() -> Result<(String, String), String> {
    // 1) Runtime env / .env (development or power‑user override)
    if let (Ok(endpoint), Ok(key)) = (
        std::env::var("AZURE_OCR_ENDPOINT"),
        std::env::var("AZURE_OCR_KEY"),
    ) {
        let endpoint_trimmed = endpoint.trim();
        let key_trimmed = key.trim();
        if !endpoint_trimmed.is_empty() && !key_trimmed.is_empty() {
            return Ok((
                endpoint_trimmed.trim_end_matches('/').to_string(),
                key_trimmed.to_string(),
            ));
        }
    }

    // 2) Build‑time baked values for production builds.
    // These are injected at compile time via environment variables
    // AZURE_OCR_ENDPOINT_BUILD and AZURE_OCR_KEY_BUILD so the installer
    // works for all clients without them configuring anything.
    let endpoint_build = option_env!("AZURE_OCR_ENDPOINT_BUILD").unwrap_or("").trim();
    let key_build = option_env!("AZURE_OCR_KEY_BUILD").unwrap_or("").trim();
    if !endpoint_build.is_empty() && !key_build.is_empty() {
        return Ok((
            endpoint_build.trim_end_matches('/').to_string(),
            key_build.to_string(),
        ));
    }

    Err("AZURE_OCR_ENDPOINT / AZURE_OCR_KEY not set (and no build-time AZURE_OCR_*_BUILD configured).".to_string())
}

/// Analyzer ID for document type. Uses runtime env first (dev .env), then build-time
/// (production). Set AZURE_CU_ANALYZER_*_BUILD when building the installer so production
/// uses your custom analyzers (e.g. projectAnalyzer_...).
fn pick_analyzer_id(document_type: Option<&str>) -> String {
    let dt = document_type.unwrap_or("").trim();
    let fallback_faktura = option_env!("AZURE_CU_ANALYZER_FAKTURA_BUILD")
        .unwrap_or("")
        .trim();
    let fallback_smetka = option_env!("AZURE_CU_ANALYZER_SMETKA_BUILD")
        .unwrap_or("")
        .trim();
    let fallback_generic = option_env!("AZURE_CU_ANALYZER_GENERIC_BUILD")
        .unwrap_or("")
        .trim();
    let fallback_plata = option_env!("AZURE_CU_ANALYZER_PLATA_BUILD")
        .unwrap_or("")
        .trim();

    if dt == "faktura" {
        std::env::var("AZURE_CU_ANALYZER_FAKTURA")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .or_else(|| (!fallback_faktura.is_empty()).then(|| fallback_faktura.to_string()))
            .unwrap_or_else(|| "prebuilt-invoice".to_string())
    } else if dt == "smetka" {
        std::env::var("AZURE_CU_ANALYZER_SMETKA")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .or_else(|| (!fallback_smetka.is_empty()).then(|| fallback_smetka.to_string()))
            .unwrap_or_else(|| "prebuilt-document".to_string())
    } else if dt == "generic" {
        std::env::var("AZURE_CU_ANALYZER_GENERIC")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .or_else(|| (!fallback_generic.is_empty()).then(|| fallback_generic.to_string()))
            .unwrap_or_else(|| "prebuilt-document".to_string())
    } else if dt == "plata" {
        std::env::var("AZURE_CU_ANALYZER_PLATA")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .or_else(|| (!fallback_plata.is_empty()).then(|| fallback_plata.to_string()))
            .unwrap_or_else(|| "prebuilt-document".to_string())
    } else {
        "prebuilt-document".to_string()
    }
}

fn fetch_poll_json_via_edge(
    file_path: &str,
    document_type: Option<&str>,
    access_token: &str,
    employee_id: Option<&str>,
    app_session_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    // These parameters are kept for API compatibility but no longer used for OCR.
    let _ = (access_token, employee_id, app_session_id);

    load_env();
    let (azure_endpoint, azure_key) = azure_env()?;
    let analyzer_id = pick_analyzer_id(document_type);
    // Use Azure Content Understanding "content analyzers" REST endpoint with binary input.
    // Works with both prebuilt analyzers (e.g. "prebuilt-invoice") and your custom
    // projectAnalyzer_* IDs configured in .env.
    let analyze_url = format!(
        "{}/contentunderstanding/analyzers/{}:analyze?api-version=2025-11-01",
        azure_endpoint, analyzer_id
    );

    let bytes = fs::read(Path::new(file_path)).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "File not found.".to_string()
        } else {
            format!("Could not read file: {}", e)
        }
    })?;

    let _pages = count_pages_best_effort(file_path);

    // Content Understanding API expects JSON body with base64-encoded input, not raw binary.
    let b64 = BASE64.encode(&bytes);
    let body_json = serde_json::json!({ "inputs": [{ "data": b64 }] });
    let body_str = body_json.to_string();

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;

    // 1) Submit document to Azure Content Understanding
    let response = client
        .post(&analyze_url)
        .header("Ocp-Apim-Subscription-Key", &azure_key)
        .header("Content-Type", "application/json")
        .body(body_str)
        .send()
        .map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            "Check your internet connection and try again."
        } else {
            "Network error."
        }
        .to_string()
    })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        if body.trim().is_empty() {
            return Err(format!("OCR failed ({})", status));
        }
        return Err(body);
    }

    let op_loc = response
        .headers()
        .get("Operation-Location")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| "No Operation-Location from Azure".to_string())?
        .to_string();

    // 2) Poll Azure until the operation completes (max ~120s).
    for _ in 0..120 {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let poll_resp = client
            .get(&op_loc)
            .header("Ocp-Apim-Subscription-Key", &azure_key)
            .send()
            .map_err(|e| {
                if e.is_connect() || e.is_timeout() {
                    "Check your internet connection and try again."
                } else {
                    "Network error."
                }
                .to_string()
            })?;

        let poll_status = poll_resp.status();
        let poll_json: serde_json::Value = poll_resp
            .json()
            .map_err(|e| format!("Invalid JSON: {}", e))?;

        let status_str = poll_json
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_lowercase();

        if status_str == "succeeded" {
            return Ok(poll_json);
        }
        if status_str == "failed" {
            let err = poll_json
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error");
            return Err(format!("OCR analysis failed: {}", err));
        }

        // If Azure returns a non-success HTTP status during polling, surface it.
        if !poll_status.is_success() && status_str.is_empty() {
            return Err(format!("OCR failed ({})", poll_status));
        }
    }

    Err("OCR timed out. Try again.".to_string())
}

pub fn run_ocr_via_edge(
    file_path: &str,
    access_token: &str,
    employee_id: Option<&str>,
    app_session_id: Option<&str>,
) -> Result<OcrResult, String> {
    let poll_json_outer = fetch_poll_json_via_edge(file_path, None, access_token, employee_id, app_session_id)?;

    for _ in 0..1 {
        let poll_json = poll_json_outer.clone();
        let status_str = poll_json
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        if status_str.eq_ignore_ascii_case("succeeded") {
            let result = poll_json
                .get("result")
                .or_else(|| poll_json.get("analyzeResult"))
                .ok_or("No result")?;

            // Content Understanding returns result.contents[0].markdown plus optional pages/lines.
            let empty_contents: Vec<serde_json::Value> = Vec::new();
            let contents = result
                .get("contents")
                .and_then(|c| c.as_array())
                .unwrap_or(&empty_contents);
            let doc = contents.first();

            if let Some(doc) = doc {
                if let Some(markdown) = doc.get("markdown").and_then(|m| m.as_str()) {
                    let content = markdown.to_string();
                    let lines: Vec<OcrLine> = markdown
                        .lines()
                        .map(|t| OcrLine {
                            text: t.to_string(),
                            confidence: None,
                        })
                        .collect();
                    return Ok(OcrResult {
                        content: Some(content),
                        lines,
                    });
                }
            }

            // Fallback: no markdown, just return empty result
            return Ok(OcrResult {
                content: None,
                lines: Vec::new(),
            });
        }
        if status_str.eq_ignore_ascii_case("failed") {
            let err = poll_json
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error");
            return Err(format!("OCR analysis failed: {}", err));
        }
    }
    Err("OCR timed out. Try again.".to_string())
}

// Backwards-compatible wrapper used by Tauri commands.
// Supabase-specific arguments are no longer needed, so we pass empty values.
pub fn run_ocr(file_path: &str) -> Result<OcrResult, String> {
    run_ocr_via_edge(file_path, "", None, None)
}

/// MIS-02 built fields: CustomerName, InvoiceId, InvoiceTotal, SubTotal, DDV, VendorName, InvoiceDate, and Item/Item2..Item10 (→ single Опис).
/// Use .get("KeyName") only; if a field is missing, extraction returns default empty/0.0.
/// Document type: multiple Azure key variants (prebuilt-invoice uses DocumentType, custom may use TypeOfDocument/documentType).
const AZURE_TO_FIELD: &[(&str, &str)] = &[
    ("TypeOfDocument", "document_type"),
    ("DocumentType", "document_type"),
    ("documentType", "document_type"),
    ("Type", "document_type"),
    ("InvoiceType", "document_type"),
    ("Currency", "currency"),
    ("CurrencyCode", "currency"),
    ("VendorName", "seller_name"),
    ("CustomerName", "buyer_name"),
    ("InvoiceId", "document_number"),
    ("InvoiceTotal", "total_amount"),
    ("SubTotal", "net_amount"),
    ("DDV", "tax_amount"),
    ("InvoiceDate", "date"),
    ("DueDate", "due_date"),
    ("VendorTaxId", "seller_edb"),
    ("VendorAddress", "seller_address"),
    ("CustomerAddress", "buyer_address"),
    ("CustomerTaxId", "buyer_tax_id"),
    ("TotalTax", "tax_amount"),
    ("CurrencyCode", "currency"),
    ("PaymentTerm", "payment_method"),
    ("PurchaseOrder", "reference"),
];

/// Clean document_type so it contains only the type label, not the document number or extra fields.
/// Strips: " бр.: 123", " No. 00121", " Number", ", ЕДБ:", "Банка" junk, trailing digits, etc.
fn sanitize_document_type(raw: &str) -> String {
    // Strip Azure HTML-style comments like "<!-- PageHeader: ... -->"
    // that sometimes wrap the document type.
    let mut s = raw.to_string();
    loop {
        if let Some(start) = s.find("<!--") {
            if let Some(end_rel) = s[start + 4..].find("-->") {
                let end = start + 4 + end_rel + 3;
                s = format!("{}{}", &s[..start], &s[end..]);
            } else {
                break;
            }
        } else {
            break;
        }
    }
    let s = s.trim();
    if s.is_empty() {
        return String::new();
    }
    // Cut at " бр.:" or " бр." or " No." or " No:" (document number follows)
    let cut_br = s.find(" бр.:").or_else(|| s.find(" бр.")).or_else(|| s.find(" Бр.:")).or_else(|| s.find(" Бр."));
    let cut_no = s.find(" No.").or_else(|| s.find(" No:")).or_else(|| s.find(" NO.")).or_else(|| s.find(" Nr."));
    let cut = cut_br.or(cut_no).unwrap_or(s.len());
    let mut s = s[..cut].trim().to_string();
    // Strip " Number" / " number" (e.g. "INVOICE Number" -> "INVOICE")
    for suffix in [" Number", " number", " No ", " No"] {
        if s.ends_with(suffix) {
            s = s[..s.len().saturating_sub(suffix.len())].trim().to_string();
            break;
        }
    }
    let s = s.as_str();
    // Remove ", ЕДБ:" or " ЕДБ:" and anything after (wrong field merged in)
    let cut_edb = s.find(", ЕДБ:").or_else(|| s.find(" ЕДБ:")).or_else(|| s.find(",ЕДБ:"));
    let s = cut_edb.map(|i| s[..i].trim()).unwrap_or(s);
    // Remove trailing document number (long digit string or digits with dashes)
    let trimmed = s.trim_end_matches(|c: char| c == ' ' || c == ':');
    let without_trailing_digits = trimmed
        .trim_end_matches(|c: char| c.is_ascii_digit() || c == '-' || c == '/' || c == '.');
    let s = if without_trailing_digits.len() < trimmed.len() && !without_trailing_digits.is_empty() {
        without_trailing_digits.trim_end()
    } else {
        trimmed
    };
    s.replace("  ", " ")
        .trim()
        .trim_end_matches(|c: char| c == ':' || c == ' ')
        .to_string()
}

/// True if s looks like a valid document type (contains a known type keyword).
/// Used to reject wrong extractions like "Халк Банка сметка" or "ж.сметка".
fn looks_like_document_type(s: &str) -> bool {
    if s.is_empty() || s.len() > 60 {
        return false;
    }
    let lower = s.to_lowercase();
    let keywords = [
        "фактура",
        "faktura",
        "invoice",
        "испратница",
        "credit note",
        "добанка",
        "авансна",
        "delivery note",
        "сметка",
        "smetka",
    ];
    let has_keyword = keywords.iter().any(|k| lower.contains(k));
    // Reject text that is clearly wrong (bank line, abbreviation garbage like "ж.сметка")
    let first_two: Vec<char> = s.chars().take(2).collect();
    let single_letter_dot = first_two.len() == 2
        && first_two[0].is_alphabetic()
        && first_two[1] == '.';
    let rejected = lower.contains("банка") && !lower.starts_with("фактура")
        || single_letter_dot;
    has_keyword && !rejected
}

/// Infer document type from document text when Azure did not return it.
/// Looks for common labels (ИСПРАТНИЦА, ФАКТУРА, INVOICE, Credit note, etc.) in the first lines
/// and returns the phrase as printed (e.g. "ИСПРАТНИЦА/ФАКТУРА") so "Тип на документ" is filled.
fn infer_document_type_from_content(content: &str) -> Option<String> {
    let haystack = content.get(..1200.min(content.len())).unwrap_or(content);
    let keywords = [
        "ИСПРАТНИЦА",
        "испратница",
        "ИСЦРАТНИЦА", // common typo/OCR
        "ФАКТУРА",
        "Фактура",
        "FAKTURA",
        "faktura",
        "INVOICE",
        "invoice",
        "Credit note",
        "Credit Note",
        "Добанка",
        "Авансна",
        "AVANSNO",
        "DELIVERY NOTE",
        "Delivery note",
        "Сметка",
        "SMETKA",
        "Изводска", // summary invoice
        "Зроска",   // OCR variant / regional
    ];
    for line in haystack.lines().take(25) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let line_upper = line.to_uppercase();
        let has_keyword = keywords.iter().any(|k| {
            line.contains(k) || line_upper.contains(&k.to_uppercase())
        });
        if !has_keyword {
            continue;
        }
        // Take the line but drop trailing "БР: 123", "NO: 1-81/99066", "Nr.", "№", etc.
        let cleaned = line.trim();
        let cut = cleaned
            .find("БР:")
            .or_else(|| cleaned.find("БР "))
            .or_else(|| cleaned.find(" NO:"))
            .or_else(|| cleaned.find(" NO "))
            .or_else(|| cleaned.find("Nr."))
            .or_else(|| cleaned.find(" № "))
            .unwrap_or(cleaned.len());
        let doc_type = cleaned[..cut].trim_end_matches(|c: char| c == ' ' || c == '/');
        if !doc_type.is_empty() && doc_type.chars().count() <= 80 {
            return Some(doc_type.to_string());
        }
        if cleaned.chars().count() <= 80 && !cleaned.is_empty() {
            return Some(cleaned.to_string());
        }
        let first_part: String = cleaned.chars().take(50).collect();
        if !first_part.trim().is_empty() {
            return Some(first_part.trim().to_string());
        }
    }
    None
}

/// Strip Markdown code fences from description (e.g. ```text ... ``` or ``` ... ```).
fn sanitize_description(raw: &str) -> String {
    let s = raw.trim();
    if s.is_empty() {
        return String::new();
    }
    let s = s
        .strip_prefix("```text")
        .or_else(|| s.strip_prefix("```json"))
        .or_else(|| s.strip_prefix("```"))
        .unwrap_or(s);
    let s = s.trim_start().trim_start_matches('\n');
    let s = s.strip_suffix("```").unwrap_or(s).trim_end();
    s.trim().to_string()
}

/// Extract a complete string value from an Azure field, preferring semantic value* properties over raw content.
/// Explicitly preserves 0 so that fields like aop_52 p.2 with valueNumber: 0 show "0" in the app, not "—".
fn extract_azure_field_value(obj: &serde_json::Value) -> String {
    if obj.is_null() {
        return String::new();
    }
    // When the API returns a plain string (e.g. "sellerName": "ASTA TREJD"), use it directly.
    if let Some(s) = obj.as_str() {
        let t = s.trim();
        if !t.is_empty() && !t.eq_ignore_ascii_case("\"\"text") && !t.starts_with("\"\"") {
            return t.to_string();
        }
    }
    // Explicitly preserve numeric zero: Azure often returns valueNumber/valueInteger 0 for AOP fields;
    // ensure we never drop it so the UI shows "0" instead of "—".
    if let Some(n) = obj.get("valueNumber").or_else(|| obj.get("valueInteger")) {
        if let Some(f) = n.as_f64() {
            if f == 0.0 {
                return "0".to_string();
            }
        }
        if let Some(i) = n.as_i64() {
            if i == 0 {
                return "0".to_string();
            }
        }
    }

    let field_type = obj.get("type").and_then(|t| t.as_str());

    // Helper: safely get & trim a string child.
    fn get_trimmed<'a>(obj: &'a serde_json::Value, key: &str) -> Option<String> {
        obj.get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    }

    // Primary extraction based on Azure field.type when available.
    let primary: Option<String> = match field_type {
        Some("string") => get_trimmed(obj, "valueString"),
        Some("address") => obj
            .get("valueAddress")
            .and_then(|addr| addr.get("streetAddress"))
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        Some("date") => get_trimmed(obj, "valueDate")
            .or_else(|| get_trimmed(obj, "content"))
            .or_else(|| get_trimmed(obj, "valueString")),
        Some("time") => get_trimmed(obj, "valueTime"),
        Some("number") | Some("integer") | Some("float") => obj
            .get("valueNumber")
            .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)))
            .map(|n| n.to_string()),
        Some("currency") => {
            // Azure prebuilt-invoice currency type: use numeric amount if present.
            obj.get("valueCurrency")
                .and_then(|v| v.get("amount"))
                .and_then(|a| {
                    a.as_f64()
                        .or_else(|| a.as_str().and_then(|s| s.parse::<f64>().ok()))
                })
                .map(|n| n.to_string())
        }
        Some("object") => {
            // Doc: result.contents[0].fields can have type "object" with valueObject (e.g. AmountDue, TotalAmount).
            // Dig into valueObject for Amount.valueNumber or first valueString/valueNumber we find.
            obj.get("valueObject")
                .and_then(|vo| vo.as_object())
                .and_then(|vo| {
                    vo.get("Amount")
                        .and_then(|a| a.get("valueNumber"))
                        .and_then(|n| n.as_f64().or_else(|| n.as_i64().map(|i| i as f64)))
                        .map(|n| n.to_string())
                        .or_else(|| {
                            for (_, v) in vo {
                                let s = extract_azure_field_value(v);
                                if !s.is_empty() {
                                    return Some(s);
                                }
                            }
                            None
                        })
                })
        }
        _ => None,
    };

    // Generic fallbacks if field.type is missing or didn't yield a value.
    // Include "value" for Azure Content Understanding custom analyzer responses.
    let generic = primary
        .or_else(|| get_trimmed(obj, "valueString"))
        .or_else(|| get_trimmed(obj, "value"))
        .or_else(|| get_trimmed(obj, "value_string"))
        .or_else(|| get_trimmed(obj, "valueDate"))
        .or_else(|| get_trimmed(obj, "content"))
        .or_else(|| {
            obj.get("valueNumber").and_then(|v| {
                v.as_f64()
                    .or_else(|| v.as_i64().map(|i| i as f64))
                    .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
            }).map(|n| n.to_string())
        })
        .or_else(|| get_trimmed(obj, "valueTime"));

    // Last resort: raw OCR content.
    generic
        .or_else(|| get_trimmed(obj, "content"))
        .unwrap_or_default()
}

/// True if the string looks like an address suffix (e.g. "; PL - 93230 LODZ" or ", 1000 Skopje").
fn looks_like_address_suffix(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() {
        return true;
    }
    let lower = s.to_lowercase();
    if s.len() <= 3 && s.chars().all(|c| c.is_ascii_alphabetic()) {
        return true;
    }
    if lower.starts_with("pl ") || lower.starts_with("mk ") || lower.starts_with("de ")
        || lower.starts_with("at ") || lower.starts_with("hr ") || lower.starts_with("rs ")
    {
        return true;
    }
    if s.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
        return true;
    }
    false
}

/// True if a full line looks like an address (street or city + number).
fn looks_like_address_line(line: &str) -> bool {
    let s = line.trim();
    if s.is_empty() {
        return false;
    }
    if s
        .chars()
        .next()
        .map(|c| c.is_ascii_digit())
        .unwrap_or(false)
    {
        return true;
    }
    let lower = s.to_lowercase();
    let addr_keywords = [
        "bul", "бул", "ul", "улица", "street", "avenue", "bulevar", "булевар", "str", "road", "rd.",
        "плоштад", "plostad",
    ];
    addr_keywords
        .iter()
        .any(|kw| lower.starts_with(kw) || lower.contains(&format!(" {} ", kw)))
}

/// Insert spaces in run-together vendor/buyer names (e.g. "DSVROADDOOELSKOPJE" → "DSV ROAD DOOEL SKOPJE").
fn fix_all_caps_run_together(s: &str) -> String {
    let t = s.trim();
    if t.is_empty() || t.contains(' ') {
        return s.to_string();
    }
    if t.len() < 6 {
        return s.to_string();
    }
    let mut out = t.to_string();
    for keyword in &["DOOEL", "ДООЕЛ", "SKOPJE", "СКОПЈЕ", "ROAD", "DOO"] {
        let with_space = format!(" {}", keyword);
        out = out.replace(keyword, &with_space);
    }
    out.trim_start().to_string()
}

/// Join multi-line company names by space and collapse internal whitespace.
fn join_multiline_name(raw: &str) -> String {
    let joined = raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    // Collapse multiple spaces/tabs into a single space without changing case.
    joined
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Take only the whole company name from the API field: strip trailing "; address" or ", address" if present.
fn company_name_only(api_name: &str) -> String {
    let s = api_name.trim();
    if s.is_empty() {
        return String::new();
    }
    if let Some(pos) = s.find("; ") {
        let after = s[pos + 2..].trim();
        if looks_like_address_suffix(after) {
            return s[..pos].trim().to_string();
        }
    }
    if let Some(pos) = s.find(", ") {
        let after = s[pos + 2..].trim();
        if looks_like_address_suffix(after) {
            return s[..pos].trim().to_string();
        }
    }
    s.to_string()
}

fn is_legal_form_token(token: &str) -> bool {
    let t = token.trim().trim_end_matches('.').to_lowercase();
    matches!(
        t.as_str(),
        "doo" | "dooel" | "doel"
            | "доо" | "дооел"
            | "ad" | "a.d"
            | "ood" | "gmbh" | "shpk"
    )
}

/// Smart multi-line company name extraction:
/// - Base: first non-empty line
/// - For next lines:
///   * If line contains legal form (DOO/DOOEL/ДОО/AD/etc) -> append
///   * Else if short (<=3 words) and starts with capital and not address -> append (name continuation)
///   * Else if looks like address -> stop
///   * Otherwise -> stop
fn smart_multiline_company_name(raw: &str) -> String {
    let lines: Vec<&str> = raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() {
        return String::new();
    }
    let mut base = lines[0].to_string();

    for line in lines.iter().skip(1) {
        if looks_like_address_line(line) {
            break;
        }
        let lower = line.to_lowercase();
        let has_legal_form = lower
            .split_whitespace()
            .any(|w| is_legal_form_token(w));
        let words: Vec<&str> = line.split_whitespace().collect();
        let is_short_capitalized = words.len() <= 3
            && words
                .first()
                .and_then(|w| w.chars().next())
                .map(|c| c.is_uppercase())
                .unwrap_or(false);

        if has_legal_form || is_short_capitalized {
            if !base.ends_with(' ') {
                base.push(' ');
            }
            base.push_str(line);
        } else {
            break;
        }
    }

    company_name_only(&base)
}

/// Clean and normalize a raw company name: join multi-line values and trim/collapse whitespace.
fn clean_company_name(raw_name: &str) -> String {
    if raw_name.contains('\n') {
        return smart_multiline_company_name(raw_name);
    }
    let joined = join_multiline_name(raw_name);
    company_name_only(&joined)
}

#[cfg(debug_assertions)]
fn validate_company_name(name: &str, _label: &str) {
    let mut warnings: Vec<&str> = Vec::new();
    let trimmed = name.trim();
    if trimmed.len() < 3 {
        warnings.push("Too short (< 3 chars)");
    }
    let words: Vec<&str> = trimmed.split_whitespace().collect();
    let word_count = words.len();
    let all_caps = trimmed
        .chars()
        .filter(|c| c.is_alphabetic())
        .all(|c| !c.is_lowercase())
        && trimmed.chars().any(|c| c.is_alphabetic());
    if word_count == 1 && !all_caps {
        warnings.push("Only one word, might be truncated");
    }
    if trimmed
        .chars()
        .next()
        .map(|c| c.is_ascii_digit())
        .unwrap_or(false)
    {
        warnings.push("Starts with digit, might be address");
    }
    let lower = trimmed.to_lowercase();
    let address_keywords = ["street", "bul", "бул", "ul", "улица", "avenue", "bulevar", "булевар", "str"];
    if address_keywords.iter().any(|kw| lower.contains(kw)) {
        warnings.push("Contains address keyword, might be address");
    }
    if !warnings.is_empty() {
        // Intentionally no logging in production builds.
    }
}

/// Score a vendor candidate string using confidence and completeness.
fn score_vendor_candidate(value: &str, confidence: Option<f64>) -> f64 {
    let mut score = confidence.unwrap_or(0.5);
    let lower = value.to_lowercase();
    if lower.split_whitespace().any(|w| is_legal_form_token(w)) {
        score += 0.1;
    }
    let len_no_spaces = value.chars().filter(|c| !c.is_whitespace()).count();
    if len_no_spaces > 15 {
        score += 0.05;
    }
    score
}

/// Best vendor/seller: choose among candidate fields by confidence + completeness.
fn best_vendor_name(fields_obj: &serde_json::Map<String, serde_json::Value>) -> (String, Option<f64>) {
    let mut best_name = String::new();
    let mut best_conf: Option<f64> = None;
    let mut best_score = f64::MIN;

    // 0) Custom analyzer / Content Understanding (sellerName) – prefer when present.
    if let Some(obj) = fields_obj.get("sellerName") {
        let raw = extract_azure_field_value(obj);
        let name = clean_company_name(&raw);
        let confidence = obj.get("confidence").and_then(|c| c.as_f64());
        if !name.is_empty() {
            let score = score_vendor_candidate(&name, confidence);
            if score > best_score {
                best_score = score;
                best_name = name;
                best_conf = confidence;
            }
        }
    }

    // 1) SellerLegalName from queryFields (if available) - usually the most complete legal name.
    if let Some(obj) = fields_obj.get("SellerLegalName") {
        let raw = extract_azure_field_value(obj);
        let name = clean_company_name(&raw);
        let confidence = obj.get("confidence").and_then(|c| c.as_f64());
        if !name.is_empty() {
            let score = score_vendor_candidate(&name, confidence);
            if score > best_score {
                best_score = score;
                best_name = name;
                best_conf = confidence;
            }
        }
    }

    // 2) VendorName
    if let Some(obj) = fields_obj.get("VendorName") {
        let raw = extract_azure_field_value(obj);
        let name = clean_company_name(&raw);
        let confidence = obj.get("confidence").and_then(|c| c.as_f64());
        if !name.is_empty() {
            let score = score_vendor_candidate(&name, confidence);
            if score > best_score {
                best_score = score;
                best_name = name;
                best_conf = confidence;
            }
        }
    }

    // 3) VendorAddressRecipient
    if let Some(obj) = fields_obj.get("VendorAddressRecipient") {
        let raw = extract_azure_field_value(obj);
        let name = clean_company_name(&raw);
        let confidence = obj.get("confidence").and_then(|c| c.as_f64());
        if !name.is_empty() {
            let score = score_vendor_candidate(&name, confidence);
            if score > best_score {
                best_score = score;
                best_name = name;
                best_conf = confidence;
            }
        }
    }

    // 4) BillingAddress (sometimes holds vendor name).
    if let Some(obj) = fields_obj.get("BillingAddress") {
        let raw = extract_azure_field_value(obj);
        let name = clean_company_name(&raw);
        let confidence = obj.get("confidence").and_then(|c| c.as_f64());
        if !name.is_empty() {
            let score = score_vendor_candidate(&name, confidence);
            if score > best_score {
                best_score = score;
                best_name = name;
                best_conf = confidence;
            }
        }
    }

    // 5) Fallback: first non-address-looking line from VendorAddress.
    if best_name.is_empty() {
        if let Some(obj) = fields_obj.get("VendorAddress") {
            let raw = extract_azure_field_value(obj);
            if !raw.is_empty() {
                if let Some(first_line) = raw.lines().next() {
                    let candidate = first_line.trim();
                    if !candidate.is_empty() && !looks_like_address_suffix(candidate) {
                        let name = candidate.to_string();
                        let confidence = obj.get("confidence").and_then(|c| c.as_f64());
                        let score = score_vendor_candidate(&name, confidence);
                        if score > best_score {
                            best_name = name;
                            best_conf = confidence;
                        }
                    }
                }
            }
        }
    }

    if best_name.is_empty() {
        (String::new(), None)
    } else {
        #[cfg(debug_assertions)]
        validate_company_name(&best_name, "BestVendor");
        (best_name, best_conf)
    }
}

/// Best customer/buyer: whole company name only from API. No address lines used.
fn best_customer_name(fields_obj: &serde_json::Map<String, serde_json::Value>) -> (String, Option<f64>) {
    // Priority 0: Custom analyzer (buyerName).
    if let Some(obj) = fields_obj.get("buyerName") {
        let raw = extract_azure_field_value(obj);
        let name = clean_company_name(&raw);
        let confidence = obj.get("confidence").and_then(|c| c.as_f64());
        if !name.is_empty() {
            #[cfg(debug_assertions)]
            validate_company_name(&name, "buyerName");
            return (name, confidence);
        }
    }

    // Priority 1: CustomerName.
    if let Some(obj) = fields_obj.get("CustomerName") {
        let raw = extract_azure_field_value(obj);
        let name = clean_company_name(&raw);
        let confidence = obj.get("confidence").and_then(|c| c.as_f64());
        if !name.is_empty() {
            #[cfg(debug_assertions)]
            validate_company_name(&name, "CustomerName");
            return (name, confidence);
        }
    }

    // Priority 2: CustomerAddressRecipient (if available).
    if let Some(obj) = fields_obj.get("CustomerAddressRecipient") {
        let raw = extract_azure_field_value(obj);
        let name = clean_company_name(&raw);
        let confidence = obj.get("confidence").and_then(|c| c.as_f64());
        if !name.is_empty() {
            #[cfg(debug_assertions)]
            validate_company_name(&name, "CustomerAddressRecipient");
            return (name, confidence);
        }
    }

    // Priority 3: first non-address-looking line from CustomerAddress.
    if let Some(obj) = fields_obj.get("CustomerAddress") {
        let raw = extract_azure_field_value(obj);
        if !raw.is_empty() {
            if let Some(first_line) = raw.lines().next() {
                let candidate = first_line.trim();
                if !candidate.is_empty() && !looks_like_address_suffix(candidate) {
                    let name = candidate.to_string();
                    let confidence = obj.get("confidence").and_then(|c| c.as_f64());
                    #[cfg(debug_assertions)]
                    validate_company_name(&name, "CustomerAddress(first_line)");
                    return (name, confidence);
                }
            }
        }
    }

    (String::new(), None)
}

fn extract_field_value_and_confidence(obj: &serde_json::Value) -> (String, Option<f64>) {
    let confidence = obj.get("confidence").and_then(|c| c.as_f64());
    let value = extract_azure_field_value(obj);
    (value, confidence)
}

/// Get string from a line item subfield (Description, ProductCode, etc.).
fn item_field_string(value_obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> String {
    value_obj
        .get(key)
        .and_then(|d| d.get("valueString").or_else(|| d.get("content")).and_then(|v| v.as_str()))
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("")
        .to_string()
}

/// Get numeric/currency value from a line item subfield (Quantity, Price, etc.) as string.
fn item_field_number(value_obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> String {
    let sub = match value_obj.get(key) {
        Some(v) => v,
        None => return String::new(),
    };
    // valueNumber / valueInteger
    if let Some(n) = sub.get("valueNumber").and_then(|v| v.as_f64()) {
        return n.to_string();
    }
    if let Some(n) = sub.get("valueInteger").and_then(|v| v.as_i64()) {
        return n.to_string();
    }
    // valueCurrency.amount
    if let Some(amount) = sub
        .get("valueCurrency")
        .and_then(|c| c.get("amount"))
        .and_then(|a| a.as_f64().or_else(|| a.as_str().and_then(|s| s.parse::<f64>().ok())))
    {
        return amount.to_string();
    }
    // content / valueString as fallback
    sub.get("content")
        .or_else(|| sub.get("valueString"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_default()
}

/// MIS-02: field names for Опис (description) — one per page: Item (first page), Item2, Item3, ... Item10.
const MIS02_OPIS_FIELD_NAMES: &[&str] = &["Item", "Item2", "Item3", "Item4", "Item5", "Item6", "Item7", "Item8", "Item9", "Item10"];

/// Extract description (Опис) from MIS-02: read all Item, Item2, Item3, ... Item10 and concatenate into one string.
/// Falls back to legacy "Items" field if no Item/Item2/... values are present.
fn extract_line_items_description(fields_obj: &serde_json::Map<String, serde_json::Value>) -> (String, Option<f64>) {
    let mut parts: Vec<String> = Vec::new();
    let mut confidence: Option<f64> = None;

    for &key in MIS02_OPIS_FIELD_NAMES {
        if let Some(obj) = fields_obj.get(key) {
            let value = extract_azure_field_value(obj);
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                if confidence.is_none() {
                    confidence = obj.get("confidence").and_then(|c| c.as_f64());
                }
                parts.push(trimmed.to_string());
            }
        }
    }

    if !parts.is_empty() {
        return (parts.join("\n"), confidence);
    }

    // Fallback: legacy "Items" field (simple string or valueArray).
    let items_field = match fields_obj.get("Items") {
        Some(v) => v,
        None => return (String::new(), None),
    };
    let conf = items_field.get("confidence").and_then(|c| c.as_f64());
    if let Some(content) = items_field.get("valueString").or_else(|| items_field.get("content")) {
        if let Some(s) = content.as_str() {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return (trimmed.to_string(), conf);
            }
        }
    }
    if let Some(arr) = items_field.get("valueArray").and_then(|a| a.as_array()) {
        let mut lines: Vec<String> = Vec::new();
        for item in arr {
            let value_obj = match item.get("valueObject").and_then(|o| o.as_object()) {
                Some(o) => o,
                None => continue,
            };
            let desc = item_field_string(value_obj, "Description");
            let qty = item_field_number(value_obj, "Quantity");
            let price = item_field_number(value_obj, "Price");
            let line_parts: Vec<&str> = [desc.as_str(), qty.as_str(), price.as_str()]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect();
            if !line_parts.is_empty() {
                lines.push(line_parts.join(" | "));
            }
        }
        if !lines.is_empty() {
            return (lines.join("\n"), conf);
        }
    }
    (String::new(), conf)
}

pub fn run_ocr_invoice_via_edge(
    file_path: &str,
    document_type: Option<&str>,
    access_token: &str,
    employee_id: Option<&str>,
    app_session_id: Option<&str>,
) -> Result<OcrInvoiceResult, String> {
    let poll_json_outer =
        fetch_poll_json_via_edge(file_path, document_type, access_token, employee_id, app_session_id)?;

    for _ in 0..1 {
        let poll_json = poll_json_outer.clone();
        let status_str = poll_json
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        if status_str.eq_ignore_ascii_case("succeeded") {
            let result = poll_json
                .get("result")
                .or_else(|| poll_json.get("analyzeResult"))
                .ok_or("No result")?;

            // How many logical documents did Azure detect in this file?
            // If >1, the PDF likely contains multiple invoices/pages that should be split.
            let document_count_val = result
                .get("contents")
                .and_then(|c| c.as_array().map(|a| a.len() as u32))
                .or_else(|| {
                    result
                        .get("documents")
                        .and_then(|d| d.as_array().map(|a| a.len() as u32))
                })
                .unwrap_or(1);
            let document_count = if document_count_val > 1 {
                Some(document_count_val)
            } else {
                None
            };

            // Content Understanding uses result.contents[0]; legacy Document Intelligence used analyzeResult.documents[0].
            // Some APIs return the document at result level with result.fields directly.
            let doc = result
                .get("contents")
                .and_then(|c| c.as_array())
                .and_then(|a| a.first())
                .or_else(|| {
                    result
                        .get("documents")
                        .and_then(|d| d.as_array())
                        .and_then(|a| a.first())
                })
                .or_else(|| {
                    // Fallback: result itself is the document (e.g. has "fields" and optionally "markdown")
                    if result.get("fields").and_then(|f| f.as_object()).is_some() {
                        Some(result)
                    } else {
                        None
                    }
                });

            // Handle different model response formats:
            // - MIS-02/prebuilt-invoice: returns documents[0].fields (structured fields)
            // - prebuilt-layout: returns pages, tables, paragraphs (structured layout)
            // - prebuilt-read: returns content (text content)
            let doc_obj = doc.and_then(|d| d.as_object());
            let fields_obj = doc_obj.and_then(|d| d.get("fields").and_then(|f| f.as_object()));
            
            // Handle prebuilt-layout model (smetka - Tax Balance Sheet)
            if fields_obj.is_none() && document_type == Some("smetka") {
                // Extract content from prebuilt-layout: combine paragraphs and table content
                let mut content_parts = Vec::new();
                if let Some(doc_obj) = &doc_obj {
                    // Extract tables/paragraph-like content from Content Understanding document payload.
                    if let Some(tables) = doc_obj.get("tables").and_then(|t| t.as_array()) {
                        for table in tables {
                            if let Some(rows) = table.get("rows").and_then(|r| r.as_array()) {
                                for row in rows {
                                    if let Some(cells) = row.get("cells").and_then(|c| c.as_array()) {
                                        let row_text: Vec<String> = cells
                                            .iter()
                                            .filter_map(|cell| {
                                                cell.get("content")
                                                    .or_else(|| cell.get("markdown"))
                                                    .and_then(|c| c.as_str())
                                            })
                                            .map(|s| s.to_string())
                                            .collect();
                                        if !row_text.is_empty() {
                                            content_parts.push(row_text.join(" | "));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    // Fallback to markdown/content at document level.
                    if content_parts.is_empty() {
                        if let Some(content) = doc_obj
                            .get("markdown")
                            .or_else(|| doc_obj.get("content"))
                            .and_then(|c| c.as_str())
                        {
                            content_parts.push(content.to_string());
                        }
                    }
                }
                
                if !content_parts.is_empty() {
                    let mut fields = HashMap::new();
                    fields.insert(
                        "description".to_string(),
                        InvoiceFieldValue {
                            value: content_parts.join("\n"),
                            confidence: None,
                        },
                    );
                    fields.insert(
                        "document_type".to_string(),
                        InvoiceFieldValue {
                            value: "Даночен биланс".to_string(),
                            confidence: Some(1.0),
                        },
                    );
                    return Ok(OcrInvoiceResult {
                        invoice_data: InvoiceData { fields, source_file: None, source_file_path: None },
                        raw_azure_fields: None,
                        document_count,
                    });
                }
            }
            
            // Handle prebuilt-read model (plata, generic) - text-only extraction
            if fields_obj.is_none() {
                // Extract text content from prebuilt-read model response
                let content = doc_obj
                    .and_then(|d| {
                        d.get("markdown")
                            .or_else(|| d.get("content"))
                            .and_then(|c| c.as_str())
                    })
                    .unwrap_or("");
                if !content.trim().is_empty() {
                    let mut fields = HashMap::new();
                    fields.insert(
                        "description".to_string(),
                        InvoiceFieldValue {
                            value: content.to_string(),
                            confidence: None,
                        },
                    );
                    // Set document type based on input parameter
                    let doc_type_value = match document_type {
                        Some("plata") => "Плата",
                        Some("generic") => "ДДВ",
                        _ => "Документ",
                    };
                    fields.insert(
                        "document_type".to_string(),
                        InvoiceFieldValue {
                            value: doc_type_value.to_string(),
                            confidence: Some(1.0),
                        },
                    );
                    return Ok(OcrInvoiceResult {
                        invoice_data: InvoiceData { fields, source_file: None, source_file_path: None },
                        raw_azure_fields: None,
                        document_count,
                    });
                }
                // If no content either, return empty result
                return Ok(OcrInvoiceResult {
                    invoice_data: InvoiceData { fields: HashMap::new(), source_file: None, source_file_path: None },
                    raw_azure_fields: None,
                    document_count,
                });
            }
            
            let fields_obj = fields_obj.unwrap();
            let raw_azure_fields = doc.and_then(|d| d.get("fields")).cloned();

            let mut fields = HashMap::new();

            // First pass: copy every Azure field we can extract into our map (canonical keys).
            // This guarantees the UI gets data even if later logic is document-type specific.
            let all_azure_to_ours: &[(&str, &str)] = &[
                ("documentType", "document_type"),
                ("invoiceNumber", "invoice_number"),
                ("invoiceDate", "date"),
                ("date", "date"),
                ("dueDate", "due_date"),
                ("sellerName", "seller_name"),
                ("buyerName", "buyer_name"),
                ("companyName", "seller_name"),
                ("netAmount", "net_amount"),
                ("vat18Amount", "tax_amount"),
                ("vatTax", "tax_amount"),
                ("totalAmount", "total_amount"),
                ("currency", "currency"),
                ("description", "description"),
                ("sellerAddress", "seller_address"),
                ("sellerTaxId", "seller_tax_id"),
                ("companyTaxId", "seller_tax_id"),
                ("buyerAddress", "buyer_address"),
                ("buyerTaxId", "buyer_tax_id"),
                ("reference", "reference"),
                ("VendorName", "seller_name"),
                ("CustomerName", "buyer_name"),
                ("InvoiceTotal", "total_amount"),
                ("SubTotal", "net_amount"),
                ("TotalTax", "tax_amount"),
            ];
            for (azure_key, our_key) in all_azure_to_ours {
                if let Some(obj) = fields_obj.get(*azure_key) {
                    let (value, confidence) = extract_field_value_and_confidence(obj);
                    let mut value = value.trim().to_string();
                    if our_key == &"description" {
                        value = sanitize_description(&value);
                    }
                    if !value.is_empty() && !value.eq_ignore_ascii_case("\"\"text") && !value.starts_with("\"\"") {
                        fields.insert((*our_key).to_string(), InvoiceFieldValue { value, confidence });
                    }
                }
            }

            // Content Understanding custom analyzers (e.g. MIS invoice list, TaxBalance for smetka)
            // return domain-specific field names. Map them to our canonical keys so the review UI
            // and Excel mappings see data in the expected places.
            //
            // 1) Invoice list / MIS-style analyzer (SimpleInvoiceListAnalyzer-style fields)
            let invoice_list_mappings: &[(&str, &str)] = &[
                ("documentType", "document_type"),
                ("invoiceNumber", "invoice_number"),
                ("invoiceDate", "date"),
                ("date", "date"),
                ("dueDate", "due_date"),
                ("sellerName", "seller_name"),
                ("buyerName", "buyer_name"),
                ("netAmount", "net_amount"),
                ("vat18Amount", "tax_amount"),
                ("vatTax", "tax_amount"),
                ("totalAmount", "total_amount"),
                ("currency", "currency"),
                ("description", "description"),
            ];
            let has_invoice_list_fields = invoice_list_mappings
                .iter()
                .any(|(cu_key, _)| fields_obj.contains_key(*cu_key));
            if has_invoice_list_fields {
                for (cu_key, our_key) in invoice_list_mappings {
                    if let Some(obj) = fields_obj.get(*cu_key) {
                        let (value, confidence) = extract_field_value_and_confidence(obj);
                        let mut value = value.trim().to_string();
                        if *our_key == "description" {
                            value = sanitize_description(&value);
                        }
                        // Ignore placeholder or malformed values like "\"\"text"
                        if !value.is_empty()
                            && !value.eq_ignore_ascii_case("\"\"text")
                            && !value.starts_with("\"\"")
                        {
                            fields.insert(
                                (*our_key).to_string(),
                                InvoiceFieldValue { value, confidence },
                            );
                        }
                    }
                }
            }

            // 2) Tax Balance (Даночен биланс) analyzer for "smetka"
            if document_type == Some("smetka") {
                let smetka_mappings: &[(&str, &str)] = &[
                    ("companyName", "seller_name"),
                    ("companyTaxId", "seller_tax_id"),
                    ("sellerName", "seller_name"),
                    ("sellerTaxId", "seller_tax_id"),
                    ("description", "description"),
                    ("taxYear", "date"),
                    ("invoiceNumber", "invoice_number"),
                    ("financialResultFromPL", "net_amount"),
                    ("taxBaseAfterReduction", "net_amount"),
                    ("calculatedProfitTax", "total_amount"),
                    ("calculatedTaxAfterReduction", "total_amount"),
                    ("taxToPayOrRefund", "total_amount"),
                    ("amountToPayOrOverpaid", "total_amount"),
                    ("advanceTaxPaid", "tax_amount"),
                    ("finalTaxBase", "net_amount"),
                    ("taxBaseBeforeReduction", "net_amount"),
                ];
                for (cu_key, our_key) in smetka_mappings {
                    if let Some(obj) = fields_obj.get(*cu_key) {
                        let (value, confidence) = extract_field_value_and_confidence(obj);
                        let value = value.trim();
                        // Ignore placeholder or malformed values like "\"\"text"
                        if !value.is_empty()
                            && !value.eq_ignore_ascii_case("\"\"text")
                            && !value.starts_with("\"\"")
                        {
                            fields.insert(
                                (*our_key).to_string(),
                                InvoiceFieldValue { value: value.to_string(), confidence },
                            );
                        }
                    }
                }
                // FullTaxBalanceAnalyzer: canonical keys for metadata; aop_1..aop_59 are added by generic pass below.
                let smetka_canonical: &[(&str, &str)] = &[
                    ("companyName", "companyName"),
                    ("companyTaxId", "companyTaxId"),
                    ("taxPeriodStart", "taxPeriodStart"),
                    ("taxPeriodEnd", "taxPeriodEnd"),
                ];
                for (cu_key, tax_key) in smetka_canonical {
                    if let Some(obj) = fields_obj.get(*cu_key) {
                        let (value, confidence) = extract_field_value_and_confidence(obj);
                        let value = value.trim();
                        if !value.is_empty()
                            && !value.eq_ignore_ascii_case("\"\"text")
                            && !value.starts_with("\"\"")
                        {
                            fields.insert(
                                (*tax_key).to_string(),
                                InvoiceFieldValue { value: value.to_string(), confidence },
                            );
                        }
                    }
                }
                // When analyzer returns only taxYear (e.g. "2024"), fill tax period so UI does not show empty.
                if !fields.contains_key("taxPeriodStart") || !fields.contains_key("taxPeriodEnd") {
                    if let Some(tax_year_obj) = fields_obj.get("taxYear") {
                        let (year_val, year_conf) = extract_field_value_and_confidence(tax_year_obj);
                        let year_val = year_val.trim();
                        if year_val.len() >= 4 {
                            let y: &str =
                                if year_val.len() >= 4 { &year_val[year_val.len() - 4..] } else { &year_val };
                            if !fields.contains_key("taxPeriodStart") {
                                fields.insert(
                                    "taxPeriodStart".to_string(),
                                    InvoiceFieldValue {
                                        value: format!("01.01.{}", y),
                                        confidence: year_conf,
                                    },
                                );
                            }
                            if !fields.contains_key("taxPeriodEnd") {
                                fields.insert(
                                    "taxPeriodEnd".to_string(),
                                    InvoiceFieldValue {
                                        value: format!("31.12.{}", y),
                                        confidence: year_conf,
                                    },
                                );
                            }
                        }
                    }
                }

                // Tax Balance (Даночен биланс) table rows: nonRecognizedExpenseRows[]
                // Flatten each row and map to aop_1..aop_59 so the UI table shows values and confidence.
                if let Some(nre_rows_val) = fields_obj.get("nonRecognizedExpenseRows") {
                    if let Some(value_array) = nre_rows_val.get("valueArray").and_then(|v| v.as_array()) {
                        for (idx, item) in value_array.iter().enumerate() {
                            if let Some(val_obj) = item.get("valueObject").and_then(|v| v.as_object()) {
                                let line_number_val = val_obj
                                    .get("lineNumber")
                                    .and_then(|v| v.get("valueNumber").and_then(|v| v.as_f64()));
                                let amount_obj = val_obj.get("amount");
                                let (amount_val, amount_conf) = amount_obj
                                    .map(|o| extract_field_value_and_confidence(o))
                                    .unwrap_or((String::new(), None));
                                let amount_str = amount_val.trim();
                                let amount_display =
                                    if amount_str.is_empty() { "0".to_string() } else { amount_val.clone() };
                                if let Some(line_num) = line_number_val {
                                    let line_i = line_num as i64;
                                    if (1..=59).contains(&line_i) {
                                        let aop_key = format!("aop_{}", line_i);
                                        fields.insert(
                                            aop_key,
                                            InvoiceFieldValue {
                                                value: amount_display.clone(),
                                                confidence: amount_conf,
                                            },
                                        );
                                    }
                                }
                                if let Some(ln) = line_number_val {
                                    fields.insert(
                                        format!("nonRecognizedExpenseRows_{}_lineNumber", idx),
                                        InvoiceFieldValue {
                                            value: ln.to_string(),
                                            confidence: None,
                                        },
                                    );
                                }
                                if let Some(label_val) = val_obj
                                    .get("label")
                                    .and_then(|v| v.get("valueString").and_then(|v| v.as_str()))
                                {
                                    let label_val = label_val.trim();
                                    if !label_val.is_empty() {
                                        fields.insert(
                                            format!("nonRecognizedExpenseRows_{}_label", idx),
                                            InvoiceFieldValue {
                                                value: label_val.to_string(),
                                                confidence: None,
                                            },
                                        );
                                    }
                                }
                                fields.insert(
                                    format!("nonRecognizedExpenseRows_{}_amount", idx),
                                    InvoiceFieldValue {
                                        value: amount_display,
                                        confidence: amount_conf,
                                    },
                                );
                            }
                        }
                    }
                }

                // FullTaxBalanceAnalyzer (MacedonianProfitTaxAnalyzer.json) uses descriptive
                // field names that end with AOP1…AOP59 (e.g. "finansiskiRezultatAOP1").
                // Map any such field into our canonical "aop_1"…"aop_59" keys so that:
                // - the Преглед table (TAX_BALANCE_FORM_ROWS) is fully populated, and
                // - Excel export (TAX_BALANCE_EXCEL_ROW_MAP) sees all 59 AOP values.
                for (model_key, obj) in fields_obj {
                    if let Some(pos) = model_key.rfind("AOP") {
                        let num_str = &model_key[pos + 3..];
                        if let Ok(n) = num_str.parse::<u32>() {
                            if (1..=59).contains(&n) {
                                let aop_key = format!("aop_{}", n);
                                // Do not overwrite if something (e.g. TaxBalance02 mapping) already set it.
                                if !fields.contains_key(&aop_key) {
                                    let (value, confidence) = extract_field_value_and_confidence(obj);
                                    let value = value.trim();
                                    if !value.is_empty() || value == "0" {
                                        fields.insert(
                                            aop_key,
                                            InvoiceFieldValue {
                                                value: if value.is_empty() { "0".to_string() } else { value.to_string() },
                                                confidence,
                                            },
                                        );
                                    }
                                }
                            }
                        }
                    }
                }

                // Map TaxBalance02 summary fields to aop_1..aop_59 so the form table is populated.
                // TaxBalance02 returns summary-style fields; app schema expects aop_1..aop_59 (see MacedonianProfitTaxAnalyzer.json).
                // When using an analyzer with full aop_1..aop_59 schema, the generic pass fills all; here we fill from TaxBalance02.
                let smetka_aop_mappings: &[(&str, &str)] = &[
                    ("financialResultFromPL", "aop_1"),
                    ("nonRecognizedExpensesTotal", "aop_2"),
                    ("taxBaseBeforeReduction", "aop_39"), // III. Даночна основа (I+II) — app row 38
                    ("taxBaseReductionTotal", "aop_40"),  // IV. Намалување на даночна основа — app row 39
                    ("taxBaseAfterReduction", "aop_49"),
                    ("calculatedProfitTax", "aop_50"),
                    ("calculatedTaxReductionTotal", "aop_51"), // VII. Намалување на пресметаниот данок
                    ("calculatedTaxAfterReduction", "aop_56"),
                    ("advanceTaxPaid", "aop_57"),
                    ("overpaidCarriedForward", "aop_58"),
                    ("amountToPayOrOverpaid", "aop_59"),
                ];
                for (azure_key, aop_key) in smetka_aop_mappings {
                    if let Some(obj) = fields_obj.get(*azure_key) {
                        let (value, confidence) = extract_field_value_and_confidence(obj);
                        let value = value.trim();
                        if !value.is_empty() || value == "0" {
                            fields.insert(
                                (*aop_key).to_string(),
                                InvoiceFieldValue {
                                    value: if value.is_empty() { "0".to_string() } else { value.to_string() },
                                    confidence,
                                },
                            );
                        }
                    }
                }
            }

            // 3) DDV (VAT return) analyzer for "generic"
            if document_type == Some("generic") {
                let ddv_mappings: &[(&str, &str)] = &[
                    ("companyName", "seller_name"),
                    ("companyTaxId", "seller_tax_id"),
                    ("totalTaxBase", "net_amount"),
                    ("totalOutputVat", "tax_amount"),
                    ("vatPayableOrRefund", "total_amount"),
                    ("description", "description"),
                ];
                for (cu_key, our_key) in ddv_mappings {
                    if let Some(obj) = fields_obj.get(*cu_key) {
                        let (value, confidence) = extract_field_value_and_confidence(obj);
                        let value = value.trim();
                        if !value.is_empty()
                            && !value.eq_ignore_ascii_case("\"\"text")
                            && !value.starts_with("\"\"")
                        {
                            fields.insert(
                                (*our_key).to_string(),
                                InvoiceFieldValue { value: value.to_string(), confidence },
                            );
                        }
                    }
                }

                // Map all DDV box fields (01–19, 21–31) into our canonical keys so that:
                // - BatchReview schema (DDV_FIELDS) gets full per-box values
                // - Excel export can write each box column directly.
                let ddv_box_keys: &[&str] = &[
                    // 01–19: promет на добра и услуги (acc.# 230)
                    "prometOpshtaStapkaOsnova",
                    "prometOpshtaStapkaDDV",
                    "prometPovlastenaStapka10Osnova",
                    "prometPovlastenaStapka10DDV",
                    "prometPovlastenaStapka5Osnova",
                    "prometPovlastenaStapka5DDV",
                    "izvoz",
                    "oslobodenSOPravoNaOdbivka",
                    "oslobodenBezPravoNaOdbivka",
                    "prometNerezidentiNeOdanocliv",
                    "prometPrenesuvanjeDanocnaObvrska",
                    "primenPrometNerezidentiOpshtaOsnova",
                    "primenPrometNerezidentiOpshtaDDV",
                    "primenPrometNerezidentiPovlastenaOsnova",
                    "primenPrometNerezidentiPovlastenaDDV",
                    "primenPrometZemjaOpshtaOsnova",
                    "primenPrometZemjaOpshtaDDV",
                    "primenPrometZemjaPovlastenaOsnova",
                    "primenPrometZemjaPovlastenaDDV",
                    // 21–31: влезни испораки (acc.# 130)
                    "vlezenPrometOsnova",
                    "vlezenPrometDDV",
                    "vlezenPrometPrijamatelStranstvoOsnova",
                    "vlezenPrometPrijamatelStranstvoDDV",
                    "vlezenPrometPrijamatelZemjaOsnova",
                    "vlezenPrometPrijamatelZemjaDDV",
                    "uvozOsnova",
                    "uvozDDV",
                    "prethodniDanociZaOdbivanje",
                    "ostanatiDanociIznosiZaOdbivanje",
                    "danochenDolgIliPobaruvanje",
                ];
                for key in ddv_box_keys {
                    if let Some(obj) = fields_obj.get(*key) {
                        let (value, confidence) = extract_field_value_and_confidence(obj);
                        let value = value.trim();
                        // Preserve zeros; skip only when completely empty / missing.
                        if !value.is_empty() || value == "0" {
                            fields.insert(
                                (*key).to_string(),
                                InvoiceFieldValue {
                                    value: if value.is_empty() { "0".to_string() } else { value.to_string() },
                                    confidence,
                                },
                            );
                        }
                    }
                }

                // New MacedonianVatReturnAnalyzer returns taxPeriodStart/taxPeriodEnd instead of a single taxPeriod.
                // Compose a human-friendly "taxPeriod" and also set a stable date (end of period) for summaries.
                let mut period_label: Option<String> = None;
                let mut period_conf: Option<f64> = None;
                if let Some(start_obj) = fields_obj.get("taxPeriodStart") {
                    let (start_val, start_conf) = extract_field_value_and_confidence(start_obj);
                    let start_val = start_val.trim();
                    if !start_val.is_empty() {
                        period_label = Some(start_val.to_string());
                        period_conf = start_conf;
                    }
                }
                if let Some(end_obj) = fields_obj.get("taxPeriodEnd") {
                    let (end_val, end_conf) = extract_field_value_and_confidence(end_obj);
                    let end_val = end_val.trim();
                    if !end_val.is_empty() {
                        period_label = Some(match period_label {
                            Some(start) => format!("{} – {}", start, end_val),
                            None => end_val.to_string(),
                        });
                        period_conf = period_conf.or(end_conf);

                        // Use period end as canonical "date" so cards and history have a sortable date string.
                        fields.insert(
                            "date".to_string(),
                            InvoiceFieldValue {
                                value: end_val.to_string(),
                                confidence: end_conf,
                            },
                        );
                    }
                }
                if let Some(label) = period_label {
                    fields.insert(
                        "taxPeriod".to_string(),
                        InvoiceFieldValue {
                            value: label,
                            confidence: period_conf,
                        },
                    );
                }

                // Flatten periodRows (VAT period table) so UI can show them
                // and, when box totals are missing, derive them by summing all months.
                use std::collections::HashMap as StdHashMap;
                let mut ddv_totals: StdHashMap<String, f64> = StdHashMap::new();

                if let Some(rows_val) = fields_obj.get("periodRows") {
                    if let Some(arr) = rows_val.get("valueArray").and_then(|v| v.as_array()) {
                        for (idx, item) in arr.iter().enumerate() {
                            if let Some(val_obj) = item.get("valueObject").and_then(|v| v.as_object()) {
                                for (sub_key, sub_val) in val_obj {
                                    // 1) Keep full periodRows_* fields for debug/advanced use.
                                    if let Some(v_str) = sub_val.get("valueString").and_then(|v| v.as_str()) {
                                        let v = v_str.trim();
                                        if !v.is_empty() {
                                            fields.insert(
                                                format!("periodRows_{}_{}", idx, sub_key),
                                                InvoiceFieldValue {
                                                    value: v.to_string(),
                                                    confidence: sub_val.get("confidence").and_then(|c| c.as_f64()),
                                                },
                                            );
                                        }
                                    } else if let Some(n) = sub_val.get("valueNumber").and_then(|v| v.as_f64()) {
                                        fields.insert(
                                            format!("periodRows_{}_{}", idx, sub_key),
                                            InvoiceFieldValue {
                                                value: n.to_string(),
                                                confidence: sub_val.get("confidence").and_then(|c| c.as_f64()),
                                            },
                                        );
                                    }

                                    // 2) If this column is one of the DDV box keys, accumulate totals across all months.
                                    if ddv_box_keys.iter().any(|k| k == &sub_key.as_str()) {
                                        let mut numeric: Option<f64> = sub_val
                                            .get("valueNumber")
                                            .and_then(|v| v.as_f64());
                                        if numeric.is_none() {
                                            if let Some(v_str) = sub_val.get("valueString").and_then(|v| v.as_str())
                                            {
                                                let cleaned = v_str
                                                    .trim()
                                                    .replace('.', "")
                                                    .replace(',', ".");
                                                if let Ok(n) = cleaned.parse::<f64>() {
                                                    numeric = Some(n);
                                                }
                                            }
                                        }
                                        if let Some(n) = numeric {
                                            let entry = ddv_totals
                                                .entry(sub_key.clone())
                                                .or_insert(0.0);
                                            *entry += n;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Backfill DDV box totals when direct fields are missing or empty.
                for (k, total) in ddv_totals {
                    let key = k.to_string();
                    let needs_fill = match fields.get(&key) {
                        None => true,
                        Some(existing) => existing.value.trim().is_empty(),
                    };
                    if needs_fill {
                        fields.insert(
                            key,
                            InvoiceFieldValue {
                                value: format!("{}", total),
                                confidence: None,
                            },
                        );
                    }
                }

                // Compute summary fields from box values when analyzer does not return them.
                let total_tax_base_keys: &[&str] = &[
                    "prometOpshtaStapkaOsnova",
                    "prometPovlastenaStapka10Osnova",
                    "prometPovlastenaStapka5Osnova",
                    "izvoz",
                    "oslobodenSOPravoNaOdbivka",
                    "oslobodenBezPravoNaOdbivka",
                    "prometNerezidentiNeOdanocliv",
                    "prometPrenesuvanjeDanocnaObvrska",
                    "primenPrometNerezidentiOpshtaOsnova",
                    "primenPrometNerezidentiPovlastenaOsnova",
                    "primenPrometZemjaOpshtaOsnova",
                    "primenPrometZemjaPovlastenaOsnova",
                ];
                let total_output_vat_keys: &[&str] = &[
                    "prometOpshtaStapkaDDV",
                    "prometPovlastenaStapka10DDV",
                    "prometPovlastenaStapka5DDV",
                    "primenPrometNerezidentiOpshtaDDV",
                    "primenPrometNerezidentiPovlastenaDDV",
                    "primenPrometZemjaOpshtaDDV",
                    "primenPrometZemjaPovlastenaDDV",
                ];
                let total_input_vat_keys: &[&str] = &[
                    "vlezenPrometDDV",
                    "vlezenPrometPrijamatelStranstvoDDV",
                    "vlezenPrometPrijamatelZemjaDDV",
                    "uvozDDV",
                ];

                let has_any_data = fields.values().any(|v| !v.value.trim().is_empty());

                if !fields.contains_key("totalTaxBase") || fields.get("totalTaxBase").map(|f| f.value.trim().is_empty()).unwrap_or(true) {
                    let sum: f64 = total_tax_base_keys
                        .iter()
                        .map(|k| fields.get(*k).map(|f| parse_ddv_amt(&f.value)).unwrap_or(0.0))
                        .sum();
                    if sum != 0.0 || has_any_data {
                        fields.insert(
                            "totalTaxBase".to_string(),
                            InvoiceFieldValue {
                                value: format!("{}", sum as i64),
                                confidence: None,
                            },
                        );
                    }
                }

                if !fields.contains_key("totalOutputVat") || fields.get("totalOutputVat").map(|f| f.value.trim().is_empty()).unwrap_or(true) {
                    let sum: f64 = total_output_vat_keys
                        .iter()
                        .map(|k| fields.get(*k).map(|f| parse_ddv_amt(&f.value)).unwrap_or(0.0))
                        .sum();
                    if sum != 0.0 || has_any_data {
                        fields.insert(
                            "totalOutputVat".to_string(),
                            InvoiceFieldValue {
                                value: format!("{}", sum as i64),
                                confidence: None,
                            },
                        );
                    }
                }

                if !fields.contains_key("totalInputVat") || fields.get("totalInputVat").map(|f| f.value.trim().is_empty()).unwrap_or(true) {
                    let sum: f64 = total_input_vat_keys
                        .iter()
                        .map(|k| fields.get(*k).map(|f| parse_ddv_amt(&f.value)).unwrap_or(0.0))
                        .sum();
                    if sum != 0.0 || has_any_data {
                        fields.insert(
                            "totalInputVat".to_string(),
                            InvoiceFieldValue {
                                value: format!("{}", sum as i64),
                                confidence: None,
                            },
                        );
                    }
                }

                if !fields.contains_key("vatPayableOrRefund") || fields.get("vatPayableOrRefund").map(|f| f.value.trim().is_empty()).unwrap_or(true) {
                    let box31 = fields.get("danochenDolgIliPobaruvanje").map(|f| parse_ddv_amt(&f.value)).unwrap_or(0.0);
                    let out = fields.get("totalOutputVat").map(|f| parse_ddv_amt(&f.value)).unwrap_or(0.0);
                    let inp = fields.get("totalInputVat").map(|f| parse_ddv_amt(&f.value)).unwrap_or(0.0);
                    let value = if box31 != 0.0 {
                        box31
                    } else if out != 0.0 || inp != 0.0 {
                        out - inp
                    } else {
                        0.0
                    };
                    if value != 0.0 || box31 != 0.0 || out != 0.0 || inp != 0.0 {
                        fields.insert(
                            "vatPayableOrRefund".to_string(),
                            InvoiceFieldValue {
                                value: format!("{}", value as i64),
                                confidence: None,
                            },
                        );
                    }
                }

                // Default Опис (description) when empty so the card and export have a label.
                let desc_empty = fields
                    .get("description")
                    .map(|f| f.value.trim().is_empty())
                    .unwrap_or(true);
                if desc_empty {
                    let period = fields.get("taxPeriod").map(|f| f.value.as_str()).unwrap_or("");
                    let default_desc = if period.is_empty() {
                        "ДДВ извештај".to_string()
                    } else {
                        format!("ДДВ извештај – {}", period)
                    };
                    fields.insert(
                        "description".to_string(),
                        InvoiceFieldValue {
                            value: default_desc,
                            confidence: None,
                        },
                    );
                }
            }

            // 4) PayRoll analyzer for "plata"
            if document_type == Some("plata") {
                // Support both the older analyzer (totalGrossSalary/totalNetSalary/totalPayrollCost)
                // and the new MacedonianPayrollAnalyzer (brutoPlata, vkupnaNetoPlata, contribution rows).

                // Map new schema fields into our canonical payroll summary keys.
                if let Some(obj) = fields_obj.get("brutoPlata") {
                    let (value, confidence) = extract_field_value_and_confidence(obj);
                    let value = value.trim();
                    if !value.is_empty() || value == "0" {
                        fields.insert(
                            "totalGrossSalary".to_string(),
                            InvoiceFieldValue {
                                value: if value.is_empty() { "0".to_string() } else { value.to_string() },
                                confidence,
                            },
                        );
                    }
                }
                if let Some(obj) = fields_obj.get("vkupnaNetoPlata") {
                    let (value, confidence) = extract_field_value_and_confidence(obj);
                    let value = value.trim();
                    if !value.is_empty() || value == "0" {
                        fields.insert(
                            "totalNetSalary".to_string(),
                            InvoiceFieldValue {
                                value: if value.is_empty() { "0".to_string() } else { value.to_string() },
                                confidence,
                            },
                        );
                    }
                }
                // Compute total payroll cost as bruto + all contributions + personal tax when present.
                if let Some(bruto) = fields
                    .get("totalGrossSalary")
                    .and_then(|f| f.value.replace(',', "").parse::<f64>().ok())
                {
                    let mut total_cost = bruto;
                    let contrib_keys = [
                        "pridonesPIO",
                        "pridonesZdravstvo",
                        "pridonesProfesionalnoZaboluvanje",
                        "pridonesVrabotuvanje",
                        "personalenDanok",
                    ];
                    for k in &contrib_keys {
                        if let Some(obj) = fields_obj.get(*k) {
                            let (val, _) = extract_field_value_and_confidence(obj);
                            if let Ok(n) = val.replace(',', "").trim().parse::<f64>() {
                                total_cost += n;
                            }
                        }
                    }
                    fields.insert(
                        "totalPayrollCost".to_string(),
                        InvoiceFieldValue {
                            value: total_cost.to_string(),
                            confidence: None,
                        },
                    );
                }
                // Map declarationPeriod → year (used by Excel profiles and cards) and keep declarationPeriod for schema.
                if let Some(obj) = fields_obj.get("declarationPeriod") {
                    let (value, confidence) = extract_field_value_and_confidence(obj);
                    let value = value.trim();
                    if !value.is_empty() {
                        let fv = InvoiceFieldValue { value: value.to_string(), confidence };
                        fields.insert("declarationPeriod".to_string(), fv.clone());
                        fields.insert("year".to_string(), fv.clone());
                        fields.insert("date".to_string(), fv);
                    }
                }
                // Copy companyName, companyTaxId, brojVraboteni from analyzer into fields (Plata schema).
                for (cu_key, our_key) in &[
                    ("companyName", "companyName"),
                    ("companyTaxId", "companyTaxId"),
                    ("brojVraboteni", "brojVraboteni"),
                ] {
                    if let Some(obj) = fields_obj.get(*cu_key) {
                        let (value, confidence) = extract_field_value_and_confidence(obj);
                        let value = value.trim();
                        if !value.is_empty() || (value == "0" && *our_key == "brojVraboteni") {
                            fields.insert(
                                (*our_key).to_string(),
                                InvoiceFieldValue {
                                    value: if value.is_empty() { "0".to_string() } else { value.to_string() },
                                    confidence,
                                },
                            );
                        }
                    }
                }

                let payroll_mappings: &[(&str, &str)] = &[
                    ("year", "date"),
                    ("companyName", "seller_name"),
                    ("totalGrossSalary", "total_amount"),
                    ("totalNetSalary", "net_amount"),
                    ("totalPayrollCost", "tax_amount"),
                    ("description", "description"),
                ];
                for (cu_key, our_key) in payroll_mappings {
                    if let Some(obj) = fields_obj.get(*cu_key) {
                        let (value, confidence) = extract_field_value_and_confidence(obj);
                        let value = value.trim();
                        if !value.is_empty()
                            && !value.eq_ignore_ascii_case("\"\"text")
                            && !value.starts_with("\"\"")
                        {
                            fields.insert(
                                (*our_key).to_string(),
                                InvoiceFieldValue { value: value.to_string(), confidence },
                            );
                        }
                    }
                }
                // Flatten monthlyRows so UI can show each month's data
                if let Some(rows_val) = fields_obj.get("monthlyRows") {
                    if let Some(arr) = rows_val.get("valueArray").and_then(|v| v.as_array()) {
                        for (idx, item) in arr.iter().enumerate() {
                            if let Some(val_obj) = item.get("valueObject").and_then(|v| v.as_object()) {
                                for (sub_key, sub_val) in val_obj {
                                    if let Some(v_str) = sub_val.get("valueString").and_then(|v| v.as_str()) {
                                        let v = v_str.trim();
                                        if !v.is_empty() {
                                            fields.insert(
                                                format!("monthlyRows_{}_{}", idx, sub_key),
                                                InvoiceFieldValue { value: v.to_string(), confidence: sub_val.get("confidence").and_then(|c| c.as_f64()) },
                                            );
                                        }
                                    } else if let Some(n) = sub_val.get("valueNumber").and_then(|v| v.as_f64()) {
                                        fields.insert(
                                            format!("monthlyRows_{}_{}", idx, sub_key),
                                            InvoiceFieldValue { value: n.to_string(), confidence: sub_val.get("confidence").and_then(|c| c.as_f64()) },
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Extract all mapped fields from Azure, including Currency and TypeOfDocument
            for (azure_key, our_key) in AZURE_TO_FIELD {
                if *our_key == "seller_name" || *our_key == "buyer_name" {
                    continue;
                }
                if let Some(obj) = fields_obj.get(*azure_key) {
                    let (value, confidence) = extract_field_value_and_confidence(obj);
                    // Only insert if value is not empty
                    if !value.trim().is_empty() {
                        fields.insert(
                            (*our_key).to_string(),
                            InvoiceFieldValue { value, confidence },
                        );
                    }
                }
            }
            // So existing UI/Excel mappings for "invoice_number" still get the value.
            if let Some(doc_num) = fields.get("document_number") {
                if !fields.contains_key("invoice_number") {
                    fields.insert(
                        "invoice_number".to_string(),
                        InvoiceFieldValue {
                            value: doc_num.value.clone(),
                            confidence: doc_num.confidence,
                        },
                    );
                }
            }
            let (vendor_name, vendor_conf) = best_vendor_name(fields_obj);
            let need_seller = fields.get("seller_name").map(|f| f.value.trim().is_empty()).unwrap_or(true);
            if need_seller && !vendor_name.is_empty() {
                let name = fix_all_caps_run_together(&vendor_name);
                fields.insert(
                    "seller_name".to_string(),
                    InvoiceFieldValue {
                        value: name,
                        confidence: vendor_conf,
                    },
                );
            }
            let (customer_name, customer_conf) = best_customer_name(fields_obj);
            let need_buyer = fields.get("buyer_name").map(|f| f.value.trim().is_empty()).unwrap_or(true);
            if need_buyer && !customer_name.is_empty() {
                let name = fix_all_caps_run_together(&customer_name);
                fields.insert(
                    "buyer_name".to_string(),
                    InvoiceFieldValue {
                        value: name,
                        confidence: customer_conf,
                    },
                );
            }
            // Items → опис (description).
            // For standard invoices we build a long narrative from line items / markdown.
            // For Даночен биланс (smetka), ДДВ (generic) and Плати (plata) we SKIP this,
            // because the full markdown of the form is huge and useless as a single "Опис".
            if !fields.contains_key("description") {
                let skip_auto_description = matches!(document_type, Some("smetka") | Some("generic") | Some("plata"));
                if !skip_auto_description {
                    let (mut description, mut desc_confidence) = extract_line_items_description(fields_obj);
                    if description.is_empty() {
                        if let Some(content) = doc_obj
                            .and_then(|d| {
                                d.get("markdown")
                                    .or_else(|| d.get("content"))
                                    .and_then(|c| c.as_str())
                            })
                        {
                            let trimmed = content.trim();
                            if !trimmed.is_empty() {
                                description = trimmed.to_string();
                                desc_confidence = None;
                            }
                        }
                    }
                    description = sanitize_description(&description);
                    if !description.trim().is_empty() {
                        fields.insert(
                            "description".to_string(),
                            InvoiceFieldValue {
                                value: description,
                                confidence: desc_confidence,
                            },
                        );
                    }
                }
            } else if let Some(desc_fv) = fields.get_mut("description") {
                desc_fv.value = sanitize_description(&desc_fv.value);
            }
            // Currency: Try to extract from Currency field first (already done above), 
            // then fallback to valueCurrency.currencyCode from amount fields
            if !fields.contains_key("currency") {
                for key in &["InvoiceTotal", "SubTotal", "TotalTax"] {
                    if let Some(obj) = fields_obj.get(*key) {
                        let cur = obj
                            .get("valueCurrency")
                            .and_then(|v| v.get("currencyCode").and_then(|c| c.as_str()))
                            .or_else(|| {
                                obj.get("content")
                                    .and_then(|c| c.get("currencyCode").and_then(|c| c.as_str()))
                            });
                        if let Some(s) = cur {
                            fields.insert(
                                "currency".to_string(),
                                InvoiceFieldValue {
                                    value: s.to_string(),
                                    confidence: obj.get("confidence").and_then(|c| c.as_f64()),
                                },
                            );
                            break;
                        }
                    }
                }
            }
            // Keep Azure's own document type (TypeOfDocument / DocumentType / documentType) if provided.
            // If still missing, infer from document text (e.g. "ИСПРАТНИЦА/ФАКТУРА" at top of PDF).
            let doc_type_empty = fields
                .get("document_type")
                .map(|f| f.value.trim().is_empty())
                .unwrap_or(true);
            if doc_type_empty {
                if let Some(content) = doc_obj.and_then(|d| {
                    d.get("markdown")
                        .or_else(|| d.get("content"))
                        .and_then(|c| c.as_str())
                }) {
                    if let Some(inferred) = infer_document_type_from_content(content) {
                        let cleaned = sanitize_document_type(&inferred);
                        if !cleaned.is_empty() {
                            fields.insert(
                                "document_type".to_string(),
                                InvoiceFieldValue {
                                    value: cleaned,
                                    confidence: None,
                                },
                            );
                        }
                    }
                }
            }
            // Normalize document_type: only the type label, no number or ЕДБ (OCR often merges them)
            if let Some(fv) = fields.get_mut("document_type") {
                fv.value = sanitize_document_type(&fv.value);
            }
            // If document_type is empty or clearly wrong (e.g. "Халк Банка сметка", "ж.сметка"), try inference from content
            let doc_type_ok = fields
                .get("document_type")
                .map(|f| looks_like_document_type(&f.value))
                .unwrap_or(false);
            if !doc_type_ok {
                if let Some(content) = doc_obj.and_then(|d| {
                    d.get("markdown")
                        .or_else(|| d.get("content"))
                        .and_then(|c| c.as_str())
                }) {
                    if let Some(inferred) = infer_document_type_from_content(content) {
                        let cleaned = sanitize_document_type(&inferred);
                        if looks_like_document_type(&cleaned) {
                            fields.insert(
                                "document_type".to_string(),
                                InvoiceFieldValue {
                                    value: cleaned,
                                    confidence: None,
                                },
                            );
                        }
                    }
                }
            }
            // Generic extraction: add any model fields not yet mapped (e.g. Предмет, Даночен биланс for other doc types).
            // Exclude Item, Item2..Item10 and Items (they are merged into description/Опис),
            // and nonRecognizedExpenseRows (handled explicitly for smetka above).
            let mapped_azure_keys: std::collections::HashSet<&str> = AZURE_TO_FIELD
                .iter()
                .map(|(k, _)| *k)
                .chain(std::iter::once("Items"))
                .chain(std::iter::once("nonRecognizedExpenseRows"))
                .chain(std::iter::once("periodRows"))
                .chain(std::iter::once("monthlyRows"))
                .chain(MIS02_OPIS_FIELD_NAMES.iter().copied())
                .collect();
            for (model_key, obj) in fields_obj {
                if mapped_azure_keys.contains(model_key.as_str()) {
                    continue;
                }
                // Normalize Azure keys like "aop_45 p.2" or "AOP_52 p.2" (page suffix) to lowercase "aop_45"/"aop_52" so UI schema keys match.
                let canonical_key: String = if model_key.to_lowercase().starts_with("aop_") {
                    model_key
                        .split_whitespace()
                        .next()
                        .unwrap_or(model_key)
                        .to_lowercase()
                } else {
                    model_key.to_string()
                };
                if mapped_azure_keys.contains(canonical_key.as_str()) {
                    continue;
                }
                let (value, confidence) = extract_field_value_and_confidence(obj);
                let value = value.trim();
                // Keep "0" so scanned zero is never stored as empty; skip only placeholder or malformed values.
                let is_zero = value == "0";
                if !is_zero
                    && (value.is_empty()
                        || value.eq_ignore_ascii_case("\"\"text")
                        || (model_key == "description" && value.starts_with("\"\"")))
                {
                    continue;
                }
                let value = if model_key == "description" {
                    sanitize_description(&value).into()
                } else {
                    value.to_string()
                };
                fields.insert(canonical_key, InvoiceFieldValue { value, confidence });
            }
            return Ok(OcrInvoiceResult {
                invoice_data: InvoiceData { fields, source_file: None, source_file_path: None },
                raw_azure_fields,
                document_count,
            });
        }
        if status_str.eq_ignore_ascii_case("failed") {
            let err = poll_json
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error");
            return Err(format!("OCR analysis failed: {}", err));
        }
    }
    Err("OCR timed out. Try again.".to_string())
}

// Backwards-compatible wrapper used by Tauri commands.
// Supabase-specific arguments are no longer needed, so we pass empty values.
pub fn run_ocr_invoice(
    file_path: &str,
    document_type: Option<&str>,
) -> Result<OcrInvoiceResult, String> {
    run_ocr_invoice_via_edge(file_path, document_type, "", None, None)
}
