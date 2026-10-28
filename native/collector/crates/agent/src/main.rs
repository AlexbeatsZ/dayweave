use anyhow::{ensure, Result};
use clap::{Parser, Subcommand};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use work_review_core::{
    config::{default_agent_dir, save_json, AgentConfig},
    database::{lock_directory, Store},
    model::AgentStatus,
};

#[derive(Parser)]
#[command(version, about = "Work Review quiet personal activity collector")]
struct Cli {
    #[arg(long,global=true,default_value_os_t=default_agent_dir())]
    data_dir: PathBuf,
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Init {
        #[arg(long)]
        server: Option<String>,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        from: Option<PathBuf>,
        #[arg(long)]
        token_stdin: bool,
    },
    Run {
        #[arg(long)]
        duration: Option<u64>,
        #[arg(long)]
        host_managed: bool,
    },
    Config {
        #[arg(long = "set")]
        values: Vec<String>,
        #[arg(long)]
        token_stdin: bool,
    },
    Status,
    Doctor {
        #[arg(long)]
        request_permissions: bool,
    },
    Sync,
    ImportLegacy {
        #[arg(long)]
        database: PathBuf,
        #[arg(long)]
        screenshots_root: PathBuf,
    },
}
fn read_token() -> Result<String> {
    use std::io::Read;
    let mut token = String::new();
    std::io::stdin().read_to_string(&mut token)?;
    Ok(token.trim().into())
}
fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        // Hub traffic stays on the user's direct LAN/Tailscale route.
        .no_proxy()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()?)
}
#[tokio::main]
async fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();
    let cli = Cli::parse();
    let config_path = cli.data_dir.join("config.json");
    match cli.command {
        Command::Init {
            server,
            name,
            from,
            token_stdin,
        } => {
            let _lock = lock_directory(&cli.data_dir, "config.lock")?;
            ensure!(
                !config_path.exists(),
                "config already exists; use config --set"
            );
            let mut config = AgentConfig::default();
            if let Some(path) = from {
                config.import_desktop(&path)?;
            }
            if let Some(name) = name {
                config.device.name = name;
            }
            #[cfg(target_os = "macos")]
            if config.device.name == "我的设备" {
                if let Ok(output) = std::process::Command::new("/usr/sbin/scutil")
                    .args(["--get", "ComputerName"])
                    .output()
                {
                    config.device.name = String::from_utf8_lossy(&output.stdout).trim().into();
                }
            }
            config.server_url = server;
            if token_stdin {
                config.token = Some(read_token()?);
            }
            config.validate()?;
            save_json(&config_path, &config)?;
            println!("Initialized {} ({})", config.device.name, config.device.id);
        }
        Command::Config {
            values,
            token_stdin,
        } => {
            let _lock = lock_directory(&cli.data_dir, "config.lock")?;
            let config = AgentConfig::load(&config_path)?;
            let mut json = serde_json::to_value(&config)?;
            let changed = !values.is_empty() || token_stdin;
            for pair in values {
                let (key, text) = pair
                    .split_once('=')
                    .ok_or_else(|| anyhow::anyhow!("use key=value"))?;
                ensure!(
                    key != "device.id" && key != "device.platform",
                    "device identity is immutable"
                );
                let keys: Vec<_> = key.split('.').collect();
                let mut cursor = &mut json;
                for key in keys {
                    cursor = cursor
                        .get_mut(key)
                        .ok_or_else(|| anyhow::anyhow!("unknown setting {key}"))?;
                }
                *cursor = serde_json::from_str(text)
                    .unwrap_or_else(|_| serde_json::Value::String(text.into()));
            }
            if token_stdin {
                json["token"] = serde_json::Value::String(read_token()?);
            }
            let config: AgentConfig = serde_json::from_value(json)?;
            config.validate()?;
            if changed {
                save_json(&config_path, &config)?;
            }
            let mut json = serde_json::to_value(config)?;
            if !json["token"].is_null() {
                json["token"] = "[redacted]".into();
            }
            println!("{}", serde_json::to_string_pretty(&json)?);
        }
        Command::Doctor {
            request_permissions,
        } => {
            let config = AgentConfig::load(&config_path)?;
            #[cfg(any(windows, target_os = "macos"))]
            {
                use work_review_agent::screenshot;
                if request_permissions {
                    screenshot::has_accessibility_permission(true);
                    #[cfg(target_os = "macos")]
                    if config.storage.screenshots_enabled {
                        screenshot::request_screen_capture_permission();
                    }
                }
                println!(
                    "{}",
                    serde_json::json!({"platform":std::env::consts::OS,"accessibility":screenshot::has_accessibility_permission(false),"screen_capture":screenshot::has_screen_capture_permission(),"screenshots_enabled":config.storage.screenshots_enabled,"server_configured":config.server_url.is_some()})
                );
            }
            #[cfg(not(any(windows, target_os = "macos")))]
            {
                let _ = (config, request_permissions);
                anyhow::bail!("collector supports Windows/macOS");
            }
        }
        Command::Status => {
            let store = Store::open(&cli.data_dir.join("agent.db"))?;
            let status = std::fs::read_to_string(cli.data_dir.join("status.json"))
                .unwrap_or_else(|_| "{}".into());
            println!(
                "{}",
                serde_json::json!({"pending":store.pending_count()?,"status":serde_json::from_str::<serde_json::Value>(&status)?})
            );
        }
        Command::Sync => {
            let _lock = lock_directory(&cli.data_dir, "sync.lock")?;
            let config = AgentConfig::load(&config_path)?;
            ensure!(config.server_url.is_some(), "configure server_url first");
            let mut store = Store::open(&cli.data_dir.join("agent.db"))?;
            let client = client()?;
            let mut total = 0;
            loop {
                let count = work_review_agent::sync::synchronize(
                    &client,
                    &mut store,
                    &config,
                    AgentStatus {
                        state: "syncing".into(),
                        version: env!("CARGO_PKG_VERSION").into(),
                        ..Default::default()
                    },
                )
                .await?;
                total += count;
                if count == 0 {
                    break;
                }
            }
            println!("Synchronized {total} records");
        }
        Command::ImportLegacy {
            database,
            screenshots_root,
        } => {
            let _lock = lock_directory(&cli.data_dir, "import.lock")?;
            let config = AgentConfig::load(&config_path)?;
            let store = Store::open(&cli.data_dir.join("agent.db"))?;
            let count = work_review_agent::legacy::import(
                &store,
                &database,
                &screenshots_root,
                &cli.data_dir,
                &config.device.id,
            )?;
            println!("Imported {count} records; originals preserved");
        }
        Command::Run {
            duration,
            host_managed,
        } => run(cli.data_dir, duration, host_managed).await?,
    }
    Ok(())
}

