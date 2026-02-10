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

/// Azure prebuilt-invoice field name -> our internal field key.
const AZURE_TO_FIELD: &[(&str, &str)] = &[
    ("InvoiceId", "invoice_number"),
    ("InvoiceDate", "date"),
    ("DueDate", "due_date"),
    ("VendorName", "seller_name"),
    ("VendorAddress", "seller_address"),
    ("VendorTaxId", "seller_tax_id"),
    ("CustomerName", "buyer_name"),
    ("CustomerAddress", "buyer_address"),
    ("CustomerTaxId", "buyer_tax_id"),
    ("InvoiceTotal", "total_amount"),
    ("SubTotal", "net_amount"),
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
        Some("date") => get_trimmed(obj, "valueDate"),
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
        .or_else(|| {
            obj.get("valueNumber")
                .and_then(|v| v.as_f64())
                .map(|n| n.to_string())
        })
        .or_else(|| get_trimmed(obj, "valueDate"))
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

fn company_has_legal_form(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.split_whitespace().any(|w| is_legal_form_token(w))
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

/// Scan full prebuilt-read text lines to find the best company line containing a legal form.
fn find_company_line_in_read(read_lines: &[String]) -> Option<String> {
    let mut best: Option<(String, f64)> = None;

    for (idx, line) in read_lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !company_has_legal_form(trimmed) {
            continue;
        }
        // Skip lines that are mostly numbers (likely tax IDs, IBANs, etc.).
        let digits = trimmed.chars().filter(|c| c.is_ascii_digit()).count();
        if digits as f32 > trimmed.len() as f32 * 0.4 {
            continue;
        }
        let mut score = 1.0;
        // Earlier lines score higher.
        score -= (idx as f64) * 0.01;
        let len_no_spaces = trimmed.chars().filter(|c| !c.is_whitespace()).count();
        if len_no_spaces > 10 {
            score += 0.1;
        }
        if let Some((_, best_score)) = &best {
            if score <= *best_score {
                continue;
            }
        }
        best = Some((trimmed.to_string(), score));
    }

    best.map(|(line, _)| line)
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
                            best_score = score;
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

/// Try to extract the vendor company line from Azure paragraph data (analyzeResult.paragraphs).
/// Strategy:
/// - Prefer paragraphs with role containing "vendor"/"seller"/"supplier".
/// - Otherwise, look at the first few paragraphs near the top of the document.
/// - From the chosen paragraph, take the first non-empty line that does not look like an address.
fn extract_vendor_from_paragraphs(analyze_result: &serde_json::Value) -> Option<String> {
    let paragraphs = analyze_result.get("paragraphs").and_then(|p| p.as_array())?;

    fn first_company_like_line(p: &serde_json::Value) -> Option<String> {
        let content = p.get("content").and_then(|c| c.as_str())?;
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            // Skip lines that look like pure addresses (e.g. start with number or postal code).
            if looks_like_address_suffix(trimmed) {
                continue;
            }
            return Some(trimmed.to_string());
        }
        None
    }

    // Pass 1: role-based search.
    for paragraph in paragraphs {
        let role = paragraph
            .get("role")
            .and_then(|r| r.as_str())
            .unwrap_or("")
            .to_lowercase();
        if role.contains("vendor") || role.contains("seller") || role.contains("supplier") {
            if let Some(line) = first_company_like_line(paragraph) {
                return Some(line);
            }
        }
    }

    // Pass 2: first few paragraphs near top of document.
    for paragraph in paragraphs.iter().take(5) {
        if let Some(line) = first_company_like_line(paragraph) {
            return Some(line);
        }
    }

    None
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

/// Clean up buyer name using simple sanity rules:
/// - Empty -> None
/// - Same as seller -> None
/// - Looks like address line -> None
fn sanitize_buyer_name(buyer: &str, seller: &str) -> Option<String> {
    let b = buyer.trim();
    if b.is_empty() {
        return None;
    }
    if b.eq_ignore_ascii_case(seller.trim()) {
        return None;
    }
    if looks_like_address_line(b) {
        return None;
    }
    Some(b.to_string())
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

/// Get the list of item "title" descriptions (bold/first line only) from Items for matching in read output.
fn get_invoice_item_titles(fields_obj: &serde_json::Map<String, serde_json::Value>) -> Vec<String> {
    let value_array = match fields_obj
        .get("Items")
        .and_then(|v| v.get("valueArray").and_then(|a| a.as_array()))
    {
        Some(arr) => arr,
        None => return vec![],
    };
    let mut titles = Vec::with_capacity(value_array.len());
    for item in value_array {
        let value_obj = match item.get("valueObject").and_then(|o| o.as_object()) {
            Some(o) => o,
            None => continue,
        };
        let desc = item_field_string(value_obj, "Description");
        if !desc.is_empty() {
            titles.push(desc);
        }
    }
    titles
}

/// Normalize for matching: lowercase, collapse whitespace.
fn normalize_line(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether read line matches an item title (one contains the other after normalizing).
fn line_matches_title(read_line: &str, title: &str) -> bool {
    let a = normalize_line(read_line);
    let b = normalize_line(title);
    if a.is_empty() || b.is_empty() {
        return false;
    }
    a.contains(b.as_str()) || b.contains(a.as_str())
}

/// Use prebuilt-read lines to extend each item description with following lines (e.g. "Pratka: ...", "KAMION: ...").
fn enrich_descriptions_from_read(read_lines: &[String], item_titles: &[String]) -> Vec<String> {
    if item_titles.is_empty() || read_lines.is_empty() {
        return item_titles.to_vec();
    }
    const MAX_LINES_PER_ITEM: usize = 20;
    let mut result = Vec::with_capacity(item_titles.len());
    let mut search_start = 0;
    for (i, title) in item_titles.iter().enumerate() {
        let start = match read_lines[search_start..].iter().position(|l| line_matches_title(l, title)) {
            Some(pos) => search_start + pos,
            None => {
                result.push(title.clone());
                continue;
            }
        };
        let end = if i + 1 < item_titles.len() {
            match read_lines[start + 1..].iter().position(|l| line_matches_title(l, &item_titles[i + 1])) {
                Some(pos) => (start + 1 + pos).min(read_lines.len()),
                None => (start + MAX_LINES_PER_ITEM).min(read_lines.len()),
            }
        } else {
            (start + MAX_LINES_PER_ITEM).min(read_lines.len())
        };
        let block: String = read_lines[start..end].join("\n");
        result.push(block.trim().to_string());
        search_start = end;
    }
    result
}

/// Extract one combined description from Azure Items: each product's description only, joined one after another (Product desc, then Second desc, ...).
fn extract_line_items_description(fields_obj: &serde_json::Map<String, serde_json::Value>) -> (String, Option<f64>) {
    let items_field = match fields_obj.get("Items") {
        Some(v) => v,
        None => {
            #[cfg(debug_assertions)]
            eprintln!("[ocr] No line items (Items) found in invoice");
            return (String::new(), None);
        }
    };
    let confidence = items_field.get("confidence").and_then(|c| c.as_f64());
    let value_array = match items_field.get("valueArray").and_then(|a| a.as_array()) {
        Some(arr) => arr,
        None => {
            #[cfg(debug_assertions)]
            eprintln!("[ocr] Items field has no valueArray");
            return (String::new(), confidence);
        }
    };
    if value_array.is_empty() {
        #[cfg(debug_assertions)]
        eprintln!("[ocr] Items valueArray is empty");
        return (String::new(), confidence);
    }
    let mut descriptions: Vec<String> = Vec::with_capacity(value_array.len());
    for item in value_array {
        let value_obj = match item.get("valueObject").and_then(|o| o.as_object()) {
            Some(o) => o,
            None => continue,
        };
        let desc = item_field_string(value_obj, "Description");
        if !desc.is_empty() {
            descriptions.push(desc);
        }
    }
    #[cfg(debug_assertions)]
    {
        if descriptions.is_empty() {
            eprintln!("[ocr] Warning: Line items have no descriptions");
        } else {
            eprintln!("[ocr] Found {} line item(s)", descriptions.len());
        }
    }
    // One combined field: first product desc, then second (single newline between items).
    let combined = descriptions.join("\n");
    (combined, confidence)
}

pub fn run_ocr_invoice(file_path: &str) -> Result<InvoiceData, String> {
    load_env();
    let key = std::env::var("AZURE_OCR_KEY").map_err(|_| "AZURE_OCR_KEY not set in .env")?;
    let endpoint = std::env::var("AZURE_OCR_ENDPOINT")
        .map_err(|_| "AZURE_OCR_ENDPOINT not set in .env")?;
    let endpoint = endpoint.trim_end_matches('/');
    // Use Macedonian locale and enable queryFields feature so Azure looks explicitly
    // for legal names and tax IDs (extends the fields schema without training).
    let url = format!(
        "{}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=2024-11-30&locale=mk-MK&features=queryFields&queryFields=SellerLegalName,BuyerLegalName,SellerTaxID,BuyerTaxID",
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
            let docs = result
                .get("documents")
                .and_then(|d| d.as_array())
                .ok_or("No documents in result")?;
            let doc = docs.first().ok_or("Empty documents array")?;
            let fields_obj = doc.get("fields").and_then(|f| f.as_object()).ok_or("No fields")?;

            // Debug logging for key Azure fields (only in debug builds).
            #[cfg(debug_assertions)]
            {
                if let Some(vendor_field) = doc.get("fields").and_then(|f| f.get("VendorName")) {
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

                if let Some(customer_field) = doc.get("fields").and_then(|f| f.get("CustomerName")) {
                    let field_type = customer_field.get("type").and_then(|t| t.as_str()).unwrap_or("unknown");
                    let content = customer_field.get("content").and_then(|c| c.as_str()).unwrap_or("");
                    let value_string = customer_field
                        .get("valueString")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
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
            for (azure_key, our_key) in AZURE_TO_FIELD {
                if *our_key == "seller_name" || *our_key == "buyer_name" {
                    continue;
                }
                if let Some(obj) = fields_obj.get(*azure_key) {
                    let (value, confidence) = extract_field_value_and_confidence(obj);
                    if !value.is_empty() {
                        fields.insert(
                            (*our_key).to_string(),
                            InvoiceFieldValue {
                                value,
                                confidence,
                            },
                        );
                    }
                }
            }
            let (vendor_name, vendor_conf) = best_vendor_name(fields_obj);
            if !vendor_name.is_empty() {
                fields.insert(
                    "seller_name".to_string(),
                    InvoiceFieldValue {
                        value: vendor_name,
                        confidence: vendor_conf,
                    },
                );
            }
            let (customer_name, customer_conf) = best_customer_name(fields_obj);
            if !customer_name.is_empty() {
                fields.insert(
                    "buyer_name".to_string(),
                    InvoiceFieldValue {
                        value: customer_name,
                        confidence: customer_conf,
                    },
                );
            }
            // Line items: combine Items.valueArray[*].valueObject (Description, ProductCode, etc.) into "description"
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
            // Currency: valueCurrency.currencyCode or content.currencyCode
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
            // Document type: first column shows e.g. "фактура"
            if !fields.contains_key("document_type") {
                fields.insert(
                    "document_type".to_string(),
                    InvoiceFieldValue {
                        value: "фактура".to_string(),
                        confidence: Some(1.0),
                    },
                );
            }
            return Ok(InvoiceData {
                fields,
                source_file: None,
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
