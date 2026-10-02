pub mod account;
pub mod account_dashboard;
pub mod account_service;
pub mod api_pricing;
pub mod app_localization;
pub mod cli_credentials;
pub mod config;
pub mod db;
pub mod device;
pub mod i18n;
pub mod integration;
#[cfg(target_os = "linux")]
pub mod linux_credentials;
#[cfg(target_os = "linux")]
pub mod linux_paths;
pub(crate) mod localization_macos;
pub(crate) mod localization_transport;
pub mod logger;
pub mod migration;
pub mod native_token_stats;
pub mod oauth;
pub mod oauth_server;
pub mod process;
pub mod project_resolver;
pub mod quota;
pub mod tray;
pub mod version;

// Re-export commonly used functions to the top level of the modules namespace for easy external calling
pub use account::*;
pub use config::*;
pub use quota::*;
// pub use device::*;

pub mod desktop;
pub mod auto_switch;
