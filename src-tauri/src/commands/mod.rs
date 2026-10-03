use crate::models::{Account, AppConfig, QuotaData};
use crate::modules;
use tauri::Emitter;

/// 列出所有账号
#[tauri::command]
pub async fn list_accounts() -> Result<Vec<Account>, String> {
    tokio::task::spawn_blocking(modules::list_accounts)
        .await
        .unwrap_or_else(|_| Err("Task panicked".to_string()))
}

/// Read-only, credential-free account dashboard with explicit index/read counts.
#[tauri::command]
pub async fn get_account_dashboard_snapshot(
) -> Result<modules::account_dashboard::DashboardSnapshot, String> {
    tokio::task::spawn_blocking(modules::account_dashboard::snapshot)
        .await
        .map_err(|_| "dashboard_task_failed".to_string())?
}

/// 添加账号
#[tauri::command]
pub async fn add_account(
    app: tauri::AppHandle,
    _email: String,
    refresh_token: String,
) -> Result<Account, String> {
    let service = modules::account_service::AccountService::new(
        crate::modules::integration::SystemManager::new(app.clone()),
    );

    let account = service.add_account(&refresh_token).await?;
    crate::modules::tray::update_tray_menus(&app);

    Ok(account)
}

/// 删除账号
/// 删除账号
#[tauri::command]
pub async fn delete_account(app: tauri::AppHandle, account_id: String) -> Result<(), String> {
    let service = modules::account_service::AccountService::new(
        crate::modules::integration::SystemManager::new(app.clone()),
    );
    service.delete_account(&account_id)?;

    Ok(())
}

/// 批量删除账号
#[tauri::command]
pub async fn delete_accounts(
    app: tauri::AppHandle,
    account_ids: Vec<String>,
) -> Result<(), String> {
    modules::logger::log_info(&format!(
        "收到批量删除请求，共 {} 个账号",
        account_ids.len()
    ));
    modules::account::delete_accounts(&account_ids).map_err(|e| {
        modules::logger::log_error(&format!("批量删除失败: {}", e));
        e
    })?;

    // 强制同步托盘
    crate::modules::tray::update_tray_menus(&app);

    Ok(())
}

/// 重新排序账号列表
/// 根据传入的账号ID数组顺序更新账号排列
#[tauri::command]
pub async fn reorder_accounts(account_ids: Vec<String>) -> Result<(), String> {
    modules::logger::log_info(&format!(
        "收到账号重排序请求，共 {} 个账号",
        account_ids.len()
    ));
    modules::account::reorder_accounts(&account_ids).map_err(|e| {
        modules::logger::log_error(&format!("账号重排序失败: {}", e));
        e
    })?;

    Ok(())
}

/// 切换账号
#[tauri::command]
pub async fn switch_account(
    app: tauri::AppHandle,
    account_id: String,
    target_ide: Option<String>,
) -> Result<(), String> {
    let service = modules::account_service::AccountService::new(
        crate::modules::integration::SystemManager::new(app.clone()),
    );

    service
        .switch_account(&account_id, target_ide.as_deref())
        .await?;

    // 同步托盘
    crate::modules::tray::update_tray_menus(&app);

    Ok(())
}

/// 获取当前账号
#[tauri::command]
pub async fn get_current_account() -> Result<Option<Account>, String> {
    // println!("🚀 Backend Command: get_current_account called"); // Commented out to reduce noise for frequent calls, relies on frontend log for frequency
    // Actually user WANTS to see it.
    modules::logger::log_info("Backend Command: get_current_account called");

    let account_id = modules::get_current_account_id()?;

    if let Some(id) = account_id {
        // modules::logger::log_info(&format!("   Found current account ID: {}", id));
        modules::load_account(&id).map(Some)
    } else {
        modules::logger::log_info("   No current account set");
        Ok(None)
    }
}

/// 导出账号（包含 refresh_token）
use crate::models::AccountExportResponse;

#[tauri::command]
pub async fn export_accounts(account_ids: Vec<String>) -> Result<AccountExportResponse, String> {
    tokio::task::spawn_blocking(move || modules::account::export_accounts_by_ids(&account_ids))
        .await
        .unwrap_or_else(|_| Err("Task panicked".to_string()))
}

