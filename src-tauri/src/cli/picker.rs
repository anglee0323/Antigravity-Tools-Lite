use super::output::{AccountView, QuotaView, Snapshot};
use super::{CliError, HeadlessIntegration};
use std::io::{self, Read, Write};
use std::path::Path;

pub(crate) fn quota_brief(quota: Option<&QuotaView>) -> String {
    if let Some(q) = quota {
        if q.is_forbidden {
            return " (额度受限)".into();
        }
        let mut parts = Vec::new();
        if let Some(groups) = &q.quota_groups {
            for g in groups {
                if let Some(b) = g.buckets.first() {
                    let pct = (b.remaining_fraction * 100.0).round() as i32;
                    let short_name = if g.display_name.contains("Gemini") {
                        "Gemini"
                    } else if g.display_name.contains("Claude") || g.display_name.contains("GPT") {
                        "Claude/GPT"
                    } else {
                        &g.display_name
                    };
                    parts.push(format!("{}: {}%", short_name, pct));
                }
            }
        } else {
            for m in q.models.iter().take(2) {
                parts.push(format!("{}: {}%", m.name, m.percentage));
            }
        }
        if !parts.is_empty() {
            return format!(" ({})", parts.join(" | "));
        }
    }
    String::new()
}

pub(crate) fn format_countdown(reset_time_str: &str) -> String {
    if reset_time_str.is_empty() {
        return String::new();
    }
    if let Ok(reset_dt) = chrono::DateTime::parse_from_rfc3339(reset_time_str) {
        let now = chrono::Utc::now();
        let diff = reset_dt.signed_duration_since(now.with_timezone(&reset_dt.timezone()));
        if diff.num_seconds() <= 0 {
            "已重置".to_string()
        } else {
            let hours = diff.num_hours();
            let mins = diff.num_minutes() % 60;
            if hours > 0 {
                format!("{}小时{}分后重置", hours, mins)
            } else {
                format!("{}分后重置", mins.max(1))
            }
        }
    } else {
        reset_time_str.to_string()
    }
}

pub(crate) fn format_number(n: u64) -> String {
    let s = n.to_string();
    let bytes = s.as_bytes();
    let mut result = String::new();
    let len = bytes.len();
    for (i, &b) in bytes.iter().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            result.push(',');
        }
        result.push(b as char);
    }
    result
}

pub(crate) fn progress_bar(percentage: i32, width: usize) -> String {
    let pct = percentage.clamp(0, 100) as usize;
    let filled = (pct * width) / 100;
    let empty = width.saturating_sub(filled);
    let bar: String = "█".repeat(filled) + &"░".repeat(empty);
    let color = if pct > 50 {
        "\x1b[1;32m" // green
    } else if pct > 20 {
        "\x1b[1;33m" // yellow
    } else {
        "\x1b[1;31m" // red
    };
    format!("{}{}\x1b[0m", color, bar)
}

fn open_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn();
}

#[cfg(unix)]
struct RawTerminal {
    orig: libc::termios,
}

#[cfg(unix)]
impl RawTerminal {
    fn enter() -> Option<Self> {
        unsafe {
            if libc::isatty(libc::STDIN_FILENO) != 1 || libc::isatty(libc::STDOUT_FILENO) != 1 {
                return None;
            }
            let mut orig = std::mem::zeroed();
            if libc::tcgetattr(libc::STDIN_FILENO, &mut orig) != 0 {
                return None;
            }
            let mut raw = orig;
            libc::cfmakeraw(&mut raw);
            raw.c_cc[libc::VMIN] = 0;
            raw.c_cc[libc::VTIME] = 1; // 100ms
            if libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, &raw) != 0 {
                return None;
            }
            Some(Self { orig })
        }
    }
}

#[cfg(unix)]
impl Drop for RawTerminal {
    fn drop(&mut self) {
        unsafe {
            libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, &self.orig);
            print!("\x1b[?25h"); // Show cursor
            let _ = io::stdout().flush();
        }
    }
}

enum KeyAction {
    Up,
    Down,
    Enter,
    Cancel,
    SelectIndex(usize),
    Char(char),
    None,
}

#[cfg(unix)]
fn read_key_action() -> KeyAction {
    let mut byte = [0u8; 1];
    let mut stdin = io::stdin();

    loop {
        match stdin.read(&mut byte) {
            Ok(1) => break,
            Ok(0) => continue,
            _ => return KeyAction::Cancel,
        }
    }

    match byte[0] {
        b'\r' | b'\n' => KeyAction::Enter,
        b'\x03' | b'q' | b'Q' => KeyAction::Cancel,
        b'k' | b'K' => KeyAction::Up,
        b'j' | b'J' => KeyAction::Down,
        b'0' => KeyAction::Char('0'),
        b'1'..=b'9' => KeyAction::SelectIndex((byte[0] - b'1') as usize),
        b'\x1b' => {
            let mut seq = [0u8; 2];
            match stdin.read(&mut seq[0..1]) {
                Ok(1) if seq[0] == b'[' => match stdin.read(&mut seq[1..2]) {
                    Ok(1) => match seq[1] {
                        b'A' => KeyAction::Up,
                        b'B' => KeyAction::Down,
                        _ => KeyAction::None,
                    },
                    _ => KeyAction::Cancel,
                },
                _ => KeyAction::Cancel,
            }
        }
        b => KeyAction::Char(b as char),
    }
}

fn prompt_line(prompt: &str) -> String {
    print!("{}", prompt);
    let _ = io::stdout().flush();
    let mut line = String::new();
    let _ = io::stdin().read_line(&mut line);
    line.trim().to_string()
}

