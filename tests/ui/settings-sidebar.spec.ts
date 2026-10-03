import { expect, test } from '@playwright/test';
import { setupSettingsFixture } from './settings-fixture';

test.beforeEach(async ({ page }, testInfo) => {
    const failure = testInfo.annotations.find(a => a.type === 'fixture-failure')?.description;
    await page.addInitScript(setupSettingsFixture, { failLoad: failure === 'general', failLowQuotaLoad: failure === 'low-quota' });
    await page.goto('/settings');
    await expect(page.getByRole('tab', { name: '外观与语言', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('six categories retain all fields and expose only the selected panel', async ({ page }) => {
    const tabs = page.getByRole('tab');
    expect(await tabs.allTextContents()).toEqual(['外观与语言', '启动与菜单栏', '账号与后台同步', '低额度换号', '应用与数据', '实验功能']);
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    for (const name of ['启动与菜单栏', '账号与后台同步', '应用与数据', '实验功能']) {
        await page.getByRole('tab', { name, exact: true }).click();
        await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
        await expect(page.getByRole('tabpanel')).toHaveCount(1);
    }
    await page.getByRole('tab', { name: '应用与数据', exact: true }).click();
    await expect(page.getByText('/synthetic/antigravity-tools', { exact: true })).toBeVisible();
    await expect(page.getByText('Antigravity IDE', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '启动与菜单栏', exact: true }).click();
    await expect(page.getByRole('tabpanel').getByRole('switch')).toHaveCount(3);
});

test('OFF draft stays editable and survives categories, pending save and errors', async ({ page }) => {
    await page.getByRole('tab', { name: '低额度换号', exact: true }).click();
    const reserve = page.getByLabel('剩余额度达到此比例时准备换号（%）', { exact: true });
    const minimum = page.getByLabel('备用账号至少剩余（%）', { exact: true });
    await expect(page.getByLabel('启用低额度换号（保存后生效）', { exact: true })).not.toBeChecked();
    await expect(reserve).toBeEnabled();
    await reserve.fill('13'); await minimum.fill('42');
    await page.getByLabel('监测模型', { exact: true }).selectOption('gemini-test');
    await page.getByLabel('backup@example.invalid', { exact: true }).check();
    const reads = await page.evaluate(() => (window as any).__settingsFixture.calls.filter((c: any) => c.command === 'get_auto_switch_config').length);
    await page.getByRole('tab', { name: '外观与语言', exact: true }).click();
    await page.getByRole('tab', { name: '低额度换号', exact: true }).click();
    await expect(reserve).toHaveValue('13'); await expect(minimum).toHaveValue('42');
    await expect(page.getByLabel('backup@example.invalid', { exact: true })).toBeChecked();
    expect(await page.evaluate(() => (window as any).__settingsFixture.calls.filter((c: any) => c.command === 'get_auto_switch_config').length)).toBe(reads);
    await page.evaluate(() => { (window as any).__settingsFixture.holdAutoSave = true; });
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(reserve).toBeDisabled();
    await page.getByRole('tab', { name: '应用与数据', exact: true }).click();
    await page.evaluate(() => (window as any).__settingsFixture.rejectAutoSave());
    await page.getByRole('tab', { name: '低额度换号', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'synthetic save rejection' })).toBeVisible();
    await expect(reserve).toBeEnabled(); await expect(reserve).toHaveValue('13');
});

test('keyboard selection, roving tab stop and narrow viewport have no overflow', async ({ page }) => {
    const first = page.getByRole('tab', { name: '外观与语言', exact: true });
    await first.focus(); await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('tab', { name: '启动与菜单栏', exact: true })).toBeFocused();
    await page.keyboard.press('End'); await expect(page.getByRole('tab', { name: '实验功能', exact: true })).toBeFocused();
    expect(await page.getByRole('tab').evaluateAll(tabs => tabs.filter(t => t.getAttribute('tabindex') === '0').length)).toBe(1);
    for (const width of [760, 420]) {
        await page.setViewportSize({ width, height: 900 });
        await page.getByRole('tab', { name: '低额度换号', exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await page.getByRole('tabpanel').locator('input, select').evaluateAll(fields => fields.filter(f => (f as HTMLElement).offsetWidth > 2).every(f => { const r = f.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }))).toBe(true);
    }
    const calls = await page.evaluate(() => (window as any).__settingsFixture.calls.map((c: any) => c.command));
    expect(calls.some((c: string) => /^(switch_account|refresh_all|stop_|kill_|delete_|start_oauth)/.test(c))).toBe(false);
});

// Positive captures are test artifacts, not native app acceptance or golden approval.
test('capture each category in both themes and low-quota narrow layouts', async ({ page }, testInfo) => {
    const categories = ['外观与语言', '启动与菜单栏', '账号与后台同步', '低额度换号', '应用与数据', '实验功能'];
    for (const theme of ['light', 'dark']) {
        await page.getByRole('tab', { name: '外观与语言', exact: true }).click();
        await page.getByRole('tabpanel').getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        for (let index = 0; index < categories.length; index++) {
            await page.getByRole('tab', { name: categories[index], exact: true }).click();
            await expect(page.getByRole('tabpanel', { name: categories[index], exact: true })).toBeVisible();
            await page.screenshot({ path: testInfo.outputPath(`settings-${theme}-${index}.png`) });
        }
    }
    for (const width of [760, 420]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.getByRole('tab', { name: '低额度换号', exact: true }).click();
        await page.screenshot({ path: testInfo.outputPath(`settings-low-quota-${width}-top.png`) });
        await page.locator(width < 640 ? '.settings-layout' : '.settings-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
        await page.screenshot({ path: testInfo.outputPath(`settings-low-quota-${width}-bottom.png`) });
    }
});

test('pending save resolves while another category is selected and retains saved draft/status', async ({ page }) => {
    await page.getByRole('tab', { name: '低额度换号', exact: true }).click();
    const reserve = page.getByLabel('剩余额度达到此比例时准备换号（%）', { exact: true });
    await reserve.fill('14');
    await page.getByLabel('监测模型', { exact: true }).selectOption('gemini-test');
    await page.getByLabel('backup@example.invalid', { exact: true }).check();
    await page.evaluate(() => { (window as any).__settingsFixture.holdAutoSave = true; });
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(reserve).toBeDisabled();
    await page.getByRole('tab', { name: '外观与语言', exact: true }).click();
    await page.evaluate(() => (window as any).__settingsFixture.resolveAutoSave());
    await page.getByRole('tab', { name: '低额度换号', exact: true }).click();
    await expect(reserve).toBeEnabled(); await expect(reserve).toHaveValue('14');
    await expect(page.getByLabel('backup@example.invalid', { exact: true })).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__settingsFixture.lowQuota())).toMatchObject({ reserve_percentage: 14, monitored_model: 'gemini-test', candidate_account_ids: ['fixture-1'], enabled: false });
});

for (const failure of ['general', 'low-quota']) {
    test(`${failure} loading failure is scoped and retry recovers`, { annotation: { type: 'fixture-failure', description: failure } }, async ({ page }) => {
        if (failure === 'general') {
            const alert = page.getByRole('alert').filter({ hasText: 'synthetic load rejection' });
            await expect(alert).toBeVisible();
            await expect(page.getByRole('button', { name: '浅色', exact: true })).toBeDisabled();
            await page.getByRole('tab', { name: '低额度换号', exact: true }).click();
            await expect(page.getByLabel('监测模型', { exact: true })).toBeEnabled();
            await page.evaluate(() => { (window as any).__settingsFixture.failLoad = false; });
            await alert.getByRole('button', { name: '重新读取', exact: true }).click();
            await expect(alert).toHaveCount(0);
            await page.getByRole('tab', { name: '外观与语言', exact: true }).click();
            await expect(page.getByRole('button', { name: '浅色', exact: true })).toBeEnabled();
        } else {
            await expect(page.getByRole('button', { name: '浅色', exact: true })).toBeEnabled();
            await expect(page.getByRole('alert')).toHaveCount(0);
            await page.getByRole('tab', { name: '低额度换号', exact: true }).click();
            const alert = page.getByRole('alert').filter({ hasText: '无法读取设置或账号，请重试。' });
            await expect(alert).toBeVisible();
            await page.evaluate(() => { (window as any).__settingsFixture.failLowQuotaLoad = false; });
            await page.getByRole('tabpanel').getByRole('button', { name: '重新读取', exact: true }).click();
            await expect(alert).toHaveCount(0);
            await expect(page.getByLabel('监测模型', { exact: true })).toBeEnabled();
        }
    });
}

test('narrow keyboard wraps and Tab enters only the selected mounted panel', async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 600 });
    const tabs = page.getByRole('tab');
    await expect(page.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal');
    await tabs.first().focus();
    for (const [key, index] of [['ArrowLeft', 5], ['ArrowRight', 0], ['End', 5], ['Home', 0], ['ArrowRight', 1]] as const) {
        await page.keyboard.press(key); await expect(tabs.nth(index)).toBeFocused(); await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true');
    }
    await page.keyboard.press('Tab'); await expect(page.getByRole('tabpanel')).toBeFocused();
    for (let i = 0; i < 14; i++) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement?.closest('[role="tabpanel"][hidden]') === null)).toBe(true);
    }
    expect(await page.locator('[role="tabpanel"][hidden]').count()).toBe(5);
});

