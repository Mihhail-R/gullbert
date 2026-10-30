//! Local memory cache with one complete, validated SQLite snapshot.
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior};
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
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let mut db = Connection::open(dir.join("memory.sqlite3")).map_err(|error| error.to_string())?;
    db.busy_timeout(Duration::from_secs(2))
        .map_err(|error| error.to_string())?;

    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let version: i64 = tx
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;

    match version {
        0 => {
            require_tables(&tx, &[])?;
            tx.execute_batch(
                "CREATE TABLE snapshot (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);
                PRAGMA user_version = 2;",
            )
            .map_err(|error| error.to_string())?;
        }

        1 => migrate(&tx)?,

        2 => require_layout(&tx, false)?,

        _ => return Err("Memory database was created by a newer Gullbert".into()),
    }

    tx.commit().map_err(|error| error.to_string())?;
    Ok(db)
}

fn require_tables(db: &Connection, expected: &[&str]) -> Result<(), String> {
    let mut statement = db
        .prepare("SELECT name FROM sqlite_schema WHERE type IN ('table', 'view') ORDER BY name")
        .map_err(|error| error.to_string())?;
    let tables = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    if tables != expected {
        return Err("Unsupported memory database layout".into());
    }

    Ok(())
}

fn require_layout(db: &Connection, has_episodes: bool) -> Result<(), String> {
    if has_episodes {
        require_tables(db, &["episodes", "snapshot"])?;
    } else {
        require_tables(db, &["snapshot"])?;
    }

    require_snapshot_layout(db)?;

    if has_episodes {
        require_history_layout(db)?;
    }

    Ok(())
}

fn require_snapshot_layout(db: &Connection) -> Result<(), String> {
    let mut statement = db
        .prepare("SELECT name, type, \"notnull\", pk, hidden FROM pragma_table_xinfo('snapshot')")
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let expected = [
        ("id".into(), "INTEGER".into(), 0, 1, 0),
        ("data".into(), "TEXT".into(), 1, 0, 0),
    ];

    if columns != expected {
        return Err("Unsupported memory snapshot layout".into());
    }

    let invalid_rows: i64 = db
        .query_row("SELECT count(*) FROM snapshot WHERE id != 1", [], |row| {
            row.get(0)
        })
        .map_err(|error| error.to_string())?;

    if invalid_rows != 0 {
        return Err("Invalid memory snapshot ID".into());
    }

    Ok(())
}

fn require_history_layout(db: &Connection) -> Result<(), String> {
    let mut statement = db
        .prepare("SELECT name, type, \"notnull\", pk, hidden FROM pragma_table_xinfo('episodes')")
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let expected = [
        ("id".into(), "INTEGER".into(), 0, 1, 0),
        ("at".into(), "INTEGER".into(), 1, 0, 0),
        ("kind".into(), "TEXT".into(), 1, 0, 0),
        ("detail".into(), "TEXT".into(), 1, 0, 0),
        ("x".into(), "REAL".into(), 1, 0, 0),
        ("y".into(), "REAL".into(), 1, 0, 0),
        ("width".into(), "REAL".into(), 1, 0, 0),
        ("height".into(), "REAL".into(), 1, 0, 0),
    ];

    if columns != expected {
        return Err("Unsupported memory history layout".into());
    }

    Ok(())
}

fn migrate(tx: &Transaction<'_>) -> Result<(), String> {
    require_layout(tx, true)?;
    let saved = read_snapshot(tx)?;
    let mut statement = tx
        .prepare("SELECT id, at, kind, detail, x, y, width, height FROM episodes ORDER BY id")
        .map_err(|error| error.to_string())?;
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
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(statement);

    match saved {
        Some(saved) => {
            let mut memory: Value =
                serde_json::from_str(&saved).map_err(|error| error.to_string())?;

            if !memory.is_object() || memory.get("episodes").is_some() {
                return Err("Invalid version-1 memory snapshot".into());
            }

            memory["episodes"] =
                serde_json::to_value(episodes).map_err(|error| error.to_string())?;
            write(tx, &memory)?;
        }

        None => {
            if !episodes.is_empty() {
                return Err("Memory history has no snapshot".into());
            }
        }
    }

    tx.execute_batch("DROP TABLE episodes; PRAGMA user_version = 2;")
        .map_err(|error| error.to_string())
}

fn read_snapshot(db: &Connection) -> Result<Option<String>, String> {
    db.query_row("SELECT data FROM snapshot WHERE id = 1", [], |row| {
        row.get(0)
    })
    .optional()
    .map_err(|error| error.to_string())
}