fn wait_for_key() {
    print!("\n\x1b[2m按任意键继续...\x1b[0m");
    let _ = io::stdout().flush();
    #[cfg(unix)]
    {
        if let Some(_raw) = RawTerminal::enter() {
            let _ = read_key_action();
            print!("\x1b[2K\r");
            let _ = io::stdout().flush();
            return;
        }
    }
    let mut input = String::new();
    let _ = io::stdin().read_line(&mut input);
}

pub fn select_menu_interactive(title: &str, items: &[&str], initial: usize) -> Option<usize> {
    if items.is_empty() {
        return None;
    }

    #[cfg(unix)]
    {
        if let Some(_raw) = RawTerminal::enter() {
            let mut selected = initial.min(items.len() - 1);
            let mut stdout = io::stdout();

            print!("\x1b[?25l");
            let _ = stdout.flush();

            let render = |sel: usize, first: bool| {
                let mut out = io::stdout();
                if !first {
                    print!("\x1b[{}A", items.len() + 1);
                }
                println!(
                    "\x1b[2K\r\x1b[1;36m{}\x1b[0m \x1b[2m(↑/↓ 移动，回车确认，数字键选择，q/Esc 取消):\x1b[0m",
                    title
                );
                for (i, item) in items.iter().enumerate() {
                    if i == sel {
                        println!("\x1b[2K\r \x1b[1;32m❯\x1b[0m \x1b[1;37m{}\x1b[0m", item);
                    } else {
                        println!("\x1b[2K\r   \x1b[2m{}\x1b[0m", item);
                    }
                }
                let _ = out.flush();
            };

            render(selected, true);

            loop {
                match read_key_action() {
                    KeyAction::Up => {
                        selected = if selected > 0 {
                            selected - 1
                        } else {
                            items.len() - 1
                        };
                        render(selected, false);
                    }
                    KeyAction::Down => {
                        selected = if selected + 1 < items.len() {
                            selected + 1
                        } else {
                            0
                        };
                        render(selected, false);
                    }
                    KeyAction::SelectIndex(idx) => {
                        // Check if any item contains [1..9]
                        let digit = (idx + 1).to_string();
                        let bracket = format!("[{}]", digit);
                        for (i, item) in items.iter().enumerate() {
                            if item.contains(&bracket) {
                                print!("\x1b[?25h");
                                let _ = stdout.flush();
                                return Some(i);
                            }
                        }
                        if idx < items.len() {
                            print!("\x1b[?25h");
                            let _ = stdout.flush();
                            return Some(idx);
                        }
                    }
                    KeyAction::Char('0') => {
                        // Check if any item has [0]
                        for (i, item) in items.iter().enumerate() {
                            if item.contains("[0]") {
                                print!("\x1b[?25h");
                                let _ = stdout.flush();
                                return Some(i);
                            }
                        }
                        print!("\x1b[?25h");
                        let _ = stdout.flush();
                        return None;
                    }
                    KeyAction::Char(ch) => {
                        let upper = ch.to_ascii_uppercase();
                        let bracket = format!("[{}]", upper);
                        for (i, item) in items.iter().enumerate() {
                            if item.contains(&bracket) {
                                print!("\x1b[?25h");
                                let _ = stdout.flush();
                                return Some(i);
                            }
                        }
                    }
                    KeyAction::Enter => {
                        print!("\x1b[?25h");
                        let _ = stdout.flush();
                        return Some(selected);
                    }
                    KeyAction::Cancel => {
                        print!("\x1b[?25h");
                        let _ = stdout.flush();
                        return None;
                    }
                    KeyAction::None => {}
                }
            }
        }
    }

    println!("{}", title);
    for item in items.iter() {
        println!("  {}", item);
    }
    print!("请输入选项序号 [1-{}]: ", items.len());
    let _ = io::stdout().flush();
    let mut input = String::new();
    if io::stdin().read_line(&mut input).is_ok() {
        let trimmed = input.trim();
        if let Ok(num) = trimmed.parse::<usize>() {
            if num >= 1 && num <= items.len() {
                return Some(num - 1);
            }
        }
    }
    None
}

