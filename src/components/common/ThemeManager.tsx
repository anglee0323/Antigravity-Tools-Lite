
import { useEffect } from 'react';
import { useConfigStore } from '../../stores/useConfigStore';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { isLinux } from '../../utils/env';

export default function ThemeManager() {
    const { config, loadConfig } = useConfigStore();

    // Load config on mount
    useEffect(() => {
        void loadConfig();
    }, [loadConfig]);

    // Apply theme when config changes
    useEffect(() => {
        if (!config) return;
        const applyTheme = async (theme: string) => {
            const root = document.documentElement;
            const isDark = theme === 'dark';
            const isPanel = (Boolean((window as any).__TAURI_INTERNALS__) && getCurrentWindow().label === 'menubar') || window.location.pathname.includes('menubar') || window.location.href.includes('menubar');

            // Set Tauri window background color
            // Skip on Linux due to crash with transparent windows + softbuffer
            try {
                if (!isLinux() && (window as any).__TAURI_INTERNALS__) {
                    const bgColor = isDark ? '#1d232a' : '#FAFBFC';
                    // Don't await this, let it happen in background to avoid blocking React render
                    if (!isPanel) getCurrentWindow().setBackgroundColor(bgColor).catch(e =>
                        console.error('Failed to set window background color:', e)
                    );

                    // Sync Windows title bar theme (for minimize/maximize/close button colors)
                    const { invoke } = await import('@tauri-apps/api/core');
                    invoke('set_window_theme', { theme }).catch(() => {
                        // Ignore errors on non-Windows platforms
                    });
                }
            } catch (e) {
                console.error('Window background sync failed:', e);
            }

            // Set DaisyUI theme
            root.setAttribute('data-theme', theme);

            // Set inline style for immediate visual feedback
            if (isPanel) {
                root.classList.add('panel-window');
                root.style.setProperty('background-color', 'transparent', 'important');
                root.style.setProperty('background', 'transparent', 'important');
                document.body.classList.add('panel-window');
                document.body.style.setProperty('background-color', 'transparent', 'important');
                document.body.style.setProperty('background', 'transparent', 'important');
                const rootEl = document.getElementById('root');
                if (rootEl) {
                    rootEl.style.setProperty('background-color', 'transparent', 'important');
                    rootEl.style.setProperty('background', 'transparent', 'important');
                }
            } else {
                root.classList.remove('panel-window');
                document.body.classList.remove('panel-window');
                root.style.backgroundColor = isDark ? '#1d232a' : '#FAFBFC';
                document.body.style.backgroundColor = isDark ? '#1d232a' : '#FAFBFC';
            }

            // Set Tailwind dark mode class
            if (isDark) {
                root.classList.add('dark');
            } else {
                root.classList.remove('dark');
            }
        };

        const theme = config.theme || 'system';

        // Sync to localStorage for early boot check
        localStorage.setItem('app-theme-preference', theme);

        if (theme === 'system') {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

            const handleSystemChange = (e: MediaQueryListEvent | MediaQueryList) => {
                const systemTheme = e.matches ? 'dark' : 'light';
                applyTheme(systemTheme);
            };

            // Initial alignment
            handleSystemChange(mediaQuery);

            // Listen for changes
            mediaQuery.addEventListener('change', handleSystemChange);
            return () => mediaQuery.removeEventListener('change', handleSystemChange);
        } else {
            applyTheme(theme);
        }
    }, [config?.theme]);

    return null; // This component handles side effects only
}
