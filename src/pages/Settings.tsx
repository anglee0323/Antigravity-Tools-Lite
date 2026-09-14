import { useEffect, useState } from 'react';
import { Database, FolderOpen, Globe2, Monitor, Moon, Sun } from 'lucide-react';
import { useConfigStore } from '../stores/useConfigStore';
import { AppConfig } from '../types/config';
import { request as invoke } from '../utils/request';
import { showToast } from '../components/common/ToastContainer';

const LANGUAGES = [
    { code: 'zh', label: '简体中文' },
    { code: 'zh-TW', label: '繁體中文' },
    { code: 'en', label: 'English' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
];

function Settings() {
    const { config, loadConfig, saveConfig } = useConfigStore();
    const [dataDirPath, setDataDirPath] = useState('~/.antigravity_tools');

    useEffect(() => {
        loadConfig();
        invoke<string>('get_data_dir_path')
            .then(setDataDirPath)
            .catch(() => {});
    }, [loadConfig]);

    const updateConfig = async (patch: Partial<AppConfig>) => {
        if (!config) return;
        try {
            await saveConfig({ ...config, ...patch }, true);
            showToast('设置已保存', 'success');
        } catch (error) {
            showToast(`保存设置失败：${error}`, 'error');
        }
    };

    const openDataFolder = async () => {
        try {
            await invoke('open_data_folder');
        } catch (error) {
            showToast(`打开数据目录失败：${error}`, 'error');
        }
    };

    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="mx-auto max-w-4xl space-y-5 p-5">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-base-content">设置</h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">只保留本地使用需要的基础设置</p>
                </div>

                <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-base-200 dark:bg-base-100">
                    <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900 dark:text-base-content">
                        <Monitor className="h-5 w-5 text-blue-500" />
                        外观与语言
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="space-y-2">
                            <span className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                {config?.theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                                主题
                            </span>
                            <select
                                value={config?.theme || 'system'}
                                onChange={(event) => updateConfig({ theme: event.target.value })}
                                disabled={!config}
                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-blue-400 dark:border-base-200 dark:bg-base-200 dark:text-gray-200"
                            >
                                <option value="system">跟随系统</option>
                                <option value="light">浅色</option>
                                <option value="dark">深色</option>
                            </select>
                        </label>
                        <label className="space-y-2">
                            <span className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                <Globe2 className="h-4 w-4" />
                                语言
                            </span>
                            <select
                                value={config?.language || 'zh'}
                                onChange={(event) => updateConfig({ language: event.target.value })}
                                disabled={!config}
                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-blue-400 dark:border-base-200 dark:bg-base-200 dark:text-gray-200"
                            >
                                {LANGUAGES.map((language) => (
                                    <option key={language.code} value={language.code}>{language.label}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                </section>

                <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-base-200 dark:bg-base-100">
                    <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900 dark:text-base-content">
                        <Database className="h-5 w-5 text-emerald-500" />
                        本地数据
                    </h2>
                    <div className="space-y-4 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3 dark:bg-base-200/60">
                            <div>
                                <div className="font-medium text-gray-700 dark:text-gray-200">账号数据目录</div>
                                <div className="mt-1 break-all font-mono text-xs text-gray-500 dark:text-gray-400">{dataDirPath}</div>
                            </div>
                            <button
                                onClick={openDataFolder}
                                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 hover:border-blue-300 hover:text-blue-600 dark:border-base-300 dark:bg-base-100 dark:text-gray-300"
                            >
                                <FolderOpen className="h-4 w-4" />
                                打开目录
                            </button>
                        </div>
                        <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs leading-6 text-blue-700 dark:border-blue-900/30 dark:bg-blue-900/10 dark:text-blue-300">
                            定制版继续使用现有账号数据，不会要求你重新授权。首页 Token 统计只读本机
                            <span className="mx-1 font-mono">~/.gemini/antigravity*/conversations</span>
                            ，不会经过中转站，也不会上传对话内容。
                        </div>
                    </div>
                </section>

                <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:border-base-200 dark:bg-base-200/50 dark:text-gray-400">
                    账号凭证保存在本机数据目录；源码目录只包含程序代码，不包含任何账号凭证。
                </div>
            </div>
        </div>
    );
}

export default Settings;
