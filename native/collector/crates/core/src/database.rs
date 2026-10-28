use crate::model::*;
use anyhow::{ensure, Result};
use rusqlite::{params, Connection};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::Duration,
};

pub struct Store {
    pub connection: Connection,
}
pub struct Pending {
    pub activity: Activity,
    pub screenshot_path: Option<PathBuf>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL, last_seen INTEGER NOT NULL, status TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events(device_id TEXT NOT NULL, id TEXT NOT NULL, timestamp INTEGER NOT NULL, duration INTEGER NOT NULL, app_name TEXT NOT NULL, title TEXT NOT NULL, payload TEXT NOT NULL, screenshot_path TEXT, synced INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(device_id,id));
            CREATE INDEX IF NOT EXISTS events_time ON events(timestamp DESC,id DESC);
            CREATE INDEX IF NOT EXISTS events_device_time ON events(device_id,timestamp);
            CREATE INDEX IF NOT EXISTS events_pending ON events(synced,timestamp);")?;
        Ok(Self { connection })
    }
    pub fn enqueue(&self, activity: &Activity, screenshot: Option<&Path>) -> Result<bool> {
        activity.validate(&activity.device_id)?;
        Ok(self.connection.execute("INSERT OR IGNORE INTO events(device_id,id,timestamp,duration,app_name,title,payload,screenshot_path) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![activity.device_id, activity.id, activity.timestamp, activity.duration, activity.app_name, activity.window_title, serde_json::to_string(activity)?, screenshot.map(|p| p.to_string_lossy().into_owned())])? > 0)
    }
    pub fn pending_count(&self) -> Result<i64> {
        Ok(self
            .connection
            .query_row("SELECT count(*) FROM events WHERE synced=0", [], |r| {
                r.get(0)
            })?)
    }
    pub fn pending(&self, limit: usize) -> Result<Vec<Pending>> {
        let mut statement = self.connection.prepare("SELECT payload,screenshot_path FROM events WHERE synced=0 ORDER BY timestamp,id LIMIT ?1")?;
        let rows = statement.query_map([limit as i64], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })?;
        rows.map(|row| {
            let (json, path) = row?;
            Ok(Pending {
                activity: serde_json::from_str(&json)?,
                screenshot_path: path.map(PathBuf::from),
            })
        })
        .collect()
    }
    pub fn acknowledge(&mut self, device: &str, ids: &[String]) -> Result<()> {
        let transaction = self.connection.transaction()?;
        for id in ids {
            transaction.execute(
                "UPDATE events SET synced=1 WHERE device_id=?1 AND id=?2",
                params![device, id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }
    pub fn ingest(
        &mut self,
        batch: &Batch,
        paths: &[Option<PathBuf>],
        now: i64,
    ) -> Result<Acknowledgment> {
        ensure!(
            paths.len() == batch.activities.len(),
            "screenshot count mismatch"
        );
        let transaction = self.connection.transaction()?;
        transaction.execute("INSERT INTO devices(id,name,platform,last_seen,status) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET name=excluded.name,platform=excluded.platform,last_seen=excluded.last_seen,status=excluded.status",
            params![batch.device.id, batch.device.name, batch.device.platform, now, serde_json::to_string(&batch.status)?])?;
        for (upload, path) in batch.activities.iter().zip(paths) {
            let a = &upload.activity;
            a.validate(&batch.device.id)?;
            transaction.execute("INSERT OR IGNORE INTO events(device_id,id,timestamp,duration,app_name,title,payload,screenshot_path,synced) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,1)",
                params![a.device_id,a.id,a.timestamp,a.duration,a.app_name,a.window_title,serde_json::to_string(a)?,path.as_ref().map(|p| p.to_string_lossy().into_owned())])?;
        }
        transaction.commit()?;
        Ok(Acknowledgment {
            accepted: batch
                .activities
                .iter()
                .map(|a| a.activity.id.clone())
                .collect(),
        })
    }
    pub fn devices(&self) -> Result<Vec<DeviceView>> {
        let mut statement = self
            .connection
            .prepare("SELECT id,name,platform,last_seen,status FROM devices ORDER BY name,id")?;
        let rows = statement.query_map([], |r| {
            Ok((
                Device {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    platform: r.get(2)?,
                },
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?;
        rows.map(|row| {
            let (device, last_seen, json) = row?;
            Ok(DeviceView {
                device,
                last_seen,
                status: serde_json::from_str(&json)?,
            })
        })
        .collect()
    }
    pub fn activities(&self, query: &RangeQuery) -> Result<ActivityPage> {
        query.validate()?;
        let limit = query.limit.unwrap_or(100).clamp(1, 500);
        let mut statement = self.connection.prepare("SELECT payload FROM events WHERE timestamp<?2 AND timestamp+duration>?1 AND (?3 IS NULL OR device_id=?3) AND (?4 IS NULL OR instr(lower(title||char(10)||app_name||char(10)||coalesce(json_extract(payload,'$.ocr_text'),'')||char(10)||coalesce(json_extract(payload,'$.browser_url'),'')||char(10)||coalesce(json_extract(payload,'$.note'),'')),lower(?4))>0) AND (?5 IS NULL OR timestamp<?5 OR (timestamp=?5 AND (id<?6 OR (id=?6 AND device_id<?7)))) ORDER BY timestamp DESC,id DESC,device_id DESC LIMIT ?8")?;
        let mut items: Vec<Activity> = statement
            .query_map(
                params![
                    query.from,
                    query.to,
                    query.device,
                    query.q.as_deref().filter(|s| !s.is_empty()),
                    query.before_time,
                    query.before_id,
                    query.before_device,
                    (limit + 1) as i64
                ],
                |r| r.get::<_, String>(0),
            )?
            .map(|row| Ok(serde_json::from_str(&row?)?))
            .collect::<Result<_>>()?;
        let more = items.len() > limit;
        items.truncate(limit);
        let next = if more {
            items.last().map(|a| Cursor {
                timestamp: a.timestamp,
                id: a.id.clone(),
                device_id: a.device_id.clone(),
            })
        } else {
            None
        };
        Ok(ActivityPage { items, next })
    }
    pub fn overview(&self, query: &RangeQuery) -> Result<Overview> {
        query.validate()?;
        let mut statement = self.connection.prepare("SELECT timestamp,duration,device_id,app_name FROM events WHERE timestamp<?2 AND timestamp+duration>?1 AND (?3 IS NULL OR device_id=?3) AND (?4 IS NULL OR instr(lower(title||char(10)||app_name||char(10)||coalesce(json_extract(payload,'$.ocr_text'),'')||char(10)||coalesce(json_extract(payload,'$.browser_url'),'')||char(10)||coalesce(json_extract(payload,'$.note'),'')),lower(?4))>0) ORDER BY timestamp,id,device_id")?;
        let rows = statement.query_map(
            params![
                query.from,
                query.to,
                query.device,
                query.q.as_deref().filter(|s| !s.is_empty())
            ],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            },
        )?;
        let mut active_seconds = 0;
        let mut end = query.from;
        let mut device_seconds = 0;
        let mut count = 0;
        let mut apps = BTreeMap::<String, i64>::new();
        let mut devices = BTreeMap::<String, DeviceUsage>::new();
        let hours = ((query.to - query.from + 3599) / 3600) as usize;
        for row in rows {
            let (timestamp, duration, device, app) = row?;
            let start = timestamp.max(query.from);
            let stop = (timestamp + duration).min(query.to);
            let seconds = stop - start;
            count += 1;
            device_seconds += seconds;
            active_seconds += (stop - start.max(end)).max(0);
            end = end.max(stop);
            *apps.entry(app).or_default() += seconds;
            let usage = devices
                .entry(device.clone())
                .or_insert_with(|| DeviceUsage {
                    device_id: device,
                    duration: 0,
                    hours: vec![0; hours],
                });
            usage.duration += seconds;
            let mut segment = start;
            while segment < stop {
                let hour = ((segment - query.from) / 3600) as usize;
                let segment_end = stop.min(query.from + (hour as i64 + 1) * 3600);
                usage.hours[hour] += segment_end - segment;
                segment = segment_end;
            }
        }
        let mut apps: Vec<_> = apps
            .into_iter()
            .map(|(app_name, duration)| AppUsage { app_name, duration })
            .collect();
        apps.sort_by(|a, b| {
            b.duration
                .cmp(&a.duration)
                .then(a.app_name.cmp(&b.app_name))
        });
        Ok(Overview {
            active_seconds,
            device_seconds,
            count,
            apps,
            devices: devices.into_values().collect(),
        })
    }
    pub fn screenshot_path(&self, device: &str, id: &str) -> Result<Option<PathBuf>> {
        use rusqlite::OptionalExtension;
        Ok(self
            .connection
            .query_row(
                "SELECT screenshot_path FROM events WHERE device_id=?1 AND id=?2",
                params![device, id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten()
            .map(PathBuf::from))
    }
    pub fn set_note(&self, device: &str, id: &str, note: &str) -> Result<bool> {
        ensure!(note.len() <= 16_384, "note too long");
        Ok(self.connection.execute(
            "UPDATE events SET payload=json_set(payload,'$.note',?3) WHERE device_id=?1 AND id=?2",
            params![device, id, note],
        )? > 0)
    }
    /// Retention may only remove acknowledged local records. Never delete the outbox.
    pub fn cleanup(&mut self, now: i64, config: &crate::config::StorageConfig) -> Result<()> {
        let metadata_cutoff = if config.metadata_retention_days == 0 {
            i64::MIN
        } else {
            now - config.metadata_retention_days as i64 * 86400
        };
        let image_cutoff = if config.screenshot_retention_days == 0 {
            i64::MIN
        } else {
            now - config.screenshot_retention_days as i64 * 86400
        };
        let mut statement=self.connection.prepare("SELECT device_id,id,timestamp,synced,screenshot_path FROM events WHERE screenshot_path IS NOT NULL ORDER BY timestamp")?;
        let images: Vec<_> = statement
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, bool>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })?
            .collect::<std::result::Result<_, _>>()?;
        drop(statement);
        let mut size: u64 = images
            .iter()
            .map(|r| std::fs::metadata(&r.4).map(|m| m.len()).unwrap_or(0))
            .sum();
        for (device, id, timestamp, synced, path) in images {
            if synced
                && (timestamp < image_cutoff
                    || timestamp < metadata_cutoff
                    || size > config.storage_limit_mb as u64 * 1024 * 1024)
            {
                let length = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                match std::fs::remove_file(&path) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                }
                self.connection.execute(
                    "UPDATE events SET screenshot_path=NULL WHERE device_id=?1 AND id=?2",
                    params![device, id],
                )?;
                size = size.saturating_sub(length);
            }
        }
        self.connection.execute(
            "DELETE FROM events WHERE synced=1 AND timestamp+duration<?1",
            [metadata_cutoff],
        )?;
        Ok(())
    }
}

pub fn lock_directory(directory: &Path, name: &str) -> Result<std::fs::File> {
    std::fs::create_dir_all(directory)?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join(name))?;
    fs2::FileExt::try_lock_exclusive(&file)
        .map_err(|_| anyhow::anyhow!("another process is already using {}", directory.display()))?;
    Ok(file)
}