pub fn select_account_interactive<'a>(accounts: &'a [AccountView]) -> Option<&'a AccountView> {
    if accounts.is_empty() {
        return None;
    }

    #[cfg(unix)]
    {
        if let Some(_raw) = RawTerminal::enter() {
            let mut selected = accounts.iter().position(|a| a.is_current).unwrap_or(0);
            let mut stdout = io::stdout();

            print!("\x1b[?25l");
            let _ = stdout.flush();

            let render = |sel: usize, initial: bool| {
                let mut out = io::stdout();
                if !initial {
                    print!("\x1b[{}A", accounts.len() + 1);
                }
                println!(
                    "\x1b[2K\r\x1b[1;36m? 请选择账号\x1b[0m \x1b[2m(↑/↓ 移动，回车确认，数字选择，q/Esc 取消):\x1b[0m"
                );

                for (i, acc) in accounts.iter().enumerate() {
                    let is_sel = i == sel;
                    let quota_text = quota_brief(acc.quota.as_ref());
                    let mut flags = Vec::new();
                    if acc.is_current {
                        flags.push("当前生效");
                    }
                    if acc.disabled {
                        flags.push("已禁用");
                    }
                    let label_str = match &acc.custom_label {
                        Some(l) if !l.trim().is_empty() => format!(" ({})", l),
                        _ => String::new(),
                    };
                    let flag_str = if flags.is_empty() {
                        String::new()
                    } else {
                        format!(" [{}]", flags.join(", "))
                    };

                    let display = format!("{}{}", acc.email, label_str);
                    if is_sel {
                        println!(
                            "\x1b[2K\r \x1b[1;32m❯\x1b[0m \x1b[1;37m{:<32}\x1b[0m\x1b[36m{}\x1b[0m\x1b[33m{}\x1b[0m",
                            display, quota_text, flag_str
                        );
                    } else {
                        println!(
                            "\x1b[2K\r   \x1b[2m{:<32}{}{}\x1b[0m",
                            display, quota_text, flag_str
                        );
                    }
                }
                let _ = out.flush();
            };

            render(selected, true);

            loop {
                match read_key_action() {
                    KeyAction::Up => {
                        selected = if selected > 0 {
                            selected - 1
                        } else {
                            accounts.len() - 1
                        };
                        render(selected, false);
                    }
                    KeyAction::Down => {
                        selected = if selected + 1 < accounts.len() {
                            selected + 1
                        } else {
                            0
                        };
                        render(selected, false);
                    }
                    KeyAction::SelectIndex(idx) => {
                        if idx < accounts.len() {
                            selected = idx;
                            render(selected, false);
                        }
                    }
                    KeyAction::Enter => {
                        print!("\x1b[{}A", accounts.len() + 1);
                        for _ in 0..=accounts.len() {
                            println!("\x1b[2K\r");
                        }
                        print!("\x1b[{}A", accounts.len() + 1);
                        print!("\x1b[?25h");
                        let _ = stdout.flush();
                        return Some(&accounts[selected]);
                    }
                    KeyAction::Cancel => {
                        print!("\x1b[{}A", accounts.len() + 1);
                        for _ in 0..=accounts.len() {
                            println!("\x1b[2K\r");
                        }
                        print!("\x1b[{}A", accounts.len() + 1);
                        print!("\x1b[?25h");
                        let _ = stdout.flush();
                        return None;
                    }
                    _ => {}
                }
            }
        }
    }

    println!("请选择账号 (输入序号 1-{}):", accounts.len());
    for (i, acc) in accounts.iter().enumerate() {
        let quota_text = quota_brief(acc.quota.as_ref());
        let current_marker = if acc.is_current { " [当前生效]" } else { "" };
        println!("  {}. {}{}{}", i + 1, acc.email, quota_text, current_marker);
    }
    print!("请输入序号 [1-{}]: ", accounts.len());
    let _ = io::stdout().flush();
    let mut input = String::new();
    if io::stdin().read_line(&mut input).is_ok() {
        if let Ok(num) = input.trim().parse::<usize>() {
            if num >= 1 && num <= accounts.len() {
                return Some(&accounts[num - 1]);
            }
        }
    }
    None
}

pub fn format_token_stats_human(
    summary: &crate::modules::native_token_stats::LocalTokenUsageSummary,
) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "{:<16} {:>14} {:>14} {:>14} {:>12} {:>10}\n",
        "时间区间", "总计 Token", "输入 Token", "输出 Token", "缓存命中率", "请求次数"
    ));
    out.push_str(&"-".repeat(84));
    out.push('\n');

    let periods = [
        ("今日 (Today)", &summary.today),
        ("昨日 (Yesterday)", &summary.yesterday),
        ("近 3 天", &summary.last_3_days),
        ("近 7 天", &summary.last_7_days),
        ("近 30 天", &summary.last_30_days),
    ];

    for (name, row) in periods {
        let total_in = row.input_tokens + row.cached_tokens;
        let hit_rate = if total_in > 0 {
            format!("{:.1}%", (row.cached_tokens as f64 / total_in as f64) * 100.0)
        } else {
            "0.0%".into()
        };
        out.push_str(&format!(
            "{:<16} {:>14} {:>14} {:>14} {:>12} {:>10}\n",
            name,
            format_number(row.total_tokens),
            format_number(row.input_tokens),
            format_number(row.output_tokens),
            hit_rate,
            format_number(row.request_count),
        ));
    }

    if !summary.by_model_today.is_empty() {
        out.push_str("\n\x1b[1;37m【今日各模型用量明细】\x1b[0m\n");
        for m in &summary.by_model_today {
            out.push_str(&format!(
                "  • {:<24} 总计: {:>10}  (输入: {}, 输出: {}, 缓存: {}, {} 次请求)\n",
                m.model,
                format_number(m.total_tokens),
                format_number(m.input_tokens),
                format_number(m.output_tokens),
                format_number(m.cached_tokens),
                m.request_count,
            ));
        }
    }

    if !summary.by_model.is_empty() {
        out.push_str("\n\x1b[1;37m【近 30 天主要模型用量】\x1b[0m\n");
        for m in summary.by_model.iter().take(5) {
            out.push_str(&format!(
                "  • {:<24} 总计: {:>12}  (共 {} 次请求)\n",
                m.model,
                format_number(m.total_tokens),
                format_number(m.request_count),
            ));
        }
    }

    out.push_str(&format!(
        "\n\x1b[2m数据来源: 扫描 {} 个本地 SQLite 数据库 | 累计对话记录: {} 条\x1b[0m",
        summary.databases_scanned, summary.generations_scanned
    ));

    out
}