/// 内部辅助功能：在添加或导入账号后自动刷新一次额度
async fn internal_refresh_account_quota(
    app: &tauri::AppHandle,
    account: &mut Account,
) -> Result<QuotaData, String> {
    modules::logger::log_info(&format!("自动触发刷新配额: {}", account.email));

    // 使用带重试的查询 (Shared logic)
    match modules::account::fetch_quota_with_retry(account).await {
        Ok(quota) => {
            // 更新账号配额
            let _ = modules::update_account_quota(&account.id, quota.clone());
            // 更新托盘菜单
            crate::modules::tray::update_tray_menus(app);
            Ok(quota)
        }
        Err(e) => {
            modules::logger::log_warn(&format!("自动刷新配额失败 ({}): {}", account.email, e));
            Err(e.to_string())
        }
    }
}

/// 查询账号配额
#[tauri::command]
pub async fn fetch_account_quota(
    app: tauri::AppHandle,
    account_id: String,
) -> crate::error::AppResult<QuotaData> {
    modules::logger::log_info(&format!("手动刷新配额请求: {}", account_id));
    let mut account =
        modules::load_account(&account_id).map_err(crate::error::AppError::Account)?;

    // 使用带重试的查询 (Shared logic)
    let quota = modules::account::fetch_quota_with_retry(&mut account).await?;

    // 4. 更新账号配额
    modules::update_account_quota(&account_id, quota.clone())
        .map_err(crate::error::AppError::Account)?;

    crate::modules::tray::update_tray_menus(&app);

    Ok(quota)
}

pub use modules::account::RefreshStats;

/// 刷新所有账号配额 (内部实现)
pub async fn refresh_all_quotas_internal(
    app_handle: Option<tauri::AppHandle>,
) -> Result<RefreshStats, String> {
    let stats = modules::account::refresh_all_quotas_logic().await?;

    // 发送全局刷新事件给 UI (如果需要)
    if let Some(handle) = app_handle {
        use tauri::Emitter;
        let _ = handle.emit("accounts://refreshed", ());
    }

    Ok(stats)
}

/// 刷新所有账号配额 (Tauri Command)
#[tauri::command]
pub async fn refresh_all_quotas(app_handle: tauri::AppHandle) -> Result<RefreshStats, String> {
    refresh_all_quotas_internal(Some(app_handle)).await
}
/// 加载配置
#[tauri::command]
pub async fn load_config() -> Result<AppConfig, String> {
    modules::load_app_config()
}

/// 保存配置
#[tauri::command]
pub async fn save_config(app: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    // Ordinary saves preserve dedicated desktop/localization preferences under
    // the same configuration lock, including stale snapshots from other windows.
    modules::save_app_config(&config)?;
    let _ = app.emit("config://updated", ());
    Ok(())
}

// --- OAuth 命令 ---

#[tauri::command]
pub async fn start_oauth_login(
    app_handle: tauri::AppHandle,
    oauth_client_key: Option<String>,
) -> Result<Account, String> {
    modules::logger::log_info("开始 OAuth 授权流程...");
    let service = modules::account_service::AccountService::new(
        crate::modules::integration::SystemManager::new(app_handle.clone()),
    );

    let mut account = service.start_oauth_login(oauth_client_key).await?;
    let _ = internal_refresh_account_quota(&app_handle, &mut account).await;
    Ok(account)
}

/// 完成 OAuth 授权（不自动打开浏览器）
#[tauri::command]
pub async fn complete_oauth_login(app_handle: tauri::AppHandle) -> Result<Account, String> {
    modules::logger::log_info("完成 OAuth 授权流程 (manual)...");
    let service = modules::account_service::AccountService::new(
        crate::modules::integration::SystemManager::new(app_handle.clone()),
    );

    let mut account = service.complete_oauth_login().await?;
    let _ = internal_refresh_account_quota(&app_handle, &mut account).await;
    Ok(account)
}

/// 预生成 OAuth 授权链接 (不打开浏览器)
#[tauri::command]
pub async fn prepare_oauth_url(
    app_handle: tauri::AppHandle,
    oauth_client_key: Option<String>,
) -> Result<String, String> {
    let service = modules::account_service::AccountService::new(
        crate::modules::integration::SystemManager::new(app_handle.clone()),
    );
    service.prepare_oauth_url(oauth_client_key).await
}