test('startup preferences and saved background preference survive category changes', async ({ page }) => {
    await page.locator('#settings-tab-startup').click();
    const login = page.locator('#desktop-launch_at_login');
    const background = page.locator('#desktop-start_minimized');
    const dock = page.locator('#desktop-hide_dock_icon');
    await expect(background).toBeEnabled(); await expect(background).toHaveAttribute('aria-checked', 'false');
    await login.click(); await expect(login).toHaveAttribute('aria-checked', 'true'); await expect(background).toBeEnabled();
    await dock.click(); await expect(dock).toHaveAttribute('aria-checked', 'true');
    await page.locator('#settings-tab-data').click(); await page.locator('#settings-tab-startup').click();
    await expect(login).toHaveAttribute('aria-checked', 'true'); await expect(dock).toHaveAttribute('aria-checked', 'true');
    await dock.click(); await expect(dock).toHaveAttribute('aria-checked', 'false');
    for (const value of ['true', 'false', 'true']) {
        await expect(background).toBeEnabled(); await background.click(); await expect(background).toHaveAttribute('aria-checked', value);
    }
    // Disabling login does not disable background editing; preferences remain independent.
    await login.click(); await expect(login).toHaveAttribute('aria-checked', 'false');
    await expect(background).toBeEnabled(); await expect(background).toHaveAttribute('aria-checked', 'true');
    await page.locator('#settings-tab-data').click(); await page.locator('#settings-tab-startup').click();
    await expect(background).toBeEnabled(); await expect(background).toHaveAttribute('aria-checked', 'true');
    const config = await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('load_config'));
    expect(config.desktop).toEqual({ launch_at_login: false, hide_dock_icon: false, start_minimized: true });
    const writes = await page.evaluate(() => (window as any).__settingsFixture.calls.filter((c: any) => c.command === 'set_desktop_preferences'));
    expect(writes.map((c: any) => c.args)).toEqual([
        { patch: { launch_at_login: true } }, { patch: { hide_dock_icon: true } }, { patch: { hide_dock_icon: false } },
        { patch: { start_minimized: true } }, { patch: { start_minimized: false } }, { patch: { start_minimized: true } }, { patch: { launch_at_login: false } },
    ]);
});