fn validate(memory: &Value) -> Result<(), String> {
    if !memory.is_object() || memory.to_string().len() > MAX_BYTES {
        return Err("Invalid roommate memory".into());
    }

    if memory
        .get("version")
        .and_then(Value::as_u64)
        .is_some_and(|v| v > 3)
    {
        return Err("Memory snapshot was created by a newer Gullbert".into());
    }

    let episodes: Vec<Episode> = serde_json::from_value(
        memory
            .get("episodes")
            .cloned()
            .unwrap_or_else(|| serde_json::json!([])),
    )
    .map_err(|error| error.to_string())?;

    if episodes.len() > HISTORY_LIMIT {
        return Err("Memory history is too large".into());
    }

    let mut ids = HashSet::new();

    for event in &episodes {
        let position = &event.location;

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

        if event.detail.trim().is_empty() || event.detail.chars().count() > 80 {
            return Err("Invalid memory experience detail".into());
        }

        match event.kind.as_str() {
            "trick" | "reward" | "meal" | "play" | "scratch" | "gift" | "perch" | "visit"
            | "activity" => {}

            "recall" => match event.detail.as_str() {
                "snack_spot"
                | "encore:spin"
                | "encore:dead"
                | "keepsake:bottle_cap"
                | "keepsake:bent_spoon"
                | "keepsake:sock"
                | "keepsake:glass_diamond"
                | "keepsake:parking_ticket"
                | "keepsake:shell"
                | "keepsake:button"
                | "keepsake:string"
                | "keepsake:foil_ball" => {}

                _ => return Err("Invalid recall experience detail".into()),
            },

            _ => return Err("Invalid memory experience kind".into()),
        }

        if ![position.x, position.y, position.width, position.height]
            .iter()
            .all(|n| n.is_finite())
        {
            return Err("Invalid memory experience coordinates".into());
        }

        if position.width <= 0.0 || position.height <= 0.0 {
            return Err("Invalid memory experience display size".into());
        }

        if position.x < 0.0 || position.x > position.width {
            return Err("Memory experience x is outside the display".into());
        }

        if position.y < 0.0 || position.y > position.height {
            return Err("Memory experience y is outside the display".into());
        }
    }

    Ok(())
}

fn write(db: &Connection, memory: &Value) -> Result<(), String> {
    let mut snapshot = memory.clone();

    if snapshot.is_object() && snapshot.get("episodes").is_none() {
        snapshot["episodes"] = serde_json::json!([]);
    }

    validate(&snapshot)?;
    let snapshot = serde_json::to_string(&snapshot).map_err(|error| error.to_string())?;
    db.execute(
        "INSERT INTO snapshot (id, data) VALUES (1, ?1)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        [snapshot],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn load(dir: &Path) -> Result<Value, String> {
    let db = open(dir)?;

    if let Some(saved) = read_snapshot(&db)? {
        let memory: Value = serde_json::from_str(&saved).map_err(|error| error.to_string())?;
        validate(&memory)?;

        return Ok(memory);
    }

    // Import once. Keep the original JSON intact as a recovery copy.
    match std::fs::read(dir.join("roommate.json")) {
        Ok(bytes) => {
            if bytes.len() > MAX_BYTES {
                return Err("Legacy memory is too large".into());
            }

            let mut memory: Value =
                serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
            validate(&memory)?;

            if memory.get("episodes").is_none() {
                memory["episodes"] = serde_json::json!([]);
            }

            write(&db, &memory)?;
            Ok(memory)
        }

        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),

        Err(error) => Err(error.to_string()),
    }
}

pub(crate) fn save(dir: &Path, memory: &Value) -> Result<(), String> {
    write(&open(dir)?, memory)
}

