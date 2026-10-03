import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart2,
  Check,
  ChevronRight,
  Info,
  Key,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Settings,
  Zap,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type { Account } from "../types/account";
import { request } from "../utils/request";
import { isTauri } from "../utils/env";
import {
  compactQuotaGroups,
  isAccountSwitchable,
  resetTimestamp,
} from "../utils/menuBarQuota";
import { useMenuBarSwitchStatus } from "../components/menubar/LowQuotaStatus";
import "../components/menubar/MenuBarDashboard.css";

interface LocalUsage {
  today: { total_tokens: number; request_count: number };
}

const formatTokens = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${value}`;
};

export default function MenuBarDashboard() {
  const { i18n } = useTranslation();
  const chinese = i18n.language.startsWith("zh");
  const lowQuota = useMenuBarSwitchStatus();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [usage, setUsage] = useState<LocalUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [showAbout, setShowAbout] = useState(false);

  const generation = useRef(0);
  const operationLock = useRef(false);

  // Enforce transparency on html/body for menubar popover
  useEffect(() => {
    document.documentElement.classList.add("panel-window");
    document.body.classList.add("panel-window");
    document.documentElement.style.setProperty("background", "transparent", "important");
    document.body.style.setProperty("background", "transparent", "important");
  }, []);

  const reload = useCallback(async () => {
    const requestId = ++generation.current;
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    try {
      const [saved, active] = await Promise.all([
        request<Account[]>("list_accounts"),
        request<Account | null>("get_current_account"),
      ]);
      if (requestId !== generation.current) return;
      setAccounts(saved);
      const activeAccount = active
        ? saved.find((account) => account.id === active.id) || active
        : saved[0] || null;
      setCurrentAccount(activeAccount);
      setSelectedAccountId((prev) => prev ?? (activeAccount ? activeAccount.id : null));
      setNow(Date.now());
    } catch (e) {
      console.error("Failed to load accounts in menubar:", e);
    } finally {
      if (requestId === generation.current) setLoading(false);
    }
  }, []);

  const loadUsage = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setUsage(await request<LocalUsage>("get_local_token_usage"));
    } catch {
      setUsage(null);
    }
  }, []);

  useEffect(() => {
    void reload();
    void loadUsage();
    if (!isTauri()) return;

    const listeners = [
      listen("menubar://opened", () => {
        setNow(Date.now());
        void reload();
        void loadUsage();
      }),
      listen("menubar://data-updated", () => void reload()),
      listen("tray://account-switched", () => void reload()),
      listen("accounts://refreshed", () => void reload()),
    ];

    return () => {
      generation.current++;
      void Promise.all(listeners).then((unlisteners) =>
        unlisteners.forEach((unlisten) => unlisten()),
      );
    };
  }, [reload, loadUsage]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") setNow(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const hide = useCallback(() => {
    if (isTauri()) void request("hide_menu_bar_dashboard");
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [hide]);

  const openPage = (page: "dashboard" | "accounts" | "settings") => {
    if (isTauri()) void request("open_app_page", { page });
  };

  const viewAccount = (accountId: string | null) => {
    setSelectedAccountId(accountId);
  };

  const refresh = async () => {
    if (operationLock.current || !accounts.length) return;
    operationLock.current = true;
    setRefreshing(true);
    try {
      const target = accounts.find((a) => a.id === selectedAccountId) || currentAccount;
      if (target) {
        await request("fetch_account_quota", { accountId: target.id });
      } else {
        await request("refresh_all_quotas");
      }
      await reload();
      void loadUsage();
    } catch (e) {
      console.error("Refresh quota failed:", e);
    } finally {
      operationLock.current = false;
      setRefreshing(false);
    }
  };

  const switchAccount = async (account: Account) => {
    if (
      operationLock.current ||
      account.id === currentAccount?.id ||
      !isAccountSwitchable(account, now)
    )
      return;
    operationLock.current = true;
    setSwitchingId(account.id);
    const targetName = account.custom_label || account.email;
    try {
      await request("switch_account", { accountId: account.id });
      await reload();
    } catch (e) {
      console.error("Switch account failed for " + targetName, e);
      await reload();
    } finally {
      operationLock.current = false;
      setSwitchingId(null);
    }
  };

  const viewedAccount = accounts.find((a) => a.id === selectedAccountId) || currentAccount || accounts[0];
  const isViewedActive = viewedAccount?.id === currentAccount?.id;

  const groups = useMemo(
    () => compactQuotaGroups(viewedAccount?.quota),
    [viewedAccount?.quota],
  );

  const activeQuotaModels = useMemo(() => {
    if (!viewedAccount?.quota || viewedAccount.quota.is_forbidden) return [];
    const rows: Array<{
      id: string;
      name: string;
      window?: string;
      percentage: number | null;
      resetLabel: string;
    }> = [];

    for (const group of groups) {
      if (group.name.includes("-tiered")) continue;
      for (const row of group.rows) {
        if (row.label && row.label.includes("-tiered")) continue;

        let resetLabel = "—";
        if (row.resetTime) {
          const ts = resetTimestamp(row.resetTime);
          if (ts !== null) {
            const diff = ts - now;
            if (diff <= 0) {
              resetLabel = chinese ? "已到重置时间 · 请刷新" : "Reset due · refresh";
            } else {
              const mins = Math.ceil(diff / 60_000);
              if (mins < 60) {
                resetLabel = chinese ? `${mins}分钟后重置` : `Resets in ${mins}m`;
              } else {
                const hrs = Math.floor(mins / 60);
                const remMins = mins % 60;
                if (hrs < 24) {
                  resetLabel = chinese
                    ? `${hrs}小时${remMins ? `${remMins}分` : ""}后重置`
                    : `Resets in ${hrs}h ${remMins ? `${remMins}m` : ""}`;
                } else {
                  const days = Math.floor(hrs / 24);
                  resetLabel = chinese ? `${days}天后重置` : `Resets in ${days}d`;
                }
              }
            }
          }
        }

        let cleanName = group.name;
        if (cleanName.includes("claude-sonnet-4-6") || cleanName.includes("claude-3-7")) {
          cleanName = "Claude Sonnet 4.6 (Thinking)";
        } else if (cleanName.includes("claude-3-5")) {
          cleanName = "Claude 3.5 Sonnet";
        } else if (cleanName.includes("flash") && cleanName.includes("3.8")) {
          cleanName = "Gemini 3.8 Flash (High)";
        } else if (cleanName.includes("flash") && cleanName.includes("image")) {
          cleanName = "Gemini 3.1 Flash Image";
        } else if (cleanName.includes("flash")) {
          cleanName = "Gemini Flash";
        } else if (cleanName.includes("pro")) {
          cleanName = "Gemini Pro";
        } else {
          cleanName = cleanName.replace(/ models?$/i, "");
        }

        let windowLabel = row.window;
        if (windowLabel === "5h") windowLabel = chinese ? "5小时" : "5h";
        else if (windowLabel === "weekly") windowLabel = chinese ? "每周" : "Weekly";

        rows.push({
          id: row.id,
          name:
            row.label && row.label !== row.window && !row.label.includes("5h")
              ? row.label
              : cleanName,
          window: windowLabel,
          percentage: row.remaining !== null ? Math.round(row.remaining) : null,
          resetLabel,
        });
      }
    }

    return rows.slice(0, 4);
  }, [viewedAccount, groups, now, chinese]);

  const lastUpdated = useMemo(() => {
    if (!viewedAccount?.quota?.last_updated) {
      return chinese ? "尚未刷新" : "Not refreshed";
    }
    const diff = now - viewedAccount.quota.last_updated * 1000;
    if (diff < 60_000) return chinese ? "刚刚更新" : "Updated just now";
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return chinese ? `${mins} 分钟前` : `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return chinese ? `${hrs} 小时前` : `${hrs}h ago`;
  }, [viewedAccount, now, chinese]);

  const getProgressColor = (percentage: number | null, name: string) => {
    if (percentage === null) return "bg-gray-400";
    if (percentage <= 20) return "bg-[#EF4444]"; // Low quota: warning red
    if (percentage <= 40) return "bg-[#F59E0B]"; // Medium: amber
    if (name.toLowerCase().includes("claude")) return "bg-[#F97316]"; // Claude signature peach/orange like CodexBar
    return "bg-[#007AFF]"; // Apple macOS vibrant blue
  };

  return (
    <div className="menubar-app">
      {/* 1. Top Provider / Account Segmented Tabs (CodexBar Style) */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] overflow-x-auto no-scrollbar shrink-0">
        {accounts.map((account, idx) => {
          const isSelected = account.id === viewedAccount?.id;
          const isCurrent = account.id === currentAccount?.id;
          const label = account.custom_label || (chinese ? `账号 ${idx + 1}` : `Acc ${idx + 1}`);

          return (
            <button
              key={account.id}
              type="button"
              onClick={() => viewAccount(account.id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs transition-all shrink-0 select-none ${
                isSelected
                  ? "bg-[#007AFF] text-white shadow-sm font-semibold"
                  : "text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 font-medium"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isCurrent
                    ? isSelected
                      ? "bg-white"
                      : "bg-emerald-500"
                    : isSelected
                    ? "bg-white/40"
                    : "bg-transparent"
                }`}
              />
              <span className="truncate max-w-[90px]">{label}</span>
            </button>
          );
        })}

        {/* Add Account shortcut */}
        <button
          type="button"
          onClick={() => openPage("accounts")}
          title={chinese ? "添加账号" : "Add Account"}
          className="p-1 px-2 rounded-lg text-xs font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 shrink-0 ml-auto transition-colors"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* 2. Header Section (CodexBar Style) */}
      <header className="flex flex-col gap-0.5 pt-0.5">
        <div className="flex items-center justify-between gap-2">
          <h1
            className="text-[15px] font-bold text-gray-900 dark:text-white tracking-tight truncate"
            title={viewedAccount?.email || ""}
          >
            {viewedAccount?.custom_label || viewedAccount?.email || "Antigravity"}
          </h1>

          <div className="shrink-0">
            {isViewedActive ? (
              <span
                title={chinese ? "当前生效账号 · 本机已同步" : "Current account recorded by Tools"}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {chinese ? "生效中" : "Active"} · {viewedAccount?.quota?.subscription_tier || "PRO"}
              </span>
            ) : viewedAccount ? (
              <button
                type="button"
                disabled={!isAccountSwitchable(viewedAccount, now) || Boolean(switchingId)}
                onClick={() => void switchAccount(viewedAccount)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 px-2.5 py-0.5 rounded-full border border-blue-500/20 transition-colors"
              >
                {switchingId === viewedAccount.id ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <Check size={10} />
                )}
                <span>{chinese ? "切换为此账号" : "Use this account"}</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
          <span>{lastUpdated}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing || !accounts.length}
            title={chinese ? "刷新配额" : "Refresh quotas"}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <RefreshCw size={11} className={refreshing ? "animate-spin text-blue-500" : ""} />
          </button>
        </div>
      </header>

      <div className="mb-divider" />

      {/* 3. Quota Models Progress Rows (CodexBar Style) */}
      <section className="flex flex-col gap-3 py-0.5">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-gray-400">
            <Loader2 size={14} className="animate-spin text-blue-500" />
            <span>{chinese ? "正在加载…" : "Loading…"}</span>
          </div>
        ) : viewedAccount?.quota?.is_forbidden ? (
          <div className="py-4 text-center text-xs text-rose-500">
            {chinese ? "额度访问受限 (403)" : "Quota access denied (403)"}
          </div>
        ) : activeQuotaModels.length > 0 ? (
          activeQuotaModels.map((model) => (
            <div key={model.id} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                  {model.name}
                </span>
                {model.window && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">
                    {model.window}
                  </span>
                )}
              </div>

              {/* Thin, sleek pill progress bar */}
              <div className="h-[5px] w-full rounded-full bg-black/[0.06] dark:bg-white/[0.12] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${getProgressColor(
                    model.percentage,
                    model.name,
                  )}`}
                  style={{
                    width: `${Math.max(2, Math.min(100, model.percentage ?? 0))}%`,
                  }}
                />
              </div>

              {/* Stats line: Left percentage, Right reset countdown */}
              <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400 font-medium">
                <span>
                  {model.percentage !== null
                    ? chinese
                      ? `${model.percentage}% 剩余`
                      : `${model.percentage}% available`
                    : "—"}
                </span>
                <span>{model.resetLabel}</span>
              </div>
            </div>
          ))
        ) : (
          <div className="py-4 text-center text-xs text-gray-400">
            {chinese ? "暂无配额数据，点击刷新同步" : "No quota reported, refresh to sync"}
          </div>
        )}
      </section>

      <div className="mb-divider" />

      {/* 4. Token Usage & Cost (CodexBar Style) */}
      <div
        onClick={() => openPage("dashboard")}
        className="group flex flex-col gap-1 rounded-xl p-2 -mx-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
            {chinese ? "用量与费用" : "Cost & Usage"}
          </span>
          <ChevronRight
            size={13}
            className="text-gray-400 group-hover:translate-x-0.5 transition-transform"
          />
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center justify-between">
          <span>
            {chinese
              ? `今日: ${formatTokens(usage?.today.total_tokens || 0)} Tokens`
              : `Today: ${formatTokens(usage?.today.total_tokens || 0)} tokens`}
          </span>
          <span>
            {usage?.today.request_count
              ? `${usage.today.request_count} ${chinese ? "次请求" : "requests"}`
              : ""}
          </span>
        </div>
      </div>

      <div className="mb-divider" />

      {/* 5. CodexBar Native Action Menu List */}
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => openPage("accounts")}
          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors text-left w-full"
        >
          <Key size={13} className="text-gray-400 shrink-0" />
          <span>{chinese ? "添加 / 管理账号…" : "Add Account…"}</span>
        </button>

        <button
          type="button"
          onClick={() => openPage("dashboard")}
          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors text-left w-full"
        >
          <BarChart2 size={13} className="text-gray-400 shrink-0" />
          <span>{chinese ? "本地用量看板" : "Usage Dashboard"}</span>
        </button>

        <button
          type="button"
          onClick={() => openPage("settings")}
          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors text-left w-full"
        >
          <Zap size={13} className="text-amber-500 shrink-0" />
          <span>{chinese ? "自动切号状态" : "Auto-Switch Status"}</span>
          {lowQuota.visible && (
            <span className="ml-auto text-[10px] text-amber-500 font-semibold">
              {chinese ? "监控中" : "Active"}
            </span>
          )}
        </button>

        <div className="mb-divider" />

        <button
          type="button"
          onClick={() => openPage("settings")}
          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors text-left w-full"
        >
          <Settings size={13} className="text-gray-400 shrink-0" />
          <span>{chinese ? "偏好设置…" : "Settings…"}</span>
        </button>

        <button
          type="button"
          onClick={() => setShowAbout((prev) => !prev)}
          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors text-left w-full"
        >
          <Info size={13} className="text-gray-400 shrink-0" />
          <span>{chinese ? "关于 Antigravity Tools Lite" : "About Antigravity Tools Lite"}</span>
        </button>

        {showAbout && (
          <div className="p-2 text-[10px] text-gray-500 dark:text-gray-400 bg-black/[0.03] dark:bg-white/[0.04] rounded-lg border border-black/[0.05] dark:border-white/[0.08] my-0.5">
            <p className="font-semibold text-gray-800 dark:text-gray-200">Antigravity Tools Lite v4.7.8</p>
            <p className="mt-0.5">macOS Native Menu Bar AI Assistant</p>
          </div>
        )}

        <button
          type="button"
          onClick={() => request("quit_app")}
          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors text-left w-full"
        >
          <LogOut size={13} className="text-red-500 shrink-0" />
          <span>{chinese ? "退出应用" : "Quit"}</span>
        </button>
      </div>
    </div>
  );
}
