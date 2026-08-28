use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// Handle table. Ids are issued monotonically and never reused, so a stale
/// handle from the TypeScript side resolves to "not found" rather than to a
/// different live object.
pub struct Registry<T> {
    next: AtomicU64,
    items: Mutex<HashMap<u64, Arc<T>>>,
}

impl<T> Registry<T> {
    pub fn new() -> Self {
        Self {
            next: AtomicU64::new(1),
            items: Mutex::new(HashMap::new()),
        }
    }

    pub fn insert(&self, item: T) -> u64 {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        self.items
            .lock()
            .expect("registry mutex")
            .insert(id, Arc::new(item));
        id
    }

    pub fn get(&self, id: u64) -> Option<Arc<T>> {
        self.items.lock().expect("registry mutex").get(&id).cloned()
    }

    pub fn remove(&self, id: u64) -> Option<Arc<T>> {
        self.items.lock().expect("registry mutex").remove(&id)
    }

    pub fn ids(&self) -> Vec<u64> {
        let mut v: Vec<u64> = self
            .items
            .lock()
            .expect("registry mutex")
            .keys()
            .copied()
            .collect();
        v.sort_unstable();
        v
    }
}

impl<T> Default for Registry<T> {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_monotonic_and_never_reused() {
        let reg: Registry<String> = Registry::new();
        let a = reg.insert("a".to_string());
        let b = reg.insert("b".to_string());
        assert!(b > a);

        reg.remove(a);
        let c = reg.insert("c".to_string());
        assert!(c > b, "id {c} must not reuse removed id {a}");
    }

    #[test]
    fn get_returns_none_after_remove() {
        let reg: Registry<String> = Registry::new();
        let id = reg.insert("x".to_string());
        assert!(reg.get(id).is_some());
        reg.remove(id);
        assert!(reg.get(id).is_none());
    }

    #[test]
    fn ids_lists_live_entries_only() {
        let reg: Registry<String> = Registry::new();
        let a = reg.insert("a".to_string());
        let b = reg.insert("b".to_string());
        reg.remove(a);
        assert_eq!(reg.ids(), vec![b]);
    }
}
