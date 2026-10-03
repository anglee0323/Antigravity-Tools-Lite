use crate::modules::version::compare_version;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tracing::info;

const GITHUB_API_URL: &str =
    "https://api.github.com/repos/anglee0323/antigravity-tools-lite/releases/latest";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_name: String,
    pub release_notes: String,
    pub release_url: String,
    pub asset_name: Option<String>,
    pub download_url: Option<String>,
    pub asset_size: Option<u64>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GithubReleaseAsset {
    pub name: String,
    pub size: u64,
    pub browser_download_url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GithubReleaseResponse {
    pub tag_name: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub html_url: String,
    pub published_at: Option<String>,
    pub assets: Vec<GithubReleaseAsset>,
}

/// Helper function to match suitable installer/archive asset for the current OS and architecture
pub fn find_matching_asset(assets: &[GithubReleaseAsset]) -> Option<&GithubReleaseAsset> {
    #[cfg(target_os = "windows")]
    {
        // On Windows: look for .exe installer, excluding .sha256
        assets.iter().find(|a| {
            let lower = a.name.to_lowercase();
            lower.ends_with(".exe") && !lower.ends_with(".sha256")
        })
    }

    #[cfg(target_os = "macos")]
    {
        #[cfg(target_arch = "aarch64")]
        let preferred = "arm64";
        #[cfg(not(target_arch = "aarch64"))]
        let preferred = "x64";

        assets
            .iter()
            .find(|a| {
                let lower = a.name.to_lowercase();
                (lower.ends_with(".zip") || lower.ends_with(".dmg"))
                    && lower.contains("macos")
                    && lower.contains(preferred)
                    && !lower.ends_with(".sha256")
            })
            .or_else(|| {
                assets.iter().find(|a| {
                    let lower = a.name.to_lowercase();
                    (lower.ends_with(".zip") || lower.ends_with(".dmg"))
                        && lower.contains("macos")
                        && !lower.ends_with(".sha256")
                })
            })
    }

    #[cfg(target_os = "linux")]
    {
        assets.iter().find(|a| {
            let lower = a.name.to_lowercase();
            (lower.ends_with(".deb") || lower.ends_with(".appimage")) && !lower.ends_with(".sha256")
        })
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

/// Parse release data and determine if an update is available compared to current version
pub fn evaluate_release(
    current_version: &str,
    release: GithubReleaseResponse,
) -> UpdateInfo {
    let latest_clean = release
        .tag_name
        .trim_start_matches(|c| c == 'v' || c == 'V')
        .to_string();
    let current_clean = current_version
        .trim_start_matches(|c| c == 'v' || c == 'V')
        .to_string();

    let has_update = compare_version(&latest_clean, &current_clean) == std::cmp::Ordering::Greater;
    let matched_asset = find_matching_asset(&release.assets);

    UpdateInfo {
        current_version: current_version.to_string(),
        latest_version: release.tag_name.clone(),
        has_update,
        release_name: release.name.unwrap_or_else(|| release.tag_name.clone()),
        release_notes: release.body.unwrap_or_default(),
        release_url: release.html_url,
        asset_name: matched_asset.map(|a| a.name.clone()),
        download_url: matched_asset.map(|a| a.browser_download_url.clone()),
        asset_size: matched_asset.map(|a| a.size),
        published_at: release.published_at,
    }
}

/// Query GitHub Releases API for the latest release
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("antigravity-tools-updater")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(GITHUB_API_URL)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Network error checking for updates: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to query GitHub API: HTTP {}",
            response.status()
        ));
    }

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let release: GithubReleaseResponse = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse release response: {}", e))?;

    Ok(evaluate_release(current_version, release))
}