pub fn run_interactive_dashboard(root: &Path) -> Result<(), CliError> {
    loop {
        let snapshot = Snapshot::read(root).unwrap_or(Snapshot {
            accounts: vec![],
            current_target: None,
        });

        // Clear screen and show header
        print!("\x1b[2J\x1b[H");
        println!("\x1b[1;36m┌────────────────────────────────────────────────────────────────────────┐\x1b[0m");
        println!(
            "\x1b[1;36m│\x1b[0m  \x1b[1;37m🚀 Antigravity Tools Lite · agy-switch v{}\x1b[0m",
            env!("CARGO_PKG_VERSION")
        );
        if let Ok(curr) = snapshot.current() {
            let target = snapshot.current_target.as_deref().unwrap_or("app");
            let label = match &curr.custom_label {
                Some(l) if !l.trim().is_empty() => format!(" ({})", l),
                _ => String::new(),
            };
            println!(
                "\x1b[1;36m│\x1b[0m  当前生效: \x1b[1;32m{}{}\x1b[0m \x1b[2m(目标: {})\x1b[0m",
                curr.email, label, target
            );
            let qb = quota_brief(curr.quota.as_ref());
            if !qb.is_empty() {
                println!(
                    "\x1b[1;36m│\x1b[0m  额度概况: \x1b[36m{}\x1b[0m",
                    qb.trim_start_matches(" (").trim_end_matches(')')
                );
            }
        } else {
            println!("\x1b[1;36m│\x1b[0m  当前生效: \x1b[33m未设置 / 暂无账号\x1b[0m");
        }
        println!("\x1b[1;36m└────────────────────────────────────────────────────────────────────────┘\x1b[0m\n");

        let menu_items = [
            "[1] 🔄 切换当前生效账号 (Switch Account)",
            "[2] 📊 查看账号额度详情 (Quota Details)",
            "[3] 📈 本地 Token 用量统计 (Token Statistics)",
            "[4] ⚡ 刷新账号配额 (Refresh Live Quotas)",
            "[5] ➕ 添加 Google 账号 (Add New Account / OAuth)",
            "[6] ⚙️  账号管理与备注 (Manage Accounts & Labels)",
            "[7] 🖥️  关联应用与系统状态 (Linked Apps & Storage)",
            "[0] 🚪 退出控制台 (Exit)",
        ];

        let choice = select_menu_interactive("请选择操作功能:", &menu_items, 0);

        match choice {
            Some(0) => show_account_switcher(root, &snapshot),
            Some(1) => show_quota_details(&snapshot),
            Some(2) => show_token_statistics(),
            Some(3) => show_refresh_quotas(&snapshot),
            Some(4) => show_add_account(),
            Some(5) => show_manage_accounts(&snapshot),
            Some(6) => show_system_status(&snapshot, root),
            Some(7) | None => {
                println!("\n\x1b[2m已退出 agy-switch 控制台。\x1b[0m\n");
                break;
            }
            _ => {}
        }
    }
    Ok(())
}

fn show_account_switcher(_root: &Path, snapshot: &Snapshot) {
    if snapshot.accounts.is_empty() {
        println!("\n\x1b[33m⚠️ 暂无已保存账号，请先使用 [5] 添加 Google 账号。\x1b[0m");
        wait_for_key();
        return;
    }

    let selected = match select_account_interactive(&snapshot.accounts) {
        Some(acc) => acc,
        None => return,
    };

    let target_choice = select_menu_interactive(
        "请选择生效目标:",
        &[
            "[1] AntiGravity APP 与 CLI (默认同步两端)",
            "[2] AntiGravity IDE (专属关联通道)",
            "[0] ↩️  取消并返回",
        ],
        0,
    );

    let target_ide = match target_choice {
        Some(0) => None,
        Some(1) => Some("ide"),
        _ => return,
    };

    println!("\n\x1b[2m正在执行账号切换并同步会话...\x1b[0m");
    let runtime = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            println!("\x1b[1;31m✗ 启动异步运行时失败: {}\x1b[0m", e);
            wait_for_key();
            return;
        }
    };

    match runtime.block_on(crate::modules::account::switch_account(
        &selected.id,
        target_ide,
        &HeadlessIntegration,
    )) {
        Ok(_) => {
            println!(
                "\x1b[1;32m✓ 已成功切换生效账号至: {}\x1b[0m (目标: {})",
                selected.email,
                target_ide.unwrap_or("app")
            );
            println!("\x1b[2m提示: 请在终端开启新的 agy 命令以使用最新会话。\x1b[0m");
        }
        Err(err) => {
            println!("\x1b[1;31m✗ 账号切换失败: {}\x1b[0m", err);
        }
    }
    wait_for_key();
}