/// Moves unreadable memories out of the way without deleting them, so the next
/// launch starts fresh while the originals stay available for recovery.
pub(crate) fn set_aside(dir: &Path, stamp: u64) -> Result<(), String> {
    let names = [
        "memory.sqlite3",
        "memory.sqlite3-wal",
        "memory.sqlite3-shm",
        "memory.sqlite3-journal",
        "roommate.json",
    ];

    for name in names {
        let from = dir.join(name);

        if !from.exists() {
            continue;
        }

        let to = dir.join(format!("{name}.unreadable-{stamp}"));

        if to.exists() {
            return Err(format!("{} already exists", to.display()));
        }

        std::fs::rename(&from, &to).map_err(|error| format!("Could not move {name}: {error}"))?;
    }

    Ok(())
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
        serde_json::json!({"version":3,"performances":{"spin":1},"learned":{"tricks":{"spin":0}},
            "episodes":[{"id":1,"at":1_792_100_000_000_i64,"kind":"trick","detail":"spin",
                "location":{"x":120.0,"y":210.0,"width":900.0,"height":650.0}}]})
    }
    #[test]
    fn fresh_store_keeps_complete_memory_in_one_snapshot() {
        let dir = Directory::new();
        assert_eq!(load(&dir.0).unwrap(), Value::Null);
        let saved = memory();
        save(&dir.0, &saved).unwrap();
        assert_eq!(load(&dir.0).unwrap(), saved);
        let db = open(&dir.0).unwrap();
        assert_eq!(schema_version(&db), 2);
        require_tables(&db, &["snapshot"]).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&read_snapshot(&db).unwrap().unwrap()).unwrap(),
            saved
        );
    }

    #[test]
    fn nest_and_new_treasure_recalls_survive_reopening() {
        let dir = Directory::new();
        let mut saved = memory();
        saved["nest"] = serde_json::json!({
            "x": 120, "y": 210, "items": ["shell", "button", "string"]
        });
        saved["collection"] = serde_json::json!({
            "shell": 1, "button": 1, "string": 1, "foil_ball": 1
        });
        saved["episodes"][0]["kind"] = serde_json::json!("recall");

        for item in ["shell", "button", "string", "foil_ball"] {
            saved["episodes"][0]["detail"] = serde_json::json!(format!("keepsake:{item}"));
            save(&dir.0, &saved).unwrap();
            assert_eq!(load(&dir.0).unwrap(), saved);
        }
    }

    #[test]
    fn personal_seed_and_earned_preferences_survive_reopening() {
        let dir = Directory::new();
        let mut saved = memory();
        saved["preferences"] = serde_json::json!({
            "seed": 4_294_967_295_u64,
            "treasureAffection": {"sock": 3, "bottle_cap": 1.5},
            "hangout": {"x": 0.24, "y": 0.65, "visits": 5}
        });
        save(&dir.0, &saved).unwrap();
        assert_eq!(load(&dir.0).unwrap(), saved);
        let mut next = load(&dir.0).unwrap();
        next["preferences"]["hangout"]["visits"] = serde_json::json!(6);
        save(&dir.0, &next).unwrap();
        assert_eq!(load(&dir.0).unwrap(), next);
        assert_eq!(next["preferences"]["seed"], saved["preferences"]["seed"]);
    }
    #[test]
    fn version_three_summaries_and_recall_history_survive_reopening() {
        let dir = Directory::new();
        let mut saved = memory();
        saved["version"] = serde_json::json!(3);
        saved["longTerm"] = serde_json::json!({
            "active": {"days": 5, "progressMs": 5900},
            "tricks": {"spin": {"days": 3, "qualifiedAtMs": 1_792_100_000_000_i64}},
            "daily": {"day": "2026-10-18", "allowed": true, "used": true}
        });
        saved["episodes"][0]["kind"] = serde_json::json!("recall");
        saved["episodes"][0]["detail"] = serde_json::json!("keepsake:bent_spoon");
        save(&dir.0, &saved).unwrap();
        assert_eq!(load(&dir.0).unwrap(), saved);

        for detail in ["encore:come", "keepsake:chip", "keepsake:unknown"] {
            let mut invalid = saved.clone();
            invalid["episodes"][0]["detail"] = serde_json::json!(detail);
            assert!(save(&dir.0, &invalid).is_err());
            assert_eq!(load(&dir.0).unwrap(), saved);
        }

        let mut future = saved.clone();
        future["version"] = serde_json::json!(4);
        assert!(save(&dir.0, &future).is_err());
        assert_eq!(load(&dir.0).unwrap(), saved);
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
    fn failed_upsert_preserves_the_complete_previous_snapshot() {
        let dir = Directory::new();
        save(&dir.0, &memory()).unwrap();
        let db = open(&dir.0).unwrap();
        db.execute_batch("CREATE TRIGGER reject_snapshot BEFORE UPDATE ON snapshot BEGIN SELECT RAISE(ABORT, 'disk write failed'); END;").unwrap();
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

    fn schema_version(db: &Connection) -> i64 {
        db.query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap()
    }

    fn version_one_store(dir: &Directory, saved: Option<&Value>) -> Connection {
        let db = Connection::open(dir.0.join("memory.sqlite3")).unwrap();
        db.execute_batch(
            "CREATE TABLE snapshot (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);
            CREATE TABLE episodes (
                id INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL,
                detail TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
                width REAL NOT NULL, height REAL NOT NULL
            );
            PRAGMA user_version = 1;",
        )
        .unwrap();

        if let Some(saved) = saved {
            let episodes: Vec<Episode> = serde_json::from_value(saved["episodes"].clone()).unwrap();
            let mut snapshot = saved.clone();
            snapshot.as_object_mut().unwrap().remove("episodes");
            db.execute(
                "INSERT INTO snapshot VALUES (1, ?1)",
                [snapshot.to_string()],
            )
            .unwrap();

            for episode in episodes {
                let location = episode.location;
                db.execute(
                    "INSERT INTO episodes VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![
                        episode.id,
                        episode.at,
                        episode.kind,
                        episode.detail,
                        location.x,
                        location.y,
                        location.width,
                        location.height
                    ],
                )
                .unwrap();
            }
        }

        db
    }

    #[test]
    fn saving_legacy_memory_without_history_keeps_an_explicit_empty_history() {
        let dir = Directory::new();
        let saved = serde_json::json!({"version": 1, "collection": {"sock": 2}});
        save(&dir.0, &saved).unwrap();
        let mut expected = saved;
        expected["episodes"] = serde_json::json!([]);
        assert_eq!(load(&dir.0).unwrap(), expected);
    }

    #[test]
    fn migration_preserves_old_id_order_then_saves_preserve_array_order() {
        let dir = Directory::new();
        let mut saved = memory();
        let mut second = saved["episodes"][0].clone();
        second["id"] = serde_json::json!(2);
        second["detail"] = serde_json::json!("dead");
        saved["episodes"].as_array_mut().unwrap().insert(0, second);
        let db = version_one_store(&dir, Some(&saved));
        let mut ordered = saved.clone();
        ordered["episodes"].as_array_mut().unwrap().reverse();

        assert_eq!(load(&dir.0).unwrap(), ordered);
        assert_eq!(schema_version(&db), 2);
        require_tables(&db, &["snapshot"]).unwrap();
        assert_eq!(load(&dir.0).unwrap(), ordered);

        save(&dir.0, &saved).unwrap();
        assert_eq!(load(&dir.0).unwrap(), saved);
    }

    #[test]
    fn empty_version_one_stores_migrate_with_or_without_a_snapshot() {
        for has_snapshot in [false, true] {
            let dir = Directory::new();
            let mut saved = memory();
            saved["episodes"] = serde_json::json!([]);
            let snapshot = has_snapshot.then_some(&saved);
            let db = version_one_store(&dir, snapshot);
            let expected = snapshot.cloned().unwrap_or(Value::Null);

            assert_eq!(load(&dir.0).unwrap(), expected);
            assert_eq!(schema_version(&db), 2);
            require_tables(&db, &["snapshot"]).unwrap();
            assert_eq!(load(&dir.0).unwrap(), expected);
        }
    }

    #[test]
    fn migration_commit_failure_rolls_back_snapshot_history_and_schema_version() {
        let dir = Directory::new();
        let db = version_one_store(&dir, Some(&memory()));
        let snapshot_before = read_snapshot(&db).unwrap();
        // A reader permits BEGIN IMMEDIATE and writes, but prevents the final commit.
        db.execute_batch("BEGIN; SELECT * FROM episodes;").unwrap();

        assert!(load(&dir.0).is_err());
        db.execute_batch("ROLLBACK;").unwrap();
        assert_eq!(schema_version(&db), 1);
        assert_eq!(read_snapshot(&db).unwrap(), snapshot_before);
        require_tables(&db, &["episodes", "snapshot"]).unwrap();
        let history_count: i64 = db
            .query_row("SELECT count(*) FROM episodes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(history_count, 1);
        assert_eq!(load(&dir.0).unwrap(), memory());
    }

    #[test]
    fn rejected_migrations_leave_the_database_file_unchanged() {
        let corruptions = [
            "UPDATE snapshot SET data = 'broken'",
            "UPDATE snapshot SET data = '[]'",
            "UPDATE snapshot SET data = '{\"version\":4}'",
            "UPDATE snapshot SET data = '{\"episodes\":[]}'",
            "UPDATE episodes SET x = -1",
            "UPDATE episodes SET kind = 'unknown'",
            "PRAGMA ignore_check_constraints = ON; UPDATE snapshot SET id = 2",
            "ALTER TABLE episodes RENAME TO old_episodes;
                CREATE TABLE episodes (
                    id INTEGER, at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL,
                    x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL
                );
                INSERT INTO episodes SELECT * FROM old_episodes;
                DROP TABLE old_episodes",
            "DELETE FROM snapshot",
            "DROP TABLE episodes",
            "CREATE TABLE unexpected (data TEXT)",
            "ALTER TABLE episodes ADD COLUMN extra TEXT",
            "ALTER TABLE snapshot ADD COLUMN extra TEXT",
            "PRAGMA user_version = 0",
        ];

        for corruption in corruptions {
            let dir = Directory::new();
            let db = version_one_store(&dir, Some(&memory()));
            db.execute_batch(corruption).unwrap();
            drop(db);
            let path = dir.0.join("memory.sqlite3");
            let original = std::fs::read(&path).unwrap();

            assert!(load(&dir.0).is_err(), "{corruption}");
            assert!(save(&dir.0, &memory()).is_err(), "{corruption}");
            assert_eq!(std::fs::read(&path).unwrap(), original, "{corruption}");
        }
    }

    #[test]
    fn corrupt_and_future_snapshots_fail_repeated_loads_without_overwriting_data() {
        for invalid in ["broken", "[]", "{\"version\":4}", "{\"episodes\":{}}"] {
            let dir = Directory::new();
            save(&dir.0, &memory()).unwrap();
            let db = open(&dir.0).unwrap();
            db.execute("UPDATE snapshot SET data = ?1", [invalid])
                .unwrap();

            assert!(load(&dir.0).is_err());
            assert!(load(&dir.0).is_err());
            assert_eq!(read_snapshot(&db).unwrap().as_deref(), Some(invalid));
        }
    }

    #[test]
    fn normalizing_missing_history_cannot_exceed_the_snapshot_size_limit() {
        let dir = Directory::new();
        save(&dir.0, &memory()).unwrap();
        let mut missing_history = serde_json::json!({"version": 3, "padding": ""});
        let padding_bytes = MAX_BYTES - missing_history.to_string().len();
        missing_history["padding"] = serde_json::json!("x".repeat(padding_bytes));
        assert_eq!(missing_history.to_string().len(), MAX_BYTES);

        assert!(save(&dir.0, &missing_history).is_err());
        assert_eq!(load(&dir.0).unwrap(), memory());
    }

    #[test]
    fn oversized_imports_saves_and_migrations_preserve_the_original_data() {
        let dir = Directory::new();
        let mut oversized = memory();
        oversized["extra"] = serde_json::json!("x".repeat(MAX_BYTES));
        let original = oversized.to_string();
        std::fs::write(dir.0.join("roommate.json"), &original).unwrap();

        assert!(load(&dir.0).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.0.join("roommate.json")).unwrap(),
            original
        );
        save(&dir.0, &memory()).unwrap();
        assert!(save(&dir.0, &oversized).is_err());
        assert_eq!(load(&dir.0).unwrap(), memory());

        let migration_dir = Directory::new();
        let db = version_one_store(&migration_dir, Some(&oversized));
        let snapshot_before = read_snapshot(&db).unwrap();
        assert!(load(&migration_dir.0).is_err());
        assert_eq!(schema_version(&db), 1);
        assert_eq!(read_snapshot(&db).unwrap(), snapshot_before);
        require_tables(&db, &["episodes", "snapshot"]).unwrap();
    }

    #[test]
    fn setting_aside_unreadable_memories_keeps_them_and_starts_fresh() {
        let dir = Directory::new();
        save(&dir.0, &memory()).unwrap();
        open(&dir.0)
            .unwrap()
            .execute_batch("PRAGMA user_version = 999")
            .unwrap();
        std::fs::write(dir.0.join("roommate.json"), "broken").unwrap();
        let original = std::fs::read(dir.0.join("memory.sqlite3")).unwrap();
        assert!(load(&dir.0).is_err());

        set_aside(&dir.0, 7).unwrap();

        assert_eq!(
            std::fs::read(dir.0.join("memory.sqlite3.unreadable-7")).unwrap(),
            original
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("roommate.json.unreadable-7")).unwrap(),
            "broken"
        );
        assert_eq!(load(&dir.0).unwrap(), Value::Null);
        assert!(set_aside(&dir.0, 7).is_err());
    }
}