/// Download installer/update asset and trigger installation / restart
pub async fn download_and_install_update(
    app: AppHandle,
    download_url: String,
    asset_name: String,
) -> Result<String, String> {
    info!(
        "Starting download of update: {} ({})",
        asset_name, download_url
    );

    let temp_dir = std::env::temp_dir().join("antigravity-tools-update");
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let target_path = temp_dir.join(&asset_name);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .user_agent("antigravity-tools-updater")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: HTTP {}",
            response.status()
        ));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = tokio::fs::File::create(&target_path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;

    use tokio::io::AsyncWriteExt;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Download stream error: {}", e))?
    {
        downloaded += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write chunk: {}", e))?;

        let percentage = if total_size > 0 {
            (downloaded as f64 / total_size as f64) * 100.0
        } else {
            0.0
        };

        let _ = app.emit(
            "updater-download-progress",
            DownloadProgress {
                downloaded,
                total: total_size,
                percentage,
            },
        );
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush downloaded file: {}", e))?;
    drop(file);

    info!("Update downloaded to: {:?}", target_path);

    // Launch installer and exit app
    #[cfg(target_os = "windows")]
    {
        info!("Spawning Windows installer: {:?}", target_path);
        std::process::Command::new(&target_path)
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {}", e))?;

        // Allow child process to start, then exit current app so installer can overwrite files
        let app_handle = app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            app_handle.exit(0);
        });

        Ok("已启动安装程序，应用正在准备重启...".to_string())
    }

    #[cfg(target_os = "macos")]
    {
        info!("Opening macOS update file: {:?}", target_path);
        std::process::Command::new("open")
            .arg("-R")
            .arg(&target_path)
            .spawn()
            .map_err(|e| format!("Failed to reveal update archive in Finder: {}", e))?;

        Ok("已下载更新包并在访达中显示".to_string())
    }

    #[cfg(target_os = "linux")]
    {
        info!("Opening Linux package: {:?}", target_path);
        std::process::Command::new("xdg-open")
            .arg(&target_path)
            .spawn()
            .map_err(|e| format!("Failed to open package: {}", e))?;

        Ok("已下载更新包并尝试打开安装程序".to_string())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Ok(format!("更新文件已保存至: {:?}", target_path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_evaluate_release_newer() {
        let release = GithubReleaseResponse {
            tag_name: "v4.8.0".to_string(),
            name: Some("Version 4.8.0".to_string()),
            body: Some("Exciting new features".to_string()),
            html_url: "https://github.com/example/releases/v4.8.0".to_string(),
            published_at: Some("2026-10-02T00:00:00Z".to_string()),
            assets: vec![
                GithubReleaseAsset {
                    name: "Antigravity-Tools-Lite-4.8.0-windows-x64-setup.exe".to_string(),
                    size: 9000000,
                    browser_download_url: "https://example.com/download/setup.exe".to_string(),
                },
                GithubReleaseAsset {
                    name: "Antigravity-Tools-Lite-4.8.0-windows-x64-setup.exe.sha256".to_string(),
                    size: 100,
                    browser_download_url: "https://example.com/download/setup.exe.sha256".to_string(),
                },
            ],
        };

        let info = evaluate_release("4.7.7", release);
        assert!(info.has_update);
        assert_eq!(info.current_version, "4.7.7");
        assert_eq!(info.latest_version, "v4.8.0");

        #[cfg(target_os = "windows")]
        {
            assert_eq!(
                info.asset_name,
                Some("Antigravity-Tools-Lite-4.8.0-windows-x64-setup.exe".to_string())
            );
            assert_eq!(
                info.download_url,
                Some("https://example.com/download/setup.exe".to_string())
            );
        }
    }

    #[test]
    fn test_evaluate_release_equal_or_older() {
        let release = GithubReleaseResponse {
            tag_name: "v4.7.7".to_string(),
            name: Some("Version 4.7.7".to_string()),
            body: None,
            html_url: "https://github.com/example/releases/v4.7.7".to_string(),
            published_at: None,
            assets: vec![],
        };

        let info = evaluate_release("4.7.7", release.clone());
        assert!(!info.has_update);

        let info_older = evaluate_release("4.8.0", release);
        assert!(!info_older.has_update);
    }
}