fn show_quota_details(snapshot: &Snapshot) {
    if snapshot.accounts.is_empty() {
        println!("\n\x1b[33m⚠️ 暂无已保存账号。\x1b[0m");
        wait_for_key();
        return;
    }

    let account_to_view = if snapshot.accounts.len() == 1 {
        Some(&snapshot.accounts[0])
    } else {
        let mut items = Vec::new();
        for (i, acc) in snapshot.accounts.iter().enumerate() {
            let label = match &acc.custom_label {
                Some(l) if !l.trim().is_empty() => format!(" ({})", l),
                _ => String::new(),
            };
            let current = if acc.is_current { " [当前生效]" } else { "" };
            items.push(format!("[{}] {}{}{}", i + 1, acc.email, label, current));
        }
        items.push("[A] 📊 全部账号额度总览对比".into());
        items.push("[0] ↩️  返回主菜单".into());

        let str_items: Vec<&str> = items.iter().map(String::as_str).collect();
        let sel = select_menu_interactive("请选择要查看额度的账号:", &str_items, 0);

        match sel {
            Some(idx) if idx < snapshot.accounts.len() => Some(&snapshot.accounts[idx]),
            Some(idx) if idx == snapshot.accounts.len() => {
                // Table of all accounts
                print!("\x1b[2J\x1b[H");
                println!("\x1b[1;36m================================================================================\x1b[0m");
                println!("\x1b[1;37m  📊 全部账号额度总览对比表格\x1b[0m");
                println!("\x1b[1;36m================================================================================\x1b[0m\n");
                println!(
                    "{:<32} {:<20} {:<20} {:<10}",
                    "账号 (Email / 备注)", "Gemini 配额", "Claude/GPT 配额", "状态"
                );
                println!("{}", "-".repeat(84));
                for acc in &snapshot.accounts {
                    let label = match &acc.custom_label {
                        Some(l) if !l.trim().is_empty() => format!(" ({})", l),
                        _ => String::new(),
                    };
                    let cur = if acc.is_current { " *" } else { "" };
                    let display_name = format!("{}{}{}", acc.email, label, cur);

                    let mut gemini_quota = "暂无数据".to_string();
                    let mut claude_quota = "暂无数据".to_string();

                    if let Some(q) = &acc.quota {
                        if q.is_forbidden {
                            gemini_quota = "额度受限".into();
                            claude_quota = "额度受限".into();
                        } else if let Some(groups) = &q.quota_groups {
                            for g in groups {
                                if let Some(b) = g.buckets.first() {
                                    let pct = (b.remaining_fraction * 100.0).round() as i32;
                                    let cd = format_countdown(&b.reset_time);
                                    let text = if cd.is_empty() {
                                        format!("{}%", pct)
                                    } else {
                                        format!("{}% ({})", pct, cd)
                                    };
                                    if g.display_name.contains("Gemini") {
                                        gemini_quota = text;
                                    } else if g.display_name.contains("Claude")
                                        || g.display_name.contains("GPT")
                                    {
                                        claude_quota = text;
                                    }
                                }
                            }
                        } else {
                            for m in &q.models {
                                if m.name.contains("gemini") {
                                    gemini_quota = format!("{}%", m.percentage);
                                } else if m.name.contains("claude") {
                                    claude_quota = format!("{}%", m.percentage);
                                }
                            }
                        }
                    }

                    let status = if acc.disabled {
                        "已禁用"
                    } else if acc.validation_blocked {
                        "需验证"
                    } else {
                        "正常"
                    };

                    println!(
                        "{:<32} {:<20} {:<20} {:<10}",
                        display_name, gemini_quota, claude_quota, status
                    );
                }
                println!("\n\x1b[2m* 标注账号为当前生效账号\x1b[0m");
                wait_for_key();
                return;
            }
            _ => return,
        }
    };

    if let Some(acc) = account_to_view {
        print!("\x1b[2J\x1b[H");
        println!("\x1b[1;36m================================================================================\x1b[0m");
        println!(
            "\x1b[1;37m  📊 账号额度详情 · {}\x1b[0m",
            acc.email
        );
        println!("\x1b[1;36m================================================================================\x1b[0m\n");

        println!("邮箱地址: \x1b[1;37m{}\x1b[0m", acc.email);
        println!("账号 ID:   \x1b[2m{}\x1b[0m", acc.id);
        if let Some(label) = &acc.custom_label {
            println!("备注标签: \x1b[36m{}\x1b[0m", label);
        }
        let status = if acc.disabled {
            "\x1b[1;31m已禁用\x1b[0m"
        } else if acc.validation_blocked {
            "\x1b[1;33m需安全验证\x1b[0m"
        } else if acc.is_current {
            "\x1b[1;32m🟢 当前生效 · 正常\x1b[0m"
        } else {
            "\x1b[32m正常\x1b[0m"
        };
        println!("账号状态: {}", status);

        if let Some(q) = &acc.quota {
            if let Some(tier) = &q.subscription_tier {
                println!("订阅级别: \x1b[35m{}\x1b[0m", tier);
            }
            if q.is_forbidden {
                println!("\n\x1b[1;31m⚠️ 账号配额访问受限 (Forbidden)，可能已被安全风控或需重新授权登录。\x1b[0m");
            }

            println!("\n\x1b[1;37m【模型配额详情】\x1b[0m");

            if let Some(groups) = &q.quota_groups {
                for g in groups {
                    println!("\n  \x1b[1;33m• {}\x1b[0m", g.display_name);
                    for b in &g.buckets {
                        let pct = (b.remaining_fraction * 100.0).round() as i32;
                        let bar = progress_bar(pct, 20);
                        let cd = format_countdown(&b.reset_time);
                        let cd_str = if cd.is_empty() {
                            String::new()
                        } else {
                            format!(" ({})", cd)
                        };
                        println!(
                            "    {:<16} {} {:>3}% 剩余{}",
                            b.bucket_id, bar, pct, cd_str
                        );
                    }
                }
            } else if !q.models.is_empty() {
                for m in &q.models {
                    let bar = progress_bar(m.percentage, 20);
                    let cd = format_countdown(&m.reset_time);
                    let cd_str = if cd.is_empty() {
                        String::new()
                    } else {
                        format!(" ({})", cd)
                    };
                    println!(
                        "  • {:<20} {} {:>3}% 剩余{}",
                        m.name, bar, m.percentage, cd_str
                    );
                }
            } else {
                println!("  \x1b[2m暂无模型额度记录\x1b[0m");
            }
        } else {
            println!("\n\x1b[33m⚠️ 该账号暂无本地缓存的额度信息，请在主菜单使用 [4] 刷新配额。\x1b[0m");
        }

        println!("\n\x1b[1;36m================================================================================\x1b[0m");
        wait_for_key();
    }
}

