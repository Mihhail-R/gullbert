//! Local memory cache with transactional snapshots and queryable experiences.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, path::Path, time::Duration};

const MAX_BYTES: usize = 262_144;
const HISTORY_LIMIT: usize = 200;

#[derive(Deserialize, Serialize)]
struct Location {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[derive(Deserialize, Serialize)]
struct Episode {
    id: i64,
    at: i64,
    kind: String,
    detail: String,
    location: Location,
}

fn open(dir: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let db = Connection::open(dir.join("memory.sqlite3")).map_err(|e| e.to_string())?;
    db.busy_timeout(Duration::from_secs(2))
        .map_err(|e| e.to_string())?;
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if version > 1 {
        return Err("Memory database was created by a newer Gullbert".into());
    }
    db.execute_batch("BEGIN;
        CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS episodes (
            id INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL,
            detail TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
            width REAL NOT NULL, height REAL NOT NULL
        );
        PRAGMA user_version = 1;
        COMMIT;").map_err(|e| e.to_string())?;
    Ok(db)
}

fn validate(memory: &Value) -> Result<Vec<Episode>, String> {
    if !memory.is_object() || memory.to_string().len() > MAX_BYTES {
        return Err("Invalid roommate memory".into());
    }
    if memory
        .get("version")
        .and_then(Value::as_u64)
        .is_some_and(|v| v > 2)
    {
        return Err("Memory snapshot was created by a newer Gullbert".into());
    }
    let episodes: Vec<Episode> = serde_json::from_value(
        memory
            .get("episodes")
            .cloned()
            .unwrap_or_else(|| serde_json::json!([])),
    )
    .map_err(|e| e.to_string())?;
    if episodes.len() > HISTORY_LIMIT {
        return Err("Memory history is too large".into());
    }
    let mut ids = HashSet::new();
    for event in &episodes {
        let p = &event.location;
        if event.id <= 0 || event.id > 9_007_199_254_740_991 {
            return Err("Invalid memory experience ID".into());
        }
        let unique = ids.insert(event.id);
        if !unique {
            return Err("Duplicate memory experience ID".into());
        }
        if event.at < 0 || event.at > 8_640_000_000_000_000 {
            return Err("Invalid memory experience timestamp".into());
        }
        if event.detail.is_empty() || event.detail.chars().count() > 80 {
            return Err("Invalid memory experience detail".into());
        }
        match event.kind.as_str() {
            "trick" | "reward" | "meal" | "play" | "scratch" | "gift" | "perch" | "visit"
            | "activity" => {}
            _ => return Err("Invalid memory experience kind".into()),
        }
        if ![p.x, p.y, p.width, p.height].iter().all(|n| n.is_finite()) {
            return Err("Invalid memory experience coordinates".into());
        }
        if p.width <= 0.0 || p.height <= 0.0 {
            return Err("Invalid memory experience display size".into());
        }
        if p.x < 0.0 || p.x > p.width {
            return Err("Memory experience x is outside the display".into());
        }
        if p.y < 0.0 || p.y > p.height {
            return Err("Memory experience y is outside the display".into());
        }
    }
    Ok(episodes)
}

fn write(db: &mut Connection, memory: &Value) -> Result<(), String> {
    let episodes = validate(memory)?;
    let mut snapshot = memory.clone();
    snapshot.as_object_mut().unwrap().remove("episodes");
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO snapshot (id, data) VALUES (1, ?1)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        [snapshot.to_string()],
    )
    .map_err(|e| e.to_string())?;
    // Replacing this small bounded history also makes explicit forgetting durable.
    tx.execute("DELETE FROM episodes", [])
        .map_err(|e| e.to_string())?;
    for event in episodes {
        let p = event.location;
        tx.execute(
            "INSERT INTO episodes (id, at, kind, detail, x, y, width, height)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                event.id,
                event.at,
                event.kind,
                event.detail,
                p.x,
                p.y,
                p.width,
                p.height
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

pub(crate) fn load(dir: &Path) -> Result<Value, String> {
    let mut db = open(dir)?;
    let saved: Option<String> = db
        .query_row("SELECT data FROM snapshot WHERE id = 1", [], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(saved) = saved {
        let mut memory: Value = serde_json::from_str(&saved).map_err(|e| e.to_string())?;
        if !memory.is_object() {
            return Err("Invalid saved memory".into());
        }
        let mut statement = db
            .prepare("SELECT id, at, kind, detail, x, y, width, height FROM episodes ORDER BY id")
            .map_err(|e| e.to_string())?;
        let episodes = statement
            .query_map([], |row| {
                Ok(Episode {
                    id: row.get(0)?,
                    at: row.get(1)?,
                    kind: row.get(2)?,
                    detail: row.get(3)?,
                    location: Location {
                        x: row.get(4)?,
                        y: row.get(5)?,
                        width: row.get(6)?,
                        height: row.get(7)?,
                    },
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        memory["episodes"] = serde_json::to_value(episodes).map_err(|e| e.to_string())?;
        validate(&memory)?;
        return Ok(memory);
    }
    // Import once. Keep the original JSON intact as a recovery copy.
    match std::fs::read(dir.join("roommate.json")) {
        Ok(bytes) => {
            if bytes.len() > MAX_BYTES {
                return Err("Legacy memory is too large".into());
            }
            let mut memory: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            validate(&memory)?;
            if memory.get("episodes").is_none() {
                memory["episodes"] = serde_json::json!([]);
            }
            write(&mut db, &memory)?;
            Ok(memory)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) fn save(dir: &Path, memory: &Value) -> Result<(), String> {
    write(&mut open(dir)?, memory)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicUsize, Ordering},
    };
    static SERIAL: AtomicUsize = AtomicUsize::new(0);
    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            let dir = Self(std::env::temp_dir().join(format!(
                "gullbert-memory-{}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            )));
            std::fs::create_dir_all(&dir.0).unwrap();
            dir
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn memory() -> Value {
        serde_json::json!({"version":2,"performances":{"spin":1},"learned":{"tricks":{"spin":0}},
            "episodes":[{"id":1,"at":1_792_100_000_000_i64,"kind":"trick","detail":"spin",
                "location":{"x":120.0,"y":210.0,"width":900.0,"height":650.0}}]})
    }
    #[test]
    fn experiences_and_learning_survive_reopening_and_are_queryable() {
        let dir = Directory::new();
        assert_eq!(load(&dir.0).unwrap(), Value::Null);
        let saved = memory();
        save(&dir.0, &saved).unwrap();
        assert_eq!(load(&dir.0).unwrap(), saved);
        let db = open(&dir.0).unwrap();
        let row: (String, i64, f64) = db
            .query_row(
                "SELECT detail, at, x FROM episodes WHERE kind = 'trick'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(row, ("spin".into(), 1_792_100_000_000, 120.0));
    }
    #[test]
    fn imports_legacy_once_and_preserves_original() {
        let dir = Directory::new();
        let legacy = r#"{"version":1,"collection":{"sock":2},"learned":{"tricks":{"spin":3}}}"#;
        std::fs::write(dir.0.join("roommate.json"), legacy).unwrap();
        let imported = load(&dir.0).unwrap();
        assert_eq!(imported["collection"]["sock"], 2);
        assert_eq!(imported["learned"]["tricks"]["spin"], 3);
        assert_eq!(
            std::fs::read_to_string(dir.0.join("roommate.json")).unwrap(),
            legacy
        );
        save(&dir.0, &memory()).unwrap();
        std::fs::write(dir.0.join("roommate.json"), "old unreadable backup").unwrap();
        assert_eq!(load(&dir.0).unwrap(), memory());
    }
    #[test]
    fn failed_transaction_keeps_previous_snapshot_and_history_together() {
        let dir = Directory::new();
        save(&dir.0, &memory()).unwrap();
        let db = open(&dir.0).unwrap();
        db.execute_batch("CREATE TRIGGER reject_episode BEFORE INSERT ON episodes BEGIN SELECT RAISE(ABORT, 'disk write failed'); END;").unwrap();
        let mut next = memory();
        next["performances"]["spin"] = serde_json::json!(2);
        assert!(save(&dir.0, &next).is_err());
        assert_eq!(load(&dir.0).unwrap(), memory());
    }
    #[test]
    fn forgetting_removes_history_and_invalid_or_oversized_writes_preserve_memory() {
        let dir = Directory::new();
        save(&dir.0, &memory()).unwrap();
        for bad in [
            serde_json::json!([]),
            serde_json::json!({"episodes": vec![memory()["episodes"][0].clone(); 201]}),
            serde_json::json!({"version":999}),
        ] {
            assert!(save(&dir.0, &bad).is_err());
            assert_eq!(load(&dir.0).unwrap(), memory());
        }
        let mut forgotten = memory();
        forgotten["episodes"] = serde_json::json!([]);
        forgotten["performances"]["spin"] = serde_json::json!(0);
        save(&dir.0, &forgotten).unwrap();
        assert_eq!(load(&dir.0).unwrap(), forgotten);
    }
    #[test]
    fn unreadable_and_future_memories_are_errors_not_empty_memories() {
        let dir = Directory::new();
        std::fs::write(dir.0.join("roommate.json"), "broken").unwrap();
        assert!(load(&dir.0).is_err());
        assert!(load(&dir.0).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.0.join("roommate.json")).unwrap(),
            "broken"
        );
        let db = open(&dir.0).unwrap();
        db.execute_batch("PRAGMA user_version = 999").unwrap();
        assert!(load(&dir.0).is_err());
        assert!(save(&dir.0, &memory()).is_err());
        drop(db);
        std::fs::write(dir.0.join("memory.sqlite3"), "broken database").unwrap();
        assert!(load(&dir.0).is_err());
        assert!(save(&dir.0, &memory()).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.0.join("memory.sqlite3")).unwrap(),
            "broken database"
        );
    }
}
