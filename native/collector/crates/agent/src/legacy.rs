use anyhow::{Context, Result};
use rusqlite::{Connection, OpenFlags};
use std::path::Path;
use work_review_core::{database::Store, model::Activity};

/// Import reads the old desktop DB; interval end timestamps become interval starts.
pub fn import(
    store: &Store,
    database: &Path,
    screenshots_root: &Path,
    directory: &Path,
    device: &str,
) -> Result<usize> {
    let old = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let columns: Vec<String> = old
        .prepare("PRAGMA table_info(activities)")?
        .query_map([], |row| row.get(1))?
        .collect::<std::result::Result<_, _>>()?;
    let optional = |name: &str| {
        if columns.iter().any(|c| c == name) {
            name.to_string()
        } else {
            format!("NULL AS {name}")
        }
    };
    let sql=format!("SELECT id,timestamp,duration,app_name,window_title,category,screenshot_path,{}, {}, {}, {} FROM activities WHERE duration>0 ORDER BY id",optional("browser_url"),optional("ocr_text"),optional("intent_purpose"),optional("intent_note"));
    let mut statement = old.prepare(&sql)?;
    let source = database.canonicalize()?.to_string_lossy().into_owned();
    let mut rows = statement.query([])?;
    let mut count = 0;
    while let Some(row) = rows.next()? {
        let old_id: i64 = row.get(0)?;
        let timestamp: i64 = row.get(1)?;
        let duration: i64 = row.get(2)?;
        // Long merged legacy records are split without truncating their duration.
        let mut start = (timestamp - duration).max(0);
        let end = timestamp;
        let old_screenshot: String = row.get::<_, Option<String>>(6)?.unwrap_or_default();
        while start < end {
            let id = uuid::Uuid::new_v5(
                &uuid::Uuid::NAMESPACE_URL,
                format!("{device}:{source}:{old_id}:{start}").as_bytes(),
            )
            .to_string();
            let screenshot = if old_screenshot.is_empty() {
                None
            } else {
                let path = screenshots_root.join(&old_screenshot);
                if path.is_file() {
                    let target = directory
                        .join("screenshots/imported")
                        .join(format!("{id}.jpg"));
                    std::fs::create_dir_all(target.parent().unwrap())?;
                    if !target.exists() {
                        std::fs::copy(&path, &target)
                            .with_context(|| format!("copy {}", path.display()))?;
                    }
                    Some(target)
                } else {
                    None
                }
            };
            let purpose: Option<String> = row.get(9)?;
            let note: Option<String> = row.get(10)?;
            let activity = Activity {
                id,
                device_id: device.into(),
                timestamp: start,
                duration: (end - start).min(86400),
                app_name: row.get(3)?,
                window_title: row.get(4)?,
                category: row.get(5)?,
                browser_url: row.get(7)?,
                ocr_text: row.get(8)?,
                screenshot: screenshot.is_some(),
                note: [purpose.unwrap_or_default(), note.unwrap_or_default()]
                    .into_iter()
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n"),
            };
            if store.enqueue(&activity, screenshot.as_deref())? {
                count += 1;
            }
            start += activity.duration;
        }
    }
    Ok(count)
}