fn show_token_statistics() {
    print!("\x1b[2J\x1b[H");
    println!("\x1b[1;36m================================================================================\x1b[0m");
    println!("\x1b[1;37m  📈 Antigravity 本地 Token 统计概览 (Token Statistics)\x1b[0m");
    println!("\x1b[1;36m================================================================================\x1b[0m\n");
    println!("\x1b[2m正在扫描本地 Antigravity 对话数据库...\x1b[0m\n");

    match crate::modules::native_token_stats::get_local_token_usage() {
        Ok(summary) => {
            println!("{}", format_token_stats_human(&summary));
        }
        Err(e) => {
            println!("\x1b[1;31m⚠️ 读取本地 Token 统计失败: {}\x1b[0m", e);
        }
    }
    wait_for_key();
}

fn show_refresh_quotas(snapshot: &Snapshot) {
    if snapshot.accounts.is_empty() {
        println!("\n\x1b[33m⚠️ 暂无已保存账号。\x1b[0m");
        wait_for_key();
        return;
    }

    let choice = select_menu_interactive(
        "刷新配额选项:",
        &[
            "[1] 刷新当前生效账号配额",
            "[2] 刷新全部账号配额 (多账号并发)",
            "[3] 选择指定账号刷新",
            "[0] ↩️  返回主菜单",
        ],
        0,
    );

    let runtime = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            println!("\x1b[1;31m✗ 启动异步运行时失败: {}\x1b[0m", e);
            wait_for_key();
            return;
        }
    };

    match choice {
        Some(0) => {
            let curr = match snapshot.current() {
                Ok(c) => c,
                Err(_) => {
                    println!("\x1b[33m⚠️ 当前尚未设置生效账号，请使用 [3] 指定账号刷新。\x1b[0m");
                    wait_for_key();
                    return;
                }
            };
            println!("\n\x1b[2m正在请求 Google API 刷新当前账号 ({}) 配额...\x1b[0m", curr.email);
            match runtime.block_on(async {
                let mut account = crate::modules::account::load_account(&curr.id)?;
                let quota = crate::modules::account::fetch_quota_with_retry(&mut account)
                    .await
                    .map_err(|e| e.to_string())?;
                crate::modules::account::update_account_quota(&curr.id, quota.clone())?;
                Ok::<crate::models::QuotaData, String>(quota)
            }) {
                Ok(quota) => {
                    println!("\x1b[1;32m✓ 配额刷新成功！\x1b[0m");
                    if let Some(groups) = &quota.quota_groups {
                        for g in groups {
                            if let Some(b) = g.buckets.first() {
                                let pct = (b.remaining_fraction * 100.0).round() as i32;
                                println!(
                                    "  • {}: {}% (重置: {})",
                                    g.display_name,
                                    pct,
                                    format_countdown(&b.reset_time)
                                );
                            }
                        }
                    } else {
                        for m in &quota.models {
                            println!(
                                "  • {}: {}% (重置: {})",
                                m.name,
                                m.percentage,
                                format_countdown(&m.reset_time)
                            );
                        }
                    }
                }
                Err(e) => println!("\x1b[1;31m✗ 刷新失败: {}\x1b[0m", e),
            }
            wait_for_key();
        }
        Some(1) => {
            println!("\n\x1b[2m正在多账号并发刷新配额 (最多5路并发)...\x1b[0m");
            match runtime.block_on(crate::modules::account::refresh_all_quotas_logic()) {
                Ok(stats) => {
                    println!(
                        "\x1b[1;32m✓ 批量刷新完成！共 {} 个账号 (成功: {}, 失败: {})\x1b[0m",
                        stats.total, stats.success, stats.failed
                    );
                    for detail in stats.details {
                        println!("  {}", detail);
                    }
                }
                Err(e) => println!("\x1b[1;31m✗ 批量刷新失败: {}\x1b[0m", e),
            }
            wait_for_key();
        }
        Some(2) => {
            let selected = match select_account_interactive(&snapshot.accounts) {
                Some(acc) => acc,
                None => return,
            };
            println!("\n\x1b[2m正在请求 Google API 刷新账号 ({}) 配额...\x1b[0m", selected.email);
            match runtime.block_on(async {
                let mut account = crate::modules::account::load_account(&selected.id)?;
                let quota = crate::modules::account::fetch_quota_with_retry(&mut account)
                    .await
                    .map_err(|e| e.to_string())?;
                crate::modules::account::update_account_quota(&selected.id, quota.clone())?;
                Ok::<crate::models::QuotaData, String>(quota)
            }) {
                Ok(quota) => {
                    println!("\x1b[1;32m✓ 配额刷新成功！\x1b[0m");
                    if let Some(groups) = &quota.quota_groups {
                        for g in groups {
                            if let Some(b) = g.buckets.first() {
                                let pct = (b.remaining_fraction * 100.0).round() as i32;
                                println!(
                                    "  • {}: {}% (重置: {})",
                                    g.display_name,
                                    pct,
                                    format_countdown(&b.reset_time)
                                );
                            }
                        }
                    } else {
                        for m in &quota.models {
                            println!(
                                "  • {}: {}% (重置: {})",
                                m.name,
                                m.percentage,
                                format_countdown(&m.reset_time)
                            );
                        }
                    }
                }
                Err(e) => println!("\x1b[1;31m✗ 刷新失败: {}\x1b[0m", e),
            }
            wait_for_key();
        }
        _ => {}
    }
}