async fn run(directory: PathBuf, duration: Option<u64>, host_managed: bool) -> Result<()> {
    #[cfg(not(any(windows, target_os = "macos")))]
    anyhow::bail!("collector supports Windows/macOS");
    let _lock = lock_directory(&directory, "agent.lock")?;
    let _sync_lock = lock_directory(&directory, "sync.lock")?;
    let path = directory.join("config.json");
    AgentConfig::load(&path)?;
    // Initialize WAL and schema before opening either scheduling loop.
    let mut store = Store::open(&directory.join("agent.db"))?;
    let worker_store = Store::open(&directory.join("agent.db"))?;
    let client = client()?;
    let stopping = Arc::new(AtomicBool::new(false));
    if host_managed {
        let host_stop = stopping.clone();
        std::thread::spawn(move || {
            use std::io::Read;
            let _ = std::io::stdin().read_to_end(&mut Vec::new());
            host_stop.store(true, Ordering::Relaxed);
        });
    }
    let status = Arc::new(Mutex::new(AgentStatus {
        state: "starting".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        ..Default::default()
    }));
    let worker_stop = stopping.clone();
    let worker_status = status.clone();
    let worker_directory = directory.clone();
    let worker = std::thread::spawn(move || -> Result<()> {
        let mut store = worker_store;
        let mut clock = work_review_agent::capture::CaptureClock::default();
        let mut cleanup = Instant::now();
        while !worker_stop.load(Ordering::Relaxed) {
            let started = Instant::now();
            let config = match AgentConfig::load(&worker_directory.join("config.json")) {
                Ok(config) => config,
                Err(e) => {
                    clock.reset();
                    let mut state = worker_status.lock().unwrap();
                    state.state = "error".into();
                    state.last_error = Some(format!("配置无法读取: {e}"));
                    drop(state);
                    std::thread::sleep(Duration::from_secs(1));
                    continue;
                }
            };
            let sample =
                work_review_agent::capture::sample(&worker_directory, &config, &mut clock)?;
            if let Some(activity) = sample.activity {
                store.enqueue(&activity, sample.screenshot_path.as_deref())?;
            }
            {
                let mut state = worker_status.lock().unwrap();
                state.state = sample.state;
                state.last_error = sample.error;
                state.pending = store.pending_count()?;
            }
            if cleanup.elapsed() >= Duration::from_secs(3600) {
                store.cleanup(chrono::Utc::now().timestamp(), &config.storage)?;
                cleanup = Instant::now();
            }
            while !worker_stop.load(Ordering::Relaxed)
                && started.elapsed() < Duration::from_secs(config.screenshot_interval)
            {
                std::thread::sleep(Duration::from_millis(200));
            }
        }
        Ok(())
    });
    let started = Instant::now();
    let mut next_sync = Instant::now();
    let mut last_sync = None;
    let mut sync_error: Option<String> = None;
    let result:Result<()> = async {
        loop {
            if stopping.load(Ordering::Relaxed) { break; }
            if worker.is_finished() { anyhow::bail!("capture worker stopped unexpectedly"); }
            let config=match AgentConfig::load(&path) {
                Ok(config)=>config,
                Err(error)=> {
                    save_json(&directory.join("status.json"),&serde_json::json!({"updated_at":chrono::Utc::now().timestamp(),"pid":std::process::id(),"running":true,"capture":{"state":"error","last_error":format!("配置无法读取: {error}")},"pending":store.pending_count()?}))?;
                    if duration.is_some_and(|seconds|started.elapsed()>=Duration::from_secs(seconds)) { break; }
                    tokio::select! { result=tokio::signal::ctrl_c()=> { result?; break; }, _=tokio::time::sleep(Duration::from_secs(1))=>{} }
                    continue;
                }
            };
            let snapshot=status.lock().unwrap().clone();
            if Instant::now()>=next_sync {
                match work_review_agent::sync::synchronize(&client,&mut store,&config,snapshot.clone()).await {
                    Ok(_)=> { if config.server_url.is_some() { last_sync=Some(chrono::Utc::now().timestamp()); } sync_error=None; },
                    Err(e)=>sync_error=Some(format!("同步失败，记录保留在本机: {e}")),
                }
                // Drain a backlog at a bounded rate; heartbeats remain periodic when the queue is empty.
                next_sync=Instant::now()+Duration::from_secs(if config.server_url.is_some() && sync_error.is_none() && store.pending_count()?>0 { 1 } else { config.sync_interval });
            }
            save_json(&directory.join("status.json"),&serde_json::json!({"updated_at":chrono::Utc::now().timestamp(),"pid":std::process::id(),"running":true,"capture":snapshot,"pending":store.pending_count()?,"last_sync":last_sync,"sync_error":sync_error}))?;
            if duration.is_some_and(|seconds|started.elapsed()>=Duration::from_secs(seconds)) { break; }
            tokio::select! { result=tokio::signal::ctrl_c()=> { result?; break; }, _=tokio::time::sleep(Duration::from_secs(1))=>{} }
        }
        Ok(())
    }.await;
    stopping.store(true, Ordering::Relaxed);
    let worker_result = tokio::task::spawn_blocking(move || {
        worker
            .join()
            .map_err(|_| anyhow::anyhow!("capture worker panicked"))?
    })
    .await?;
    save_json(
        &directory.join("status.json"),
        &serde_json::json!({"updated_at":chrono::Utc::now().timestamp(),"running":false,"pending":store.pending_count()?}),
    )?;
    result?;
    worker_result
}