#[tauri::command]
pub async fn cancel_oauth_login() -> Result<(), String> {
    modules::oauth_server::cancel_oauth_flow();
    Ok(())
}

/// 手动提交 OAuth Code (用于远程环境无法自动回调时)
#[tauri::command]
pub async fn submit_oauth_code(code: String, state: Option<String>) -> Result<(), String> {
    modules::logger::log_info("收到手动提交 OAuth Code 请求");
    modules::oauth_server::submit_oauth_code(code, state).await
}

#[tauri::command]
pub async fn list_oauth_clients(
) -> Result<Vec<crate::modules::oauth::OAuthClientDescriptor>, String> {
    crate::modules::oauth::list_oauth_clients()
}

#[tauri::command]
pub async fn get_active_oauth_client() -> Result<String, String> {
    crate::modules::oauth::get_active_oauth_client_key()
}

#[tauri::command]
pub async fn set_active_oauth_client(client_key: String) -> Result<(), String> {
    crate::modules::oauth::set_active_oauth_client_key(&client_key)
}

// --- 导入命令 ---

#[tauri::command]
pub async fn import_from_db(
    app: tauri::AppHandle,
    target_ide: Option<String>,
) -> Result<Vec<Account>, String> {
    let imported_accounts =
        modules::migration::import_all_local_accounts(target_ide.as_deref()).await?;

    if let Some(first_acc) = imported_accounts.first() {
        let account_id = first_acc.id.clone();
        let _ = modules::account::set_current_account_id_with_target(
            &account_id,
            target_ide.as_deref(),
        );
    }

    for mut account in imported_accounts.clone() {
        let _ = internal_refresh_account_quota(&app, &mut account).await;
    }

    crate::modules::tray::update_tray_menus(&app);

    Ok(imported_accounts)
}

#[tauri::command]
pub async fn import_custom_db(app: tauri::AppHandle, path: String) -> Result<Account, String> {
    // 调用重构后的自定义导入函数
    let mut account = modules::migration::import_from_custom_db_path(path).await?;

    // 自动设为当前账号
    let account_id = account.id.clone();
    modules::account::set_current_account_id(&account_id)?;

    // 自动触发刷新额度
    let _ = internal_refresh_account_quota(&app, &mut account).await;

    // 刷新托盘图标展示
    crate::modules::tray::update_tray_menus(&app);

    Ok(account)
}

#[tauri::command]
pub async fn sync_account_from_db(app: tauri::AppHandle) -> Result<Option<Account>, String> {
    // Check if the current target is one we should not sync (like agy CLI)
    let index = modules::account::load_account_index()?;
    let current_target = index.current_target_ide.as_deref();
    if current_target == Some("agy") {
        modules::logger::log_info("Auto-sync skipped: current target is agy CLI");
        return Ok(None);
    }

    // 1. 获取 DB 中的 Refresh Token
    let db_refresh_token = match modules::migration::get_refresh_token_from_db(current_target) {
        Ok(token) => token,
        Err(e) => {
            modules::logger::log_info(&format!("自动同步跳过: {}", e));
            return Ok(None);
        }
    };

    // 2. 获取 Manager 当前账号
    let curr_account = modules::account::get_current_account()?;

    // 3. 对比：如果 Refresh Token 相同，说明账号没变，无需导入
    if let Some(acc) = curr_account {
        if acc.token.refresh_token == db_refresh_token {
            // 账号未变，由于已经是周期性任务，我们可以选择性刷新一下配额，或者直接返回
            // 这里为了节省 API 流量，直接返回
            return Ok(None);
        }
        modules::logger::log_info(&format!(
            "检测到账号切换 ({} -> DB新账号)，正在同步...",
            acc.email
        ));
    } else {
        modules::logger::log_info("检测到新登录账号，正在自动同步...");
    }

    // 4. 执行完整导入
    let mut account = modules::migration::import_from_db(current_target).await?;

    // 既然是从数据库导入，自动将其设为 Manager 的当前账号并保留当前 target
    let account_id = account.id.clone();
    modules::account::set_current_account_id_with_target(&account_id, current_target)?;

    // 自动触发刷新额度
    let _ = internal_refresh_account_quota(&app, &mut account).await;

    // 刷新托盘图标展示
    crate::modules::tray::update_tray_menus(&app);

    Ok(Some(account))
}

