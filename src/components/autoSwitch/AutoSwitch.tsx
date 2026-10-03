import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Account } from '../../types/account';
import { AutoSwitchConfig, AutoSwitchStatus } from '../../types/autoSwitch';
import * as service from '../../services/autoSwitchService';
import { listAccounts, getCurrentAccount, switchAccount } from '../../services/accountService';
import { isTauri } from '../../utils/env';

const PRIMARY_BUTTON = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-500';
const SECONDARY_BUTTON = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';
const FIELD = 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

function useStatus() {
    const [status, setStatus] = useState<AutoSwitchStatus | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        if (!isTauri()) return;
        let live = true; let reading = false;
        const read = async () => {
            if (reading) return; reading = true;
            try { const s = await service.getAutoSwitchStatus(); if (live) { setStatus(s); setError(''); } }
            catch { if (live) setError('status_failed'); }
            finally { reading = false; }
        };
        void read(); const timer = setInterval(read, 3000);
        return () => { live = false; clearInterval(timer); };
    }, []);
    return { status, setStatus, error };
}

function StatusBody({ status, compact = false }: { status: AutoSwitchStatus; compact?: boolean }) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false); const [error, setError] = useState('');
    const [guide, setGuide] = useState(false); const close = useRef<HTMLButtonElement>(null);
    const guideTrigger = useRef<HTMLButtonElement>(null);
    useEffect(() => { if (guide) close.current?.focus(); }, [guide]);
    const dismiss = () => { setGuide(false); requestAnimationFrame(() => guideTrigger.current?.focus()); };
    const reason = status.reason || (status.phase === 'monitoring' ? 'monitoring' : 'checking');
    const action = async (cancel: boolean) => {
        setBusy(true); setError('');
        try { if (cancel && status.pending_id) await service.cancelAutoSwitch(status.pending_id); else await service.checkAutoSwitchNow(); }
        catch { setError(t('auto_switch.action_failed')); }
        finally { setBusy(false); }
    };
    return <div className={compact ? 'px-4 py-3' : 'rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60'}>
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100" role="status">
                    {status.remaining_percentage !== null && ['pending', 'switching'].includes(status.phase)
                        ? t('auto_switch.remaining', { percent: Math.floor(status.remaining_percentage) }) + ' · ' : ''}
                    {t(`auto_switch.reasons.${reason}`, { defaultValue: t('auto_switch.reasons.switch_failed') })}
                </p>
                {status.target_email && <p className="break-all text-xs text-slate-500 dark:text-slate-400">{t('auto_switch.next_account', { email: status.target_email })}</p>}
                {status.reason === 'clients_running' && <p className="max-w-3xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t(`auto_switch.${status.mode}_instructions`)}</p>}
                {status.phase === 'completed' && <p className="text-xs text-slate-500 dark:text-slate-400">{t('auto_switch.manual_continue')}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
                {status.target_account_id && status.reason === 'clients_running' && (
                    <button
                        disabled={busy || status.phase === 'switching'}
                        onClick={async () => {
                            setBusy(true);
                            setError('');
                            try {
                                await switchAccount(status.target_account_id!);
                            } catch (e) {
                                setError(String(e));
                            } finally {
                                setBusy(false);
                            }
                        }}
                        className={PRIMARY_BUTTON}
                    >
                        <ArrowLeftRight size={14} />
                        {t('auto_switch.switch_now_restart')}
                    </button>
                )}
                {status.mode === 'stop' && status.reason === 'clients_running' && <button ref={guideTrigger} onClick={() => setGuide(true)} className={SECONDARY_BUTTON}>{t('auto_switch.stop_guide')}</button>}
                {status.pending_id && <button disabled={busy || status.phase === 'switching'} onClick={() => action(true)} className={SECONDARY_BUTTON}>{t('auto_switch.cancel')}</button>}
                <button disabled={busy || status.phase === 'switching'} onClick={() => action(false)} className={SECONDARY_BUTTON}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />{t('auto_switch.check_now')}</button>
            </div>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
        {guide && <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4" onClick={dismiss}>
            <section role="dialog" aria-modal="true" aria-labelledby="auto-switch-guide-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={e => e.stopPropagation()} onKeyDown={e => {
                if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
                // This dialog has one action; keep keyboard focus inside it.
                if (e.key === 'Tab') { e.preventDefault(); close.current?.focus(); }
            }}>
                <h3 id="auto-switch-guide-title" className="font-semibold">{t('auto_switch.stop_guide')}</h3>
                <ol className="my-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    <li>{t('auto_switch.stop_step_1')}</li><li>{t('auto_switch.stop_step_2')}</li><li>{t('auto_switch.stop_step_3')}</li>
                </ol>
                <p className="mb-4 text-xs text-amber-700 dark:text-amber-300">{t('auto_switch.stop_warning')}</p>
                <button ref={close} onClick={dismiss} className={`${PRIMARY_BUTTON} w-full`}>{t('auto_switch.understood')}</button>
            </section>
        </div>}
    </div>;
}