test('all categories fit narrow English and Chinese short windows and their bottoms are reachable', async ({ page }, testInfo) => {
    const ids = ['appearance', 'startup', 'sync', 'lowQuota', 'data', 'experimental'];
    for (const language of ['zh', 'en']) {
        await page.locator('#settings-tab-appearance').click();
        await page.getByRole('button', { name: language === 'en' ? 'English' : '简体中文', exact: true }).click();
        await expect(page.locator('#settings-tab-appearance')).toHaveText(language === 'en' ? 'Appearance & language' : '外观与语言');
        for (const width of [760, 420]) {
            await page.setViewportSize({ width, height: 520 });
            for (const id of ids) {
                await page.locator(`#settings-tab-${id}`).click();
                const panel = page.locator(`#settings-panel-${id}`);
                await expect(panel).toBeVisible();
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                expect(await panel.locator('input, select, button').evaluateAll(fields => fields.filter(f => (f as HTMLElement).offsetWidth > 2).every(f => { const r = f.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }))).toBe(true);
                await page.screenshot({ path: testInfo.outputPath(`settings-${language}-${width}-${id}-top.png`) });
                const last = panel.locator('button, input, select, p').last();
                await last.scrollIntoViewIfNeeded();
                const bounds = await last.boundingBox(); expect(bounds).not.toBeNull();
                expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(521); expect(bounds!.y + bounds!.height).toBeGreaterThan(0);
                await page.screenshot({ path: testInfo.outputPath(`settings-${language}-${width}-${id}-bottom.png`) });
            }
        }
    }
});

test('switching long categories resets the active scroller but preserves the unsaved draft', async ({ page }) => {
    for (const width of [760, 420]) {
        await page.setViewportSize({ width, height: 520 });
        await page.locator('#settings-tab-lowQuota').click();
        const reserve = page.getByLabel('剩余额度达到此比例时准备换号（%）', { exact: true }); await reserve.fill('16');
        const scroller = page.locator(width < 640 ? '.settings-layout' : '.settings-content');
        await scroller.evaluate(e => { e.scrollTop = e.scrollHeight; });
        expect(await scroller.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
        await page.locator('#settings-tab-data').click();
        await expect.poll(() => scroller.evaluate(e => e.scrollTop)).toBe(0);
        await scroller.evaluate(e => { e.scrollTop = e.scrollHeight; });
        await page.locator('#settings-tab-lowQuota').click();
        await expect.poll(() => scroller.evaluate(e => e.scrollTop)).toBe(0);
        await expect(reserve).toHaveValue('16');
    }
});