fn show_add_account() {
    let choice = select_menu_interactive(
        "添加 Google 账号:",
        &[
            "[1] 🌐 浏览器一键授权 (Google OAuth 自动登录)",
            "[2] 🔑 手动输入 Refresh Token",
            "[0] ↩️  返回主菜单",
        ],
        0,
    );

    let runtime = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            println!("\x1b[1;31m✗ 启动异步运行时失败: {}\x1b[0m", e);
            wait_for_key();
            return;
        }
    };

    match choice {
        Some(0) => {
            println!("\n\x1b[2m正在准备 Google OAuth 登录服务...\x1b[0m");
            let auth_url = match runtime.block_on(crate::modules::oauth_server::prepare_oauth_url(None, None)) {
                Ok(url) => url,
                Err(e) => {
                    println!("\x1b[1;31m✗ 准备授权服务失败: {}\x1b[0m", e);
                    wait_for_key();
                    return;
                }
            };

            open_browser(&auth_url);
            println!("\x1b[1;32m✓ 已启动本地回调服务并尝试打开系统浏览器。\x1b[0m");
            println!("若系统未自动弹出浏览器，请手动复制并在浏览器中访问以下授权链接:");
            println!("\x1b[4;34m{}\x1b[0m\n", auth_url);
            println!("\x1b[2m等待浏览器授权完成... (可按 Ctrl+C 取消)\x1b[0m");

            let token_res = match runtime.block_on(crate::modules::oauth_server::complete_oauth_flow(None)) {
                Ok(t) => t,
                Err(e) => {
                    println!("\x1b[1;31m✗ 授权流程失败: {}\x1b[0m", e);
                    wait_for_key();
                    return;
                }
            };

            let refresh_token = match token_res.refresh_token {
                Some(rt) => rt,
                None => {
                    println!("\x1b[1;31m✗ 未能获取到 Refresh Token，请撤销旧授权后重试。\x1b[0m");
                    wait_for_key();
                    return;
                }
            };

            match runtime.block_on(async {
                let user_info = crate::modules::oauth::get_user_info(&token_res.access_token).await?;
                let project_id = crate::modules::project_resolver::fetch_project_id(&token_res.access_token)
                    .await
                    .ok();
                let token_data = crate::models::TokenData::new(
                    token_res.access_token.clone(),
                    refresh_token,
                    token_res.expires_in,
                    Some(user_info.email.clone()),
                    project_id,
                    None,
                    false,
                    token_res.id_token.clone(),
                )
                .with_oauth_client_key(token_res.oauth_client_key.clone());

                let mut account = crate::modules::upsert_account(
                    user_info.email.clone(),
                    user_info.get_display_name(),
                    token_data,
                )?;

                let _ = crate::modules::account::fetch_quota_with_retry(&mut account).await;
                Ok::<String, String>(account.email)
            }) {
                Ok(email) => {
                    println!("\x1b[1;32m🎉 账号添加成功: {}\x1b[0m", email);
                }
                Err(e) => {
                    println!("\x1b[1;31m✗ 添加账号失败: {}\x1b[0m", e);
                }
            }
            wait_for_key();
        }
        Some(1) => {
            let refresh_token = prompt_line("\n请输入 Google Refresh Token: ");
            if refresh_token.is_empty() {
                println!("\x1b[2m已取消输入。\x1b[0m");
                wait_for_key();
                return;
            }

            println!("\x1b[2m正在验证 Token 并拉取账号详情...\x1b[0m");
            match runtime.block_on(async {
                let token_res = crate::modules::oauth::refresh_access_token(&refresh_token, None).await?;
                let user_info = crate::modules::oauth::get_user_info(&token_res.access_token).await?;
                let project_id = crate::modules::project_resolver::fetch_project_id(&token_res.access_token)
                    .await
                    .ok();
                let token_data = crate::models::TokenData::new(
                    token_res.access_token.clone(),
                    refresh_token,
                    token_res.expires_in,
                    Some(user_info.email.clone()),
                    project_id,
                    None,
                    false,
                    token_res.id_token.clone(),
                )
                .with_oauth_client_key(token_res.oauth_client_key.clone());

                let mut account = crate::modules::upsert_account(
                    user_info.email.clone(),
                    user_info.get_display_name(),
                    token_data,
                )?;

                let _ = crate::modules::account::fetch_quota_with_retry(&mut account).await;
                Ok::<String, String>(account.email)
            }) {
                Ok(email) => {
                    println!("\x1b[1;32m🎉 账号导入成功: {}\x1b[0m", email);
                }
                Err(e) => {
                    println!("\x1b[1;31m✗ 导入失败: {}\x1b[0m", e);
                }
            }
            wait_for_key();
        }
        _ => {}
    }
}

