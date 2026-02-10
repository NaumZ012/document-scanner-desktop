use crate::models::ExcelSchema;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

static CACHE: std::sync::OnceLock<Arc<RwLock<HashMap<i64, ExcelSchema>>>> = std::sync::OnceLock::new();

fn cache() -> &'static Arc<RwLock<HashMap<i64, ExcelSchema>>> {
    CACHE.get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
}

pub fn get_cached_schema(profile_id: i64) -> Option<ExcelSchema> {
    let guard = cache().read().ok()?;
    guard.get(&profile_id).cloned()
}

pub fn set_cached_schema(profile_id: i64, schema: ExcelSchema) {
    if let Ok(mut guard) = cache().write() {
        guard.insert(profile_id, schema);
    }
}

pub fn invalidate_cache(profile_id: i64) {
    if let Ok(mut guard) = cache().write() {
        guard.remove(&profile_id);
    }
}

#[allow(dead_code)]
pub fn clear_all_cache() {
    if let Ok(mut guard) = cache().write() {
        guard.clear();
    }
}
