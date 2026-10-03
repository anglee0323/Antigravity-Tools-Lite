import { request } from '../utils/request';

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_name: string;
  release_notes: string;
  release_url: string;
  asset_name?: string | null;
  download_url?: string | null;
  asset_size?: number | null;
  published_at?: string | null;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  return await request<UpdateInfo>('check_for_updates');
}

export async function downloadAndInstallUpdate(
  downloadUrl: string,
  assetName: string
): Promise<string> {
  return await request<string>('download_and_install_update', {
    downloadUrl,
    assetName,
  });
}
