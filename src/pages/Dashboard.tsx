import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Cpu, Database, MessageSquare, RefreshCw, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { request as invoke } from '../utils/request';
import { showToast } from '../components/common/ToastContainer';

interface LocalTokenTotals {
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
    total_tokens: number;
    request_count: number;
}

interface LocalTokenDaily extends LocalTokenTotals {
    date: string;
}

interface LocalTokenModel extends LocalTokenTotals {
    model: string;
}

interface LocalTokenUsageSummary {
    today: LocalTokenTotals;
    last_7_days: LocalTokenTotals;
    last_30_days: LocalTokenTotals;
    daily: LocalTokenDaily[];
    by_model: LocalTokenModel[];
    databases_scanned: number;
    generations_scanned: number;
    skipped_large_records: number;
    unreadable_databases: number;
    last_activity?: number;
    generated_at: number;
}

type RangeKey = 'today' | '7d' | '30d';

const formatTokens = (value: number) => value.toLocaleString('zh-CN');

const compactTokens = (value: number) => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toLocaleString('zh-CN');
};

const dateKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const shortDate = (key: string) => {
    const [, month, day] = key.split('-');
    return `${Number(month)}/${Number(day)}`;
};

function TokenCard({
    label,
    value,
    color,
    icon: Icon,
}: {
    label: string;
    value: number;
    color: string;
    icon: typeof Cpu;
}) {
    return (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-base-200 dark:bg-base-100">
            <div className="mb-3 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <span className={`rounded-lg p-2 ${color}`}>
                    <Icon className="h-4 w-4" />
                </span>
                {label}
            </div>
            <div className="text-2xl font-bold tracking-tight text-gray-900 dark:text-base-content" title={formatTokens(value)}>
                {compactTokens(value)}
            </div>
            <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {formatTokens(value)} Token
            </div>
        </div>
    );
}

