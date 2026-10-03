import { createPortal } from 'react-dom';
import { CheckCircle2, Download, ExternalLink, Loader2, Sparkles, X, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUpdateStore } from '../../stores/useUpdateStore';

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let unitIndex = 0;
  while (val >= 1024 && unitIndex < units.length - 1) {
    val /= 1024;
    unitIndex++;
  }
  return `${val.toFixed(2)} ${units[unitIndex]}`;
}

export default function UpdateDialog() {
  const { t } = useTranslation();
  const {
    updateInfo,
    isDownloading,
    downloadProgress,
    statusMessage,
    error,
    isDialogOpen,
    setDialogOpen,
    startUpdate,
    clearError,
  } = useUpdateStore();

  if (!isDialogOpen || !updateInfo) {
    return null;
  }

  const handleClose = () => {
    if (isDownloading) return;
    clearError();
    setDialogOpen(false);
  };

  const handleOpenReleaseUrl = () => {
    if (updateInfo.release_url) {
      window.open(updateInfo.release_url, '_blank');
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <div data-tauri-drag-region className="fixed top-0 left-0 right-0 h-8 z-[1]" />

      {/* Backdrop click */}
      <div className="absolute inset-0 z-[0]" onClick={handleClose} />

      <div className="bg-white dark:bg-base-100 text-gray-900 dark:text-base-content rounded-2xl shadow-2xl w-full max-w-lg p-6 relative z-[10] m-4 max-h-[90vh] flex flex-col border border-gray-100 dark:border-base-300">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-base-200">
          <div className="flex items-center gap-2.5">
            {updateInfo.has_update ? (
              <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                <Sparkles className="w-5 h-5" />
              </div>
            ) : (
              <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            )}
            <div>
              <h3 className="font-bold text-base">
                {updateInfo.has_update
                  ? t('updater.new_version_available', '发现新版本')
                  : t('updater.up_to_date', '当前已是最新版本')}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {updateInfo.has_update
                  ? `${updateInfo.current_version} -> ${updateInfo.latest_version}`
                  : `v${updateInfo.current_version}`}
              </p>
            </div>
          </div>
          {!isDownloading && (
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-base-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="py-4 space-y-4 overflow-y-auto flex-1 text-sm">
          {updateInfo.has_update ? (
            <>
              {/* Release Title & Asset badge */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 dark:bg-base-200/50 p-3 rounded-xl">
                <div>
                  <div className="font-semibold text-xs text-gray-800 dark:text-gray-200">
                    {updateInfo.release_name || updateInfo.latest_version}
                  </div>
                  {updateInfo.published_at && (
                    <div className="text-[11px] text-gray-400">
                      {new Date(updateInfo.published_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
                {updateInfo.asset_name && (
                  <div className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                    {formatBytes(updateInfo.asset_size)}
                  </div>
                )}
              </div>

              {/* Release Notes */}
              <div>
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  {t('updater.release_notes', '更新说明')}
                </div>
                <div className="max-h-48 overflow-y-auto p-3 rounded-xl bg-gray-50 dark:bg-base-200/60 border border-gray-200/60 dark:border-base-300 text-xs leading-relaxed whitespace-pre-wrap font-sans text-gray-700 dark:text-gray-300">
                  {updateInfo.release_notes || t('updater.no_release_notes', '暂无详细说明')}
                </div>
              </div>

              {/* Download Progress */}
              {isDownloading && downloadProgress && (
                <div className="space-y-1.5 p-3 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30">
                  <div className="flex justify-between text-xs font-medium text-blue-600 dark:text-blue-400">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {t('updater.downloading', '正在下载安装包...')}
                    </span>
                    <span>{downloadProgress.percentage.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-blue-200/60 dark:bg-blue-900/50 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 dark:bg-blue-400 h-full rounded-full transition-all duration-150"
                      style={{ width: `${Math.min(100, Math.max(0, downloadProgress.percentage))}%` }}
                    />
                  </div>
                  <div className="text-right text-[11px] text-gray-500 dark:text-gray-400">
                    {formatBytes(downloadProgress.downloaded)} / {formatBytes(downloadProgress.total)}
                  </div>
                </div>
              )}

              {/* Status Message */}
              {statusMessage && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>{statusMessage}</span>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span className="break-all">{error}</span>
                </div>
              )}
            </>
          ) : (
            <div className="py-6 text-center space-y-2">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
              <p className="font-medium text-sm text-gray-800 dark:text-gray-200">
                {t('updater.already_latest', '当前已安装最新版本')}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('updater.version_tag', { version: updateInfo.current_version }) || `v${updateInfo.current_version}`}
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-gray-100 dark:border-base-200 flex flex-wrap items-center justify-between gap-2">
          {updateInfo.release_url ? (
            <button
              type="button"
              onClick={handleOpenReleaseUrl}
              className="text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 flex items-center gap-1.5 py-1.5 px-2 rounded-lg hover:bg-gray-100 dark:hover:bg-base-200 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{t('updater.view_on_github', '在 GitHub 上查看')}</span>
            </button>
          ) : <div />}

          <div className="flex items-center gap-2">
            {updateInfo.has_update ? (
              <>
                <button
                  type="button"
                  disabled={isDownloading || !!statusMessage}
                  onClick={handleClose}
                  className="px-3.5 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-base-200 rounded-xl transition-colors disabled:opacity-50"
                >
                  {t('updater.later', '稍后提醒')}
                </button>
                <button
                  type="button"
                  disabled={isDownloading || !updateInfo.download_url || !!statusMessage}
                  onClick={() => void startUpdate()}
                  className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t('updater.updating', '正在更新...')}</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" />
                      <span>{t('updater.update_now', '立即下载并重启更新')}</span>
                    </>
                  )}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-base-200 dark:hover:bg-base-300 text-gray-800 dark:text-gray-200 rounded-xl transition-colors"
              >
                {t('common.confirm', '确定')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