/// 打开数据目录
#[tauri::command]
pub async fn open_data_folder() -> Result<(), String> {
    let path = modules::account::get_data_dir()?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        use crate::utils::command::CommandExtWrapper;
        std::process::Command::new("explorer")
            .creation_flags_windows()
            .arg(path)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }

    Ok(())
}

/// 获取数据目录绝对路径
#[tauri::command]
pub async fn get_data_dir_path() -> Result<String, String> {
    let path = modules::account::get_data_dir()?;
    Ok(path.to_string_lossy().to_string())
}

/// 显示主窗口
#[tauri::command]
pub async fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    modules::desktop::show_main(&app)
}

/// 设置窗口主题（用于同步 Windows 标题栏按钮颜色）
#[tauri::command]
pub async fn set_window_theme(window: tauri::Window, theme: String) -> Result<(), String> {
    use tauri::Theme;

    let tauri_theme = match theme.as_str() {
        "dark" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        _ => None, // system default
    };

    window.set_theme(tauri_theme).map_err(|e| e.to_string())
}

/// 更新账号自定义标签
#[tauri::command]
pub async fn update_account_label(account_id: String, label: String) -> Result<(), String> {
    // 验证标签长度（按字符数计算，支持中文）
    if label.chars().count() > 15 {
        return Err("标签长度不能超过15个字符".to_string());
    }

    modules::logger::log_info(&format!(
        "更新账号标签: {} -> {:?}",
        account_id,
        if label.is_empty() { "无" } else { &label }
    ));

    // 1. 读取账号文件
    let data_dir = modules::account::get_data_dir()?;
    let account_path = data_dir
        .join("accounts")
        .join(format!("{}.json", account_id));

    if !account_path.exists() {
        return Err(format!("账号文件不存在: {}", account_id));
    }

    let content =
        std::fs::read_to_string(&account_path).map_err(|e| format!("读取账号文件失败: {}", e))?;

    let mut account_json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析账号文件失败: {}", e))?;

    // 2. 更新 custom_label 字段
    if label.is_empty() {
        account_json["custom_label"] = serde_json::Value::Null;
    } else {
        account_json["custom_label"] = serde_json::Value::String(label.clone());
    }

    // 3. 保存到磁盘
    let json_str = serde_json::to_string_pretty(&account_json)
        .map_err(|e| format!("序列化账号数据失败: {}", e))?;
    std::fs::write(&account_path, json_str).map_err(|e| format!("写入账号文件失败: {}", e))?;

    modules::logger::log_info(&format!(
        "账号标签已更新: {} ({})",
        account_id,
        if label.is_empty() {
            "已清除".to_string()
        } else {
            label
        }
    ));

    Ok(())
}

/// 读取 Antigravity 原生对话数据库中的本地 Token 用量
#[tauri::command]
pub async fn get_local_token_usage(
) -> Result<crate::modules::native_token_stats::LocalTokenUsageSummary, String> {
    tokio::task::spawn_blocking(crate::modules::native_token_stats::get_local_token_usage)
        .await
        .map_err(|error| format!("读取本地 Token 统计任务失败: {}", error))?
}

/// 同步 Google 官方 API 价格，用于本地费用等价估算
#[tauri::command]
pub async fn get_api_pricing() -> Result<crate::modules::api_pricing::ApiPricingSnapshot, String> {
    crate::modules::api_pricing::get_api_pricing().await
}

/// 检查 GitHub Releases 获取最新版本信息
#[tauri::command]
pub async fn check_for_updates() -> Result<crate::modules::updater::UpdateInfo, String> {
    crate::modules::updater::check_for_updates().await
}

/// 下载最新安装包并启动更新安装 / 重启
#[tauri::command]
pub async fn download_and_install_update(
    app: tauri::AppHandle,
    download_url: String,
    asset_name: String,
) -> Result<String, String> {
    crate::modules::updater::download_and_install_update(app, download_url, asset_name).await
}
