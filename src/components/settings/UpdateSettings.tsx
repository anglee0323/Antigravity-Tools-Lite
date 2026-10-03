import { useState } from 'react';
import { ArrowUpCircle, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUpdateStore } from '../../stores/useUpdateStore';
import { showToast } from '../common/ToastContainer';
import { isTauri } from '../../utils/env';

export default function UpdateSettings() {
  const { t } = useTranslation();
  const { isChecking, lastChecked, checkForUpdates, updateInfo } = useUpdateStore();
  const [currentVersion] = useState('4.7.7');

  const handleCheck = async () => {
    try {
      const res = await checkForUpdates(false);
      if (res && !res.has_update) {
        showToast(t('updater.already_latest', '当前已是最新版本'), 'success');
      }
    } catch (err: any) {
      const errorMsg = typeof err === 'string' ? err : err?.message || String(err);
      showToast(
        t('updater.check_failed', '检查更新失败: {{error}}', { error: errorMsg }),
        'error'
      );
    }
  };

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/80">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            <ArrowUpCircle className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t('updater.title', '软件更新')}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {t('updater.desc', '检查 GitHub Releases 最新版本并支持一键下载安装重启。')}
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={isChecking || !isTauri()}
          onClick={() => void handleCheck()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-400 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0"
        >
          {isChecking ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{t('updater.checking', '正在检查...')}</span>
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              <span>{t('updater.check_now', '检查更新')}</span>
            </>
          )}
        </button>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <span>{t('updater.current_version', '当前版本')}:</span>
          <span className="font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-slate-700/60 px-2 py-0.5 rounded-md">
            v{updateInfo?.current_version || currentVersion}
          </span>
          {lastChecked && (
            <span className="text-[11px] text-gray-400">
              ({t('updater.last_checked', '上次检查')}: {new Date(lastChecked).toLocaleTimeString()})
            </span>
          )}
        </div>

        <a
          href="https://github.com/anglee0323/antigravity-tools-lite/releases"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
        >
          <span>{t('updater.view_all_releases', '查看所有发布历史')}</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </section>
  );
}
