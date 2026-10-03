import { create } from 'zustand';
import {
  checkForUpdates as apiCheckForUpdates,
  downloadAndInstallUpdate as apiDownloadAndInstallUpdate,
  DownloadProgress,
  UpdateInfo,
} from '../services/updaterService';
import { isTauri } from '../utils/env';

interface UpdateState {
  updateInfo: UpdateInfo | null;
  isChecking: boolean;
  isDownloading: boolean;
  downloadProgress: DownloadProgress | null;
  statusMessage: string | null;
  error: string | null;
  isDialogOpen: boolean;
  lastChecked: number | null;

  checkForUpdates: (silent?: boolean) => Promise<UpdateInfo | null>;
  startUpdate: () => Promise<void>;
  setDialogOpen: (open: boolean) => void;
  clearError: () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  updateInfo: null,
  isChecking: false,
  isDownloading: false,
  downloadProgress: null,
  statusMessage: null,
  error: null,
  isDialogOpen: false,
  lastChecked: null,

  checkForUpdates: async (silent = false) => {
    if (!isTauri()) return null;
    if (get().isChecking || get().isDownloading) return null;

    set({ isChecking: true, error: null });
    try {
      const info = await apiCheckForUpdates();
      set({
        updateInfo: info,
        isChecking: false,
        lastChecked: Date.now(),
        isDialogOpen: silent ? info.has_update : true,
      });
      return info;
    } catch (err: any) {
      const errorMessage = typeof err === 'string' ? err : err?.message || String(err);
      set({
        isChecking: false,
        error: silent ? null : errorMessage,
        lastChecked: Date.now(),
      });
      if (!silent) {
        throw err;
      }
      return null;
    }
  },

  startUpdate: async () => {
    const { updateInfo, isDownloading } = get();
    if (!updateInfo || !updateInfo.download_url || !updateInfo.asset_name || isDownloading) {
      return;
    }

    set({
      isDownloading: true,
      downloadProgress: { downloaded: 0, total: updateInfo.asset_size || 0, percentage: 0 },
      error: null,
      statusMessage: null,
    });

    let unlisten: (() => void) | undefined;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<DownloadProgress>('updater-download-progress', (event) => {
        set({ downloadProgress: event.payload });
      });

      const message = await apiDownloadAndInstallUpdate(
        updateInfo.download_url,
        updateInfo.asset_name
      );

      set({
        isDownloading: false,
        statusMessage: message,
      });
    } catch (err: any) {
      const errorMessage = typeof err === 'string' ? err : err?.message || String(err);
      set({
        isDownloading: false,
        error: errorMessage,
      });
    } finally {
      if (unlisten) {
        unlisten();
      }
    }
  },

  setDialogOpen: (open: boolean) => set({ isDialogOpen: open }),
  clearError: () => set({ error: null }),
}));
