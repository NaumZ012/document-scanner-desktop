use crate::types::{InvoiceData, InvoiceFieldValue, OcrLine, OcrResult};
use reqwest::blocking::Client;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

fn load_env() {
    let _ = dotenvy::dotenv();
}

pub fn run_ocr(file_path: &str) -> Result<OcrResult, String> {
    load_env();
    let key = std::env::var("AZURE_OCR_KEY").map_err(|_| "AZURE_OCR_KEY not set in .env")?;
    let endpoint = std::env::var("AZURE_OCR_ENDPOINT")
        .map_err(|_| "AZURE_OCR_ENDPOINT not set in .env")?;
    let endpoint = endpoint.trim_end_matches('/');
    let url = format!(
        "{}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30",
        endpoint
    );

    let bytes = fs::read(Path::new(file_path)).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "File not found.".to_string()
        } else {
            format!("Could not read file: {}", e)
        }
    })?;

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(&url)
        .header("Ocp-Apim-Subscription-Key", &key)
        .header("Content-Type", "application/octet-stream")
        .body(bytes)
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
        return Err(format!(
            "OCR failed ({}): {}",
            status,
            if body.is_empty() {
                "Invalid key or endpoint?"
            } else {
                body.as_str()
            }
        ));
    }

    let get_result_url = response
        .headers()
        .get("Operation-Location")
        .and_then(|v| v.to_str().ok())
        .ok_or("No Operation-Location in response")?
        .to_string();

    // Poll for result
    for _ in 0..60 {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let poll_resp = client
            .get(&get_result_url)
            .header("Ocp-Apim-Subscription-Key", &key)
            .send()
            .map_err(|e| e.to_string())?;
        let poll_json: serde_json::Value =
            poll_resp.json().map_err(|e| format!("Invalid JSON: {}", e))?;
        let status_str = poll_json
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        if status_str == "succeeded" {
            let result = poll_json.get("analyzeResult").ok_or("No analyzeResult")?;
            let empty_pages: Vec<serde_json::Value> = vec![];
            let pages = result.get("pages").and_then(|p| p.as_array()).unwrap_or(&empty_pages);
            let mut lines: Vec<OcrLine> = Vec::new();
            for page in pages {
                let empty_lines: Vec<serde_json::Value> = vec![];
                let page_lines = page.get("lines").and_then(|l| l.as_array()).unwrap_or(&empty_lines);
                for line in page_lines {
                    let text = line
                        .get("content")
                        .and_then(|c| c.as_str())
                        .unwrap_or("")
                        .to_string();
                    let confidence = line.get("confidence").and_then(|c| c.as_f64());
                    lines.push(OcrLine { text, confidence });
                }
            }
            let content = lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n");
            return Ok(OcrResult {
                content: Some(content.clone()),
                lines,
            });
        }
        if status_str == "failed" {
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

/// MIS-01 built fields: CustomerName, InvoiceId, InvoiceTotal, SubTotal, DDV, VendorName, InvoiceDate, Items (→ description).
/// Use .get("KeyName") only; if a field is missing, extraction returns default empty/0.0.
const AZURE_TO_FIELD: &[(&str, &str)] = &[
    ("TypeOfDocument", "document_type"),
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

/// Extract a complete string value from an Azure field, preferring semantic value* properties over raw content.
fn extract_azure_field_value(obj: &serde_json::Value) -> String {
    if obj.is_null() {
        return String::new();
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
            .and_then(|v| v.as_f64())
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
        _ => None,
    };

    // Generic fallbacks if field.type is missing or didn't yield a value.
    let generic = primary
        .or_else(|| get_trimmed(obj, "valueString"))
        .or_else(|| get_trimmed(obj, "valueDate"))
        .or_else(|| get_trimmed(obj, "content"))
        .or_else(|| {
            obj.get("valueNumber")
                .and_then(|v| v.as_f64())
                .map(|n| n.to_string())
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
fn validate_company_name(name: &str, label: &str) {
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
        eprintln!(
            "[ocr] Warning: {} looks suspicious as company name: '{}' ({:?})",
            label, trimmed, warnings
        );
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

/// Extract description (опис) from Azure Items field.
/// Handles both structured (valueArray with Description/Quantity/Price) and simple string formats.
fn extract_line_items_description(fields_obj: &serde_json::Map<String, serde_json::Value>) -> (String, Option<f64>) {
    let items_field = match fields_obj.get("Items") {
        Some(v) => v,
        None => {
            #[cfg(debug_assertions)]
            eprintln!("[ocr] No Items field found in invoice");
            return (String::new(), None);
        }
    };
    let confidence = items_field.get("confidence").and_then(|c| c.as_f64());
    
    // First, try to get Items as a simple string field (valueString or content).
    if let Some(content) = items_field.get("valueString").or_else(|| items_field.get("content")) {
        if let Some(s) = content.as_str() {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                #[cfg(debug_assertions)]
                eprintln!("[ocr] Items field is a simple string: {} chars", trimmed.len());
                return (trimmed.to_string(), confidence);
            }
        }
    }
    
    // Otherwise, try structured format: valueArray with Description/Quantity/Price per item.
    let value_array = match items_field.get("valueArray").and_then(|a| a.as_array()) {
        Some(arr) => arr,
        None => {
            #[cfg(debug_assertions)]
            eprintln!("[ocr] Items field has no valueArray and no string content");
            return (String::new(), confidence);
        }
    };
    if value_array.is_empty() {
        #[cfg(debug_assertions)]
        eprintln!("[ocr] Items valueArray is empty");
        return (String::new(), confidence);
    }
    let mut lines: Vec<String> = Vec::with_capacity(value_array.len());
    for item in value_array {
        let value_obj = match item.get("valueObject").and_then(|o| o.as_object()) {
            Some(o) => o,
            None => continue,
        };
        let desc = item_field_string(value_obj, "Description");
        let qty = item_field_number(value_obj, "Quantity");
        let price = item_field_number(value_obj, "Price");
        // Build one line per item: "Description | Quantity | Price" (omit empty parts).
        let parts: Vec<&str> = [desc.as_str(), qty.as_str(), price.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect();
        if parts.is_empty() {
            continue;
        }
        lines.push(parts.join(" | "));
    }
    #[cfg(debug_assertions)]
    {
        if lines.is_empty() {
            eprintln!("[ocr] Warning: Line items have no Description/Quantity/Price");
        } else {
            eprintln!("[ocr] Found {} line item(s) in structured format", lines.len());
        }
    }
    let combined = lines.join("\n");
    (combined, confidence)
}

pub fn run_ocr_invoice(file_path: &str, document_type: Option<&str>) -> Result<InvoiceData, String> {
    load_env();
    let key = std::env::var("AZURE_OCR_KEY").map_err(|_| "AZURE_OCR_KEY not set in .env")?;
    let endpoint = std::env::var("AZURE_OCR_ENDPOINT")
        .map_err(|_| "AZURE_OCR_ENDPOINT not set in .env")?;
    let endpoint = endpoint.trim_end_matches('/');
    
    // Use MIS-01 custom model ONLY for invoices (faktura)
    // Each other document type uses a separate Azure prebuilt model:
    // - smetka (Даночен Биланс/Tax Balance Sheet) → prebuilt-layout (structured forms with tables)
    // - generic (ДДВ/VAT) → prebuilt-read (general text extraction)
    // - plata (Плати/Payments) → prebuilt-read (general text extraction)
    let url = match document_type {
        Some("faktura") => {
            // Custom trained model MIS-01 (Macedonian invoices); schema is defined by the model.
            format!(
                "{}/documentintelligence/documentModels/MIS-01:analyze?api-version=2024-11-30&locale=mk-MK",
                endpoint
            )
        }
        Some("smetka") => {
            // Prebuilt layout model for Tax Balance Sheet (Даночен Биланс)
            // This model extracts structured content including tables, forms, and text
            format!(
                "{}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30",
                endpoint
            )
        }
        Some("generic") => {
            // Prebuilt read model for VAT documents (ДДВ)
            // This model extracts text content from any document format
            format!(
                "{}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30",
                endpoint
            )
        }
        Some("plata") => {
            // Prebuilt read model for Payment/Salary documents (Плати)
            // This model extracts text content from any document format
            format!(
                "{}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30",
                endpoint
            )
        }
        _ => {
            // Default fallback: use prebuilt-read for unknown document types
            format!(
                "{}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30",
                endpoint
            )
        }
    };

    let bytes = fs::read(Path::new(file_path)).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "File not found.".to_string()
        } else {
            format!("Could not read file: {}", e)
        }
    })?;

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(&url)
        .header("Ocp-Apim-Subscription-Key", &key)
        .header("Content-Type", "application/octet-stream")
        .body(bytes)
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
        return Err(format!(
            "OCR failed ({}): {}",
            status,
            if body.is_empty() {
                "Invalid key or endpoint?"
            } else {
                body.as_str()
            }
        ));
    }

    let get_result_url = response
        .headers()
        .get("Operation-Location")
        .and_then(|v| v.to_str().ok())
        .ok_or("No Operation-Location in response")?
        .to_string();

    for _ in 0..60 {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let poll_resp = client
            .get(&get_result_url)
            .header("Ocp-Apim-Subscription-Key", &key)
            .send()
            .map_err(|e| e.to_string())?;
        let poll_json: serde_json::Value =
            poll_resp.json().map_err(|e| format!("Invalid JSON: {}", e))?;
        let status_str = poll_json
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        if status_str == "succeeded" {
            let result = poll_json.get("analyzeResult").ok_or("No analyzeResult")?;
            let doc = result
                .get("documents")
                .and_then(|d| d.as_array())
                .and_then(|a| a.first());
            
            // Handle different model response formats:
            // - MIS-01/prebuilt-invoice: returns documents[0].fields (structured fields)
            // - prebuilt-layout: returns pages, tables, paragraphs (structured layout)
            // - prebuilt-read: returns content (text content)
            let fields_obj = doc.and_then(|d| d.get("fields").and_then(|f| f.as_object()));
            
            // Handle prebuilt-layout model (smetka - Tax Balance Sheet)
            if fields_obj.is_none() && document_type == Some("smetka") {
                // Extract content from prebuilt-layout: combine paragraphs and table content
                let mut content_parts = Vec::new();
                
                // Extract paragraphs
                if let Some(paragraphs) = result.get("paragraphs").and_then(|p| p.as_array()) {
                    for para in paragraphs {
                        if let Some(text) = para.get("content").and_then(|c| c.as_str()) {
                            content_parts.push(text.to_string());
                        }
                    }
                }
                
                // Extract tables
                if let Some(tables) = result.get("tables").and_then(|t| t.as_array()) {
                    for table in tables {
                        if let Some(rows) = table.get("rows").and_then(|r| r.as_array()) {
                            for row in rows {
                                if let Some(cells) = row.get("cells").and_then(|c| c.as_array()) {
                                    let row_text: Vec<String> = cells
                                        .iter()
                                        .filter_map(|cell| cell.get("content").and_then(|c| c.as_str()))
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
                
                // Fallback to general content if available
                if content_parts.is_empty() {
                    if let Some(content) = result.get("content").and_then(|c| c.as_str()) {
                        content_parts.push(content.to_string());
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
                    return Ok(InvoiceData {
                        fields,
                        source_file: None,
                        source_file_path: None,
                    });
                }
            }
            
            // Handle prebuilt-read model (plata, generic) - text-only extraction
            if fields_obj.is_none() {
                // Extract text content from prebuilt-read model response
                let content = result.get("content").and_then(|c| c.as_str()).unwrap_or("");
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
                    return Ok(InvoiceData {
                        fields,
                        source_file: None,
                        source_file_path: None,
                    });
                }
                // If no content either, return empty result
                return Ok(InvoiceData {
                    fields: HashMap::new(),
                    source_file: None,
                    source_file_path: None,
                });
            }
            
            let fields_obj = fields_obj.unwrap();

            // Debug logging for key Azure fields (only in debug builds).
            #[cfg(debug_assertions)]
            if let Some(d) = doc {
                if let Some(vendor_field) = d.get("fields").and_then(|f| f.get("VendorName")) {
                    let field_type = vendor_field.get("type").and_then(|t| t.as_str()).unwrap_or("unknown");
                    let content = vendor_field.get("content").and_then(|c| c.as_str()).unwrap_or("");
                    let value_string = vendor_field.get("valueString").and_then(|v| v.as_str()).unwrap_or("");
                    let confidence = vendor_field.get("confidence").and_then(|c| c.as_f64());
                    eprintln!(
                        "[ocr] DEBUG VendorName field: type={}, content={:?}, valueString={:?}, confidence={:?}",
                        field_type, content, value_string, confidence
                    );
                } else {
                    eprintln!("[ocr] DEBUG VendorName field not found in Azure response!");
                }
                if let Some(customer_field) = d.get("fields").and_then(|f| f.get("CustomerName")) {
                    let field_type = customer_field.get("type").and_then(|t| t.as_str()).unwrap_or("unknown");
                    let content = customer_field.get("content").and_then(|c| c.as_str()).unwrap_or("");
                    let value_string = customer_field.get("valueString").and_then(|v| v.as_str()).unwrap_or("");
                    let confidence = customer_field.get("confidence").and_then(|c| c.as_f64());
                    eprintln!(
                        "[ocr] DEBUG CustomerName field: type={}, content={:?}, valueString={:?}, confidence={:?}",
                        field_type, content, value_string, confidence
                    );
                } else {
                    eprintln!("[ocr] DEBUG CustomerName field not found in Azure response!");
                }
            }

            let mut fields = HashMap::new();
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
            if !vendor_name.is_empty() {
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
            if !customer_name.is_empty() {
                let name = fix_all_caps_run_together(&customer_name);
                fields.insert(
                    "buyer_name".to_string(),
                    InvoiceFieldValue {
                        value: name,
                        confidence: customer_conf,
                    },
                );
            }
            // Items → опис (description)
            let (mut description, mut desc_confidence) = extract_line_items_description(fields_obj);
            if description.is_empty() {
                if let Some(content) = result.get("content").and_then(|c| c.as_str()) {
                    let trimmed = content.trim();
                    if !trimmed.is_empty() {
                        description = trimmed.to_string();
                        desc_confidence = None;
                    }
                }
            }
            fields.insert(
                "description".to_string(),
                InvoiceFieldValue {
                    value: description,
                    confidence: desc_confidence,
                },
            );
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
            // TypeOfDocument: Only set default if Azure didn't return TypeOfDocument field
            // Azure field "TypeOfDocument" should be extracted above, so only set default if missing
            if !fields.contains_key("document_type") {
                let doc_type_value = match document_type {
                    Some("plata") => "Плата",
                    Some("smetka") => "Даночен биланс",
                    Some("generic") => "ДДВ",
                    _ => "Фактура", // Default for invoices or unknown
                };
                fields.insert(
                    "document_type".to_string(),
                    InvoiceFieldValue {
                        value: doc_type_value.to_string(),
                        confidence: Some(1.0),
                    },
                );
            }
            // Generic extraction: add any model fields not yet mapped (e.g. Предмет, Даночен биланс for other doc types).
            let mapped_azure_keys: std::collections::HashSet<&str> = AZURE_TO_FIELD
                .iter()
                .map(|(k, _)| *k)
                .chain(std::iter::once("Items"))
                .collect();
            for (model_key, obj) in fields_obj {
                if mapped_azure_keys.contains(model_key.as_str()) {
                    continue;
                }
                let (value, confidence) = extract_field_value_and_confidence(obj);
                if !value.is_empty() {
                    fields.insert(model_key.clone(), InvoiceFieldValue { value, confidence });
                }
            }
            return Ok(InvoiceData {
                fields,
                source_file: None,
                source_file_path: None,
            });
        }
        if status_str == "failed" {
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