export function AutoSwitchStatusBar() {
    const { t } = useTranslation(); const { status, error } = useStatus();
    if (!status || ['disabled', 'monitoring'].includes(status.phase)) return null;
    return <aside aria-label={t('auto_switch.title')} className="shrink-0 border-b border-amber-200 bg-amber-50/80 dark:border-amber-800/60 dark:bg-amber-950/20">
        {error ? <p className="px-4 py-3 text-sm" role="alert">{t(`auto_switch.${error}`)}</p> : <StatusBody status={status} compact />}
    </aside>;
}

export function AutoSwitchSettings() {
    const { t } = useTranslation(); const { status, error: statusError } = useStatus();
    const [draft, setDraft] = useState<AutoSwitchConfig | null>(null);
    const [accounts, setAccounts] = useState<Account[]>([]); const [currentId, setCurrentId] = useState<string | null>(null);
    const [error, setError] = useState(''); const [saved, setSaved] = useState(false); const [busy, setBusy] = useState(false);
    const reload = async () => {
        setBusy(true); setError('');
        try { const [c, a, current] = await Promise.all([service.getAutoSwitchConfig(), listAccounts(), getCurrentAccount()]); setDraft(c); setAccounts(a); setCurrentId(current?.id || null); }
        catch { setError(t('auto_switch.load_failed')); } finally { setBusy(false); }
    };
    useEffect(() => { void reload(); }, []);
    const patch = (p: Partial<AutoSwitchConfig>) => { setDraft(d => d && ({ ...d, ...p })); setSaved(false); };
    const save = async () => {
        if (!draft) return; setBusy(true); setError(''); setSaved(false);
        try { setDraft(await service.setAutoSwitchConfig({ ...draft, candidate_account_ids: accounts.map(a => a.id).filter(id => draft.candidate_account_ids.includes(id)) })); setSaved(true); }
        catch (e) { setError(t('auto_switch.save_failed', { error: String(e) })); }
        finally { setBusy(false); }
    };
    const models = [...new Map(accounts.flatMap(a => a.quota?.models || []).map(m => [m.name, m.display_name || m.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const invalid = !draft || draft.reserve_percentage < 1 || draft.reserve_percentage > 98 || draft.candidate_min_percentage <= draft.reserve_percentage || draft.candidate_min_percentage > 100 || !Number.isInteger(draft.reserve_percentage) || !Number.isInteger(draft.candidate_min_percentage) || (draft.enabled && (!draft.monitored_model || !draft.candidate_account_ids.length));
    return <section className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start gap-3"><span className="rounded-xl bg-amber-50 p-2.5 text-amber-600 dark:bg-amber-400/10"><ArrowLeftRight size={20} /></span><div><h2 className="font-semibold">{t('auto_switch.title')}</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('auto_switch.description')}</p></div></div>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        {!draft ? <button disabled={busy} onClick={reload} className={`${SECONDARY_BUTTON} mt-4`}>{t(busy ? 'auto_switch.loading' : 'auto_switch.retry')}</button> : <>
            <label className="my-5 flex cursor-pointer items-center gap-3 text-sm font-medium"><input type="checkbox" className="peer sr-only" checked={draft.enabled} disabled={busy} onChange={e => patch({ enabled: e.target.checked })} /><span aria-hidden="true" className="relative inline-block h-6 w-11 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 dark:bg-slate-600" />{t('auto_switch.enable')}</label>
            <div className="grid gap-3 md:grid-cols-2" role="group" aria-label={t('auto_switch.mode')}>
                {(['wait', 'stop'] as const).map(mode => <label key={mode} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${draft.mode === mode ? 'border-blue-400 bg-blue-50/60 dark:bg-blue-500/10' : 'border-slate-200 dark:border-slate-700'}`}>
                    <input type="radio" name="auto-switch-mode" checked={draft.mode === mode} disabled={busy} onChange={() => patch({ mode })} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" />
                    <span><span className="block text-sm font-medium">{t(`auto_switch.mode_${mode}`)}</span><span className="mt-1 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t(`auto_switch.${mode}_instructions`)}</span></span>
                </label>)}
            </div>
            <div className="my-4">
                <span className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('auto_switch.strategy_title')}</span>
                <div className="grid gap-3 md:grid-cols-2" role="group" aria-label={t('auto_switch.strategy_title')}>
                    {(['round_robin', 'priority'] as const).map(strategy => (
                        <label key={strategy} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${draft.strategy === strategy || (!draft.strategy && strategy === 'round_robin') ? 'border-blue-400 bg-blue-50/60 dark:bg-blue-500/10' : 'border-slate-200 dark:border-slate-700'}`}>
                            <input type="radio" name="auto-switch-strategy" checked={draft.strategy === strategy || (!draft.strategy && strategy === 'round_robin')} disabled={busy} onChange={() => patch({ strategy })} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" />
                            <span>
                                <span className="block text-sm font-medium">{t(`auto_switch.strategy_${strategy}`)}</span>
                                <span className="mt-1 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t(`auto_switch.strategy_${strategy}_desc`)}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </div>
            <div className="my-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-2 text-xs text-slate-600 dark:text-slate-300"><span className="block">{t('auto_switch.target')}</span><select aria-label={t('auto_switch.target')} className={FIELD} disabled={busy} value={draft.target} onChange={e => patch({ target: e.target.value as 'app' })}><option value="app">Antigravity APP + agy</option></select></label>
                <label className="space-y-2 text-xs text-slate-600 dark:text-slate-300"><span className="block">{t('auto_switch.model')}</span><select aria-label={t('auto_switch.model')} className={FIELD} disabled={busy} value={draft.monitored_model} onChange={e => patch({ monitored_model: e.target.value })}><option value="">{t('auto_switch.select_model')}</option>{draft.monitored_model && !models.some(([id]) => id === draft.monitored_model) && <option value={draft.monitored_model}>{draft.monitored_model}</option>}{models.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                <label className="space-y-2 text-xs text-slate-600 dark:text-slate-300"><span className="block">{t('auto_switch.reserve')}</span><input aria-label={t('auto_switch.reserve')} className={FIELD} type="number" min={1} max={98} step={1} disabled={busy} value={draft.reserve_percentage} onChange={e => patch({ reserve_percentage: Number(e.target.value) })} /></label>
                <label className="space-y-2 text-xs text-slate-600 dark:text-slate-300"><span className="block">{t('auto_switch.candidate_min')}</span><input aria-label={t('auto_switch.candidate_min')} className={FIELD} type="number" min={draft.reserve_percentage + 1} max={100} step={1} disabled={busy} value={draft.candidate_min_percentage} onChange={e => patch({ candidate_min_percentage: Number(e.target.value) })} /></label>
            </div>
            <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">{t('auto_switch.accounts')}</legend><p className="mb-3 text-xs text-slate-500">{t('auto_switch.accounts_hint')}</p>
                {!accounts.length && <p className="text-xs text-amber-700">{t('auto_switch.no_accounts')}</p>}
                <div className="grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2">{accounts.map(a => <label key={a.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded accent-blue-600" disabled={busy} checked={draft.candidate_account_ids.includes(a.id)} onChange={e => patch({ candidate_account_ids: e.target.checked ? [...draft.candidate_account_ids, a.id] : draft.candidate_account_ids.filter(id => id !== a.id) })} /><span className="min-w-0 break-all">{a.email}{a.id === currentId && <span className="ml-2 text-xs text-blue-500">{t('auto_switch.current')}</span>}</span></label>)}</div>
            </fieldset>
            <p className="mt-4 text-xs leading-relaxed text-amber-700 dark:text-amber-300">{t('auto_switch.safety_note')}</p>
            <div className="my-4 flex items-center gap-3"><button className={PRIMARY_BUTTON} disabled={busy || invalid} onClick={save}>{t(busy ? 'auto_switch.saving' : 'auto_switch.save')}</button>{saved && <span role="status" className="text-xs text-emerald-600">{t('auto_switch.saved')}</span>}</div>
            {statusError && <p role="alert" className="text-xs text-red-600">{t(`auto_switch.${statusError}`)}</p>}
            {status && status.phase !== 'disabled' && <StatusBody status={status} />}
        </>}
    </section>;
}
