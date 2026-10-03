import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, PanelTop, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { request } from "../../utils/request";
import { isTauri } from "../../utils/env";
import { useConfigStore } from "../../stores/useConfigStore";
import { getMenuBarMessages } from "../menubar/messages";

interface DesktopStatus {
  platform: string;
  tray_available: boolean;
  autostart_supported: boolean;
  launch_at_login: boolean | null;
  autostart_error?: string;
  dock_error?: string;
  hide_dock_icon: boolean;
  start_minimized: boolean;
}
type Preference = "launch_at_login" | "hide_dock_icon" | "start_minimized";

export default function DesktopSettings() {
  const { i18n } = useTranslation();
  const t = getMenuBarMessages(i18n.language);
  const loadConfig = useConfigStore((state) => state.loadConfig);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [busy, setBusy] = useState<Preference | null>(null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const generation = useRef(0);
  const live = useRef(true);
  const load = useCallback(async () => {
    if (!isTauri() || lock.current || !live.current) return;
    const requestId = ++generation.current;
    try {
      const next = await request<DesktopStatus>("get_desktop_settings");
      if (live.current && generation.current === requestId) {
        setStatus(next);
        setError("");
      }
    } catch (e) {
      if (live.current && generation.current === requestId) setError(String(e));
    }
  }, []);
  useEffect(() => {
    live.current = true;
    void load();
    return () => { live.current = false; generation.current++; };
  }, [load]);
  useEffect(() => {
    // System Settings may have changed the login item while this app was inactive.
    const focus = () => {
      if (!lock.current) void load();
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [load]);
  const update = async (key: Preference, value: boolean) => {
    if (lock.current || !live.current) return;
    lock.current = true;
    const requestId = ++generation.current;
    setBusy(key);
    setError("");
    try {
      const patch = key === "hide_dock_icon"
        ? { hide_dock_icon: value, start_minimized: value }
        : { [key]: value };
      const next = await request<DesktopStatus>("set_desktop_preferences", {
        patch,
      });
      if (live.current && generation.current === requestId) {
        setStatus(next);
        await loadConfig();
      }
    } catch (e) {
      if (!live.current || generation.current !== requestId) return;
      setError(String(e));
      // Re-read login registration and saved preferences. A native Dock
      // failure stays explicit in dock_error; disk state is not OS proof.
      try {
        const next = await request<DesktopStatus>("get_desktop_settings");
        if (live.current && generation.current === requestId) setStatus(next);
      } catch {
        /* Keep last known state. */
      }
    } finally {
      lock.current = false;
      if (live.current && generation.current === requestId) setBusy(null);
    }
  };
  const isMac = !status || status.platform === "macos";
  const rows: {
    key: Preference;
    title: string;
    hint: string;
    disabled?: boolean;
    note?: string;
  }[] = [
    {
      key: "launch_at_login",
      title: t.login,
      hint: t.loginHint,
      disabled: !status?.autostart_supported || status.launch_at_login === null,
      note: status && !status.autostart_supported ? t.releaseOnly : undefined,
    },
    {
      key: isMac ? "hide_dock_icon" : "start_minimized",
      title: isMac ? t.dock : t.background,
      hint: isMac ? t.dockHint : t.backgroundHint,
      disabled: !status?.tray_available,
    },
  ];
  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
      <div className="mb-5 flex items-start gap-3">
        <span className="rounded-xl bg-violet-50 p-2.5 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
          <PanelTop className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {t.desktopTitle}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {t.desktopHint}
          </p>
        </div>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-slate-800">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-start justify-between gap-4 py-4 first:pt-0"
          >
            <div>
              <label
                htmlFor={`desktop-${row.key}`}
                className="text-sm font-medium text-gray-800 dark:text-gray-200"
              >
                {row.title}
              </label>
              <p
                id={`desktop-${row.key}-hint`}
                className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400"
              >
                {row.note || row.hint}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              id={`desktop-${row.key}`}
              aria-describedby={`desktop-${row.key}-hint`}
              aria-checked={Boolean(status?.[row.key])}
              aria-label={row.title}
              disabled={!status || Boolean(busy) || row.disabled}
              onClick={() => void update(row.key, !status?.[row.key])}
              className={`relative mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-40 ${status?.[row.key] ? "bg-violet-600" : "bg-gray-200 dark:bg-slate-600"}`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm transition-transform ${status?.[row.key] ? "translate-x-6" : "translate-x-1"}`}
              >
                {busy === row.key && (
                  <Loader2 className="h-3 w-3 animate-spin text-violet-600" />
                )}
              </span>
            </button>
          </div>
        ))}
      </div>
      <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-500 dark:bg-slate-800 dark:text-gray-400">
        {!isTauri()
          ? t.nativeOnly
          : status && !status.tray_available
            ? t.noTray
            : t.menuHint}
      </p>
      {(error || status?.autostart_error || status?.dock_error) && (
        <div
          role="alert"
          className="mt-3 text-xs text-red-600 dark:text-red-400"
        >
          {error && <p>{error}</p>}
          {status?.autostart_error && <p>{t.launchUnknown}: {status.autostart_error}</p>}
          {status?.dock_error && <p>{t.dockUnknown}: {status.dock_error}</p>}
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 inline-flex items-center gap-1.5 font-medium"
          >
            <RefreshCw className="h-3 w-3" />
            {t.retry}
          </button>
        </div>
      )}
    </section>
  );
}