function Dashboard() {
    const navigate = useNavigate();
    const [usage, setUsage] = useState<LocalTokenUsageSummary | null>(null);
    const [range, setRange] = useState<RangeKey>('today');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchUsage = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await invoke<LocalTokenUsageSummary>('get_local_token_usage');
            setUsage(result);
        } catch (fetchError) {
            const message = String(fetchError);
            setError(message);
            showToast(`读取本地 Token 统计失败：${message}`, 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsage();
        const interval = window.setInterval(fetchUsage, 60_000);
        return () => window.clearInterval(interval);
    }, [fetchUsage]);

    const totals = useMemo<LocalTokenTotals>(() => {
        if (!usage) {
            return { input_tokens: 0, output_tokens: 0, cached_tokens: 0, total_tokens: 0, request_count: 0 };
        }
        if (range === '7d') return usage.last_7_days;
        if (range === '30d') return usage.last_30_days;
        return usage.today;
    }, [range, usage]);

    const chartDays = useMemo(() => {
        const byDate = new Map((usage?.daily || []).map((item) => [item.date, item]));
        const days: LocalTokenDaily[] = [];
        const now = new Date();
        for (let offset = 6; offset >= 0; offset -= 1) {
            const date = new Date(now);
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() - offset);
            days.push(byDate.get(dateKey(date)) || {
                date: dateKey(date),
                input_tokens: 0,
                output_tokens: 0,
                cached_tokens: 0,
                total_tokens: 0,
                request_count: 0,
            });
        }
        return days;
    }, [usage]);

    const maxDailyTokens = Math.max(...chartDays.map((day) => day.total_tokens), 1);

    const rangeLabels: Record<RangeKey, string> = {
        today: '今天',
        '7d': '近 7 天',
        '30d': '近 30 天',
    };

    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="mx-auto max-w-7xl space-y-5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-base-content">
                            <BarChart3 className="h-6 w-6 text-blue-500" />
                            首页
                        </h1>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            Antigravity 本地 Token 用量
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => navigate('/accounts')}
                            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-base-200 dark:bg-base-100 dark:text-gray-300"
                        >
                            <Users className="h-4 w-4" />
                            账号管理
                        </button>
                        <button
                            onClick={fetchUsage}
                            disabled={loading}
                            className="flex items-center gap-2 rounded-xl bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                            刷新
                        </button>
                    </div>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm dark:border-base-200 dark:bg-base-100">
                    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                        <CalendarDays className="h-4 w-4" />
                        统计范围
                    </div>
                    <div className="flex rounded-xl bg-gray-100 p-1 dark:bg-base-200">
                        {(Object.keys(rangeLabels) as RangeKey[]).map((key) => (
                            <button
                                key={key}
                                onClick={() => setRange(key)}
                                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${range === key
                                    ? 'bg-white text-blue-600 shadow-sm dark:bg-base-100 dark:text-blue-400'
                                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                                    }`}
                            >
                                {rangeLabels[key]}
                            </button>
                        ))}
                    </div>
                </div>

                {error && (
                    <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-300">
                        {error}
                    </div>
                )}

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                    <TokenCard label={`${rangeLabels[range]}总 Token`} value={totals.total_tokens} color="bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300" icon={BarChart3} />
                    <TokenCard label="输入 Token" value={totals.input_tokens} color="bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-300" icon={MessageSquare} />
                    <TokenCard label="输出 Token" value={totals.output_tokens} color="bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-300" icon={Cpu} />
                    <TokenCard label="缓存 Token" value={totals.cached_tokens} color="bg-cyan-50 text-cyan-600 dark:bg-cyan-900/20 dark:text-cyan-300" icon={Database} />
                    <TokenCard label="请求次数" value={totals.request_count} color="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300" icon={MessageSquare} />
                </div>

                <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
                    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-base-200 dark:bg-base-100">
                        <div className="mb-5 flex items-center justify-between">
                            <div>
                                <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-base-content">
                                    <BarChart3 className="h-5 w-5 text-blue-500" />
                                    最近 7 天
                                </h2>
                                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">按本地生成记录统计</p>
                            </div>
                            <span className="text-xs text-gray-400 dark:text-gray-500">Token</span>
                        </div>
                        <div className="flex h-48 items-end gap-2 border-b border-gray-100 pb-2 dark:border-base-200">
                            {chartDays.map((day) => {
                                const height = day.total_tokens === 0 ? 4 : Math.max((day.total_tokens / maxDailyTokens) * 100, 8);
                                return (
                                    <div key={day.date} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
                                        <div className="relative flex w-full flex-1 items-end justify-center">
                                            <div
                                                className="w-full max-w-10 rounded-t-lg bg-gradient-to-t from-blue-500 to-cyan-400 transition-all group-hover:from-blue-600 group-hover:to-cyan-500"
                                                style={{ height: `${height}%` }}
                                                title={`${day.date}: ${formatTokens(day.total_tokens)} Token`}
                                            />
                                        </div>
                                        <span className="text-[10px] text-gray-400 dark:text-gray-500">{shortDate(day.date)}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-base-200 dark:bg-base-100">
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-base-content">
                                    <Cpu className="h-5 w-5 text-purple-500" />
                                    模型用量
                                </h2>
                                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">近 30 天本地记录</p>
                            </div>
                        </div>
                        <div className="max-h-48 space-y-3 overflow-y-auto pr-1">
                            {(usage?.by_model || []).slice(0, 8).map((model) => {
                                const width = usage?.last_30_days.total_tokens
                                    ? Math.max((model.total_tokens / usage.last_30_days.total_tokens) * 100, 2)
                                    : 0;
                                return (
                                    <div key={model.model}>
                                        <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                                            <span className="truncate text-gray-600 dark:text-gray-300" title={model.model}>{model.model}</span>
                                            <span className="shrink-0 font-mono text-gray-500 dark:text-gray-400">{compactTokens(model.total_tokens)}</span>
                                        </div>
                                        <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-base-200">
                                            <div className="h-full rounded-full bg-purple-400" style={{ width: `${width}%` }} />
                                        </div>
                                    </div>
                                );
                            })}
                            {!loading && !(usage?.by_model || []).length && (
                                <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">暂时没有可识别的模型用量</div>
                            )}
                        </div>
                    </section>
                </div>

                <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-base-200 dark:bg-base-100">
                    <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-base-200">
                        <div>
                            <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-base-content">
                                <Cpu className="h-5 w-5 text-blue-500" />
                                模型明细
                            </h2>
                            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">输入、输出、缓存和请求次数</p>
                        </div>
                        <span className="text-xs text-gray-400 dark:text-gray-500">{usage?.by_model.length || 0} 个模型</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[620px] text-left text-sm">
                            <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-base-200/60 dark:text-gray-400">
                                <tr>
                                    <th className="px-5 py-3 font-medium">模型</th>
                                    <th className="px-5 py-3 text-right font-medium">总 Token</th>
                                    <th className="px-5 py-3 text-right font-medium">输入</th>
                                    <th className="px-5 py-3 text-right font-medium">输出</th>
                                    <th className="px-5 py-3 text-right font-medium">请求</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-base-200">
                                {(usage?.by_model || []).map((model) => (
                                    <tr key={model.model} className="text-gray-700 dark:text-gray-300">
                                        <td className="max-w-[320px] truncate px-5 py-3 font-medium" title={model.model}>{model.model}</td>
                                        <td className="px-5 py-3 text-right font-mono">{formatTokens(model.total_tokens)}</td>
                                        <td className="px-5 py-3 text-right font-mono text-indigo-500">{formatTokens(model.input_tokens)}</td>
                                        <td className="px-5 py-3 text-right font-mono text-purple-500">{formatTokens(model.output_tokens)}</td>
                                        <td className="px-5 py-3 text-right font-mono">{formatTokens(model.request_count)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!loading && !(usage?.by_model || []).length && (
                            <div className="px-5 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                                使用 Antigravity 生成内容后，点击右上角刷新即可看到本地 Token 记录。
                            </div>
                        )}
                    </div>
                </section>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:border-base-200 dark:bg-base-200/50 dark:text-gray-400">
                    <span className="flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        数据源：~/.gemini/antigravity*/conversations（只读）
                    </span>
                    <span>
                        已扫描 {usage?.databases_scanned || 0} 个数据库 · {usage?.generations_scanned || 0} 条生成记录
                        {usage?.unreadable_databases ? ` · ${usage.unreadable_databases} 个数据库读取失败` : ''}
                    </span>
                </div>

                {usage?.last_activity && (
                    <div className="text-right text-xs text-gray-400 dark:text-gray-500">
                        最近活动：{new Date(usage.last_activity * 1000).toLocaleString()}
                    </div>
                )}
            </div>
        </div>
    );
}

export default Dashboard;
