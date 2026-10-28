use anyhow::{ensure, Context, Result};
use base64::Engine;
use work_review_core::{config::AgentConfig, database::Store, model::*};

pub async fn synchronize(
    client: &reqwest::Client,
    store: &mut Store,
    config: &AgentConfig,
    mut status: AgentStatus,
) -> Result<usize> {
    let Some(server) = &config.server_url else {
        return Ok(0);
    };
    let pending = store.pending(16)?;
    let mut activities = Vec::new();
    let mut bytes = 0usize;
    for item in pending {
        let screenshot_base64 = if let Some(path) = item.screenshot_path {
            let image = std::fs::read(&path)
                .with_context(|| format!("queued screenshot missing: {}", path.display()))?;
            ensure!(image.len() <= 8 * 1024 * 1024, "screenshot exceeds 8 MB");
            if bytes + image.len() > 20 * 1024 * 1024 && !activities.is_empty() {
                break;
            }
            bytes += image.len();
            Some(base64::engine::general_purpose::STANDARD.encode(image))
        } else {
            None
        };
        activities.push(Upload {
            activity: item.activity,
            screenshot_base64,
        });
    }
    status.pending = store.pending_count()?;
    let batch = Batch {
        device: config.device.clone(),
        status,
        activities,
    };
    let response = client
        .post(format!("{}/api/ingest", server.trim_end_matches('/')))
        .bearer_auth(config.token.as_deref().unwrap_or_default())
        .json(&batch)
        .send()
        .await?;
    ensure!(
        response.status().is_success(),
        "hub returned HTTP {}",
        response.status()
    );
    let ack: Acknowledgment = response.json().await?;
    let expected: std::collections::HashSet<_> = batch
        .activities
        .iter()
        .map(|a| a.activity.id.as_str())
        .collect();
    ensure!(
        ack.accepted.iter().all(|id| expected.contains(id.as_str())),
        "hub acknowledged an unknown record"
    );
    store.acknowledge(&config.device.id, &ack.accepted)?;
    Ok(ack.accepted.len())
}