fn show_manage_accounts(snapshot: &Snapshot) {
    if snapshot.accounts.is_empty() {
        println!("\n\x1b[33m⚠️ 暂无已保存账号。\x1b[0m");
        wait_for_key();
        return;
    }

    let selected = match select_account_interactive(&snapshot.accounts) {
        Some(acc) => acc,
        None => return,
    };

    let title = format!("管理账号: {} (ID: {})", selected.email, selected.id);
    let sub_choice = select_menu_interactive(
        &title,
        &[
            "[1] ✏️  修改备注标签 (最多15字)",
            "[2] 🔄 切换启用/禁用状态",
            "[3] 🗑️  删除账号 (永久移除)",
            "[0] ↩️  返回主菜单",
        ],
        0,
    );

    match sub_choice {
        Some(0) => {
            let prompt = format!(
                "\n当前备注: {}\n请输入新的备注标签 (直接回车可清除当前备注): ",
                selected.custom_label.as_deref().unwrap_or("无")
            );
            let new_label = prompt_line(&prompt);
            if new_label.chars().count() > 15 {
                println!("\x1b[1;31m✗ 标签长度不能超过 15 个字符\x1b[0m");
            } else {
                match crate::modules::account::load_account(&selected.id) {
                    Ok(mut acc) => {
                        acc.custom_label = if new_label.is_empty() {
                            None
                        } else {
                            Some(new_label.clone())
                        };
                        if let Err(e) = crate::modules::account::save_account(&acc) {
                            println!("\x1b[1;31m✗ 保存失败: {}\x1b[0m", e);
                        } else if new_label.is_empty() {
                            println!("\x1b[1;32m✓ 备注标签已成功清除\x1b[0m");
                        } else {
                            println!("\x1b[1;32m✓ 备注标签已更新为: {}\x1b[0m", new_label);
                        }
                    }
                    Err(e) => println!("\x1b[1;31m✗ 读取账号失败: {}\x1b[0m", e),
                }
            }
            wait_for_key();
        }
        Some(1) => {
            match crate::modules::account::load_account(&selected.id) {
                Ok(mut acc) => {
                    acc.disabled = !acc.disabled;
                    if acc.disabled {
                        acc.disabled_at = Some(chrono::Utc::now().timestamp());
                        acc.disabled_reason = Some("Manually disabled via CLI".to_string());
                    } else {
                        acc.disabled_at = None;
                        acc.disabled_reason = None;
                    }
                    if let Err(e) = crate::modules::account::save_account(&acc) {
                        println!("\x1b[1;31m✗ 保存失败: {}\x1b[0m", e);
                    } else {
                        let status_text = if acc.disabled {
                            "\x1b[1;33m已禁用\x1b[0m"
                        } else {
                            "\x1b[1;32m正常启用\x1b[0m"
                        };
                        println!("\x1b[1;32m✓ 账号状态已切换为: {}\x1b[0m", status_text);
                    }
                }
                Err(e) => println!("\x1b[1;31m✗ 读取账号失败: {}\x1b[0m", e),
            }
            wait_for_key();
        }
        Some(2) => {
            let confirm = prompt_line(&format!(
                "\n⚠️  确定要永久删除账号 {} 吗？此操作无法撤销！(y/N): ",
                selected.email
            ));
            if confirm.eq_ignore_ascii_case("y") || confirm.eq_ignore_ascii_case("yes") {
                match crate::modules::account::delete_account(&selected.id) {
                    Ok(_) => println!("\x1b[1;32m✓ 账号已成功删除\x1b[0m"),
                    Err(e) => println!("\x1b[1;31m✗ 删除账号失败: {}\x1b[0m", e),
                }
            } else {
                println!("\x1b[2m已取消删除操作。\x1b[0m");
            }
            wait_for_key();
        }
        _ => {}
    }
}

fn show_system_status(snapshot: &Snapshot, root: &Path) {
    print!("\x1b[2J\x1b[H");
    println!("\x1b[1;36m================================================================================\x1b[0m");
    println!("\x1b[1;37m  🖥️  关联应用与系统环境状态 (Linked Applications & Storage)\x1b[0m");
    println!("\x1b[1;36m================================================================================\x1b[0m\n");

    let app_path = crate::modules::process::get_antigravity_executable_path(None);
    let app_running = crate::modules::process::is_antigravity_running(None);
    println!("\x1b[1;37m• AntiGravity Desktop APP:\x1b[0m");
    if app_running {
        println!("  运行状态: \x1b[1;32m🟢 运行中\x1b[0m");
    } else {
        println!("  运行状态: \x1b[2m⚪ 未运行\x1b[0m");
    }
    if let Some(path) = app_path {
        println!("  程序路径: \x1b[36m{}\x1b[0m", path.display());
    } else {
        println!("  程序路径: \x1b[33m未自动识别 (可在设置中手动指定)\x1b[0m");
    }
    println!();

    let ide_running = crate::modules::process::is_antigravity_running(Some("ide"));
    println!("\x1b[1;37m• AntiGravity IDE:\x1b[0m");
    if ide_running {
        println!("  运行状态: \x1b[1;32m🟢 运行中\x1b[0m");
    } else {
        println!("  运行状态: \x1b[2m⚪ 未运行 (支持独立通道关联)\x1b[0m");
    }
    println!();

    println!("\x1b[1;37m• 本地数据存储 (Local Data Storage):\x1b[0m");
    println!("  存储目录: \x1b[36m{}\x1b[0m", root.display());
    println!("  账号数量: {} 个已保存账号", snapshot.accounts.len());
    if let Ok(curr) = snapshot.current() {
        println!(
            "  当前生效: \x1b[1;32m{}\x1b[0m (目标: {})",
            curr.email,
            snapshot.current_target.as_deref().unwrap_or("app")
        );
    } else {
        println!("  当前生效: \x1b[33m未设置\x1b[0m");
    }
    println!();

    println!("\x1b[1;37m• 命令行工具 (CLI Binary):\x1b[0m");
    println!("  主命令名: \x1b[1;32magy-switch\x1b[0m (兼容别名: agy-lite)");
    println!("  工具版本: \x1b[36mv{}\x1b[0m", env!("CARGO_PKG_VERSION"));
    println!("  交互控制: 支持 ↑/↓ 方向键导航与数字键快捷选择");
    println!("\n\x1b[1;36m================================================================================\x1b[0m");

    wait_for_key();
}
