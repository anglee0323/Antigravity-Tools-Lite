import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CalendarDays, Cpu, Database, DollarSign, MessageSquare, RefreshCw, Users } from 'lucide-react';
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

interface LocalTokenHourly extends LocalTokenTotals {
    hour: string;
}

interface LocalTokenModel extends LocalTokenTotals {
    model: string;
}

interface LocalTokenUsageSummary {
    today: LocalTokenTotals;
    last_7_days: LocalTokenTotals;
    last_30_days: LocalTokenTotals;
    daily: LocalTokenDaily[];
    hourly: LocalTokenHourly[];
    by_model_today: LocalTokenModel[];
    by_model_7_days: LocalTokenModel[];
    by_model: LocalTokenModel[];
    databases_scanned: number;
    generations_scanned: number;
    skipped_large_records: number;
    unreadable_databases: number;
    last_activity?: number;
    generated_at: number;
}

interface ModelPricing {
    input: number;
    output: number;
    cached: number;
}

interface ApiPricingEntry extends ModelPricing {
    model: string;
}

interface ApiPricingSnapshot {
    prices: ApiPricingEntry[];
    fetched_at: number;
    stale: boolean;
    source: string;
    warning?: string;
}

type RangeKey = 'today' | '7d' | '30d';

const formatTokens = (value: number) => value.toLocaleString('zh-CN');

const formatUsd = (value: number) => {
    if (value === 0) return '$0.00';
    return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
};

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

const formatTime = (timestamp?: number | null) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

const rangeLabels: Record<RangeKey, string> = {
    today: '今天',
    '7d': '近 7 天',
    '30d': '近 30 天',
};

const rangeDays: Record<RangeKey, number> = {
    today: 1,
    '7d': 7,
    '30d': 30,
};

const chartBarMaxWidth: Record<RangeKey, number> = {
    today: 12,
    '7d': 32,
    '30d': 8,
};

// 离线兜底价格；在线时优先使用 Google 官方价格页同步的结果。
const FALLBACK_MODEL_PRICING: Array<{ pattern: RegExp; pricing: ModelPricing }> = [
    { pattern: /claude.*sonnet.*4[.\-_ ]?6/i, pricing: { input: 3, output: 15, cached: 0.3 } },
    { pattern: /gemini.*3[.\-_ ]?1.*flash.*image/i, pricing: { input: 0.5, output: 60, cached: 0 } },
    { pattern: /gemini.*3[.\-_ ]?8.*flash/i, pricing: { input: 0.75, output: 3.75, cached: 0.075 } },
    { pattern: /gemini.*3[.\-_ ]?1.*pro/i, pricing: { input: 2, output: 12, cached: 0.2 } },
    { pattern: /gemini.*3[.\-_ ]?5.*flash/i, pricing: { input: 1.5, output: 9, cached: 0.15 } },
    { pattern: /gemini.*3.*flash/i, pricing: { input: 0.5, output: 3, cached: 0.05 } },
    { pattern: /gemini.*2[.\-_ ]?5.*pro/i, pricing: { input: 1.25, output: 10, cached: 0.125 } },
    { pattern: /gemini.*2[.\-_ ]?5.*flash.*lite/i, pricing: { input: 0.1, output: 0.4, cached: 0.01 } },
    { pattern: /gemini.*2[.\-_ ]?5.*flash/i, pricing: { input: 0.3, output: 2.5, cached: 0.03 } },
];

type TokenChartPoint = LocalTokenTotals & {
    key: string;
    label: string;
};

const emptyTokenTotals = (): LocalTokenTotals => ({
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    total_tokens: 0,
    request_count: 0,
});

const normalizeModelName = (model: string) => model.toLowerCase().replace(/[^a-z0-9]/g, '');

const findModelPricing = (model: string, snapshot: ApiPricingSnapshot | null) => {
    const normalizedModel = normalizeModelName(model);
    const remotePricing = snapshot?.prices.find((entry) => {
        const normalizedEntry = normalizeModelName(entry.model);
        return normalizedModel.includes(normalizedEntry) || normalizedEntry.includes(normalizedModel);
    });
    if (remotePricing) return remotePricing;
    return FALLBACK_MODEL_PRICING.find(({ pattern }) => pattern.test(model))?.pricing;
};

const estimateApiCost = (models: LocalTokenModel[], snapshot: ApiPricingSnapshot | null) => {
    return models.reduce(
        (result, model) => {
            const pricing = findModelPricing(model.model, snapshot);
            if (!pricing) {
                result.unpricedModels += 1;
                return result;
            }
            result.usd += (
                model.input_tokens * pricing.input
                + model.output_tokens * pricing.output
                + model.cached_tokens * pricing.cached
            ) / 1_000_000;
            return result;
        },
        { usd: 0, unpricedModels: 0 },
    );
};

function TokenCard({
    label,
    value,
    color,
    icon: Icon,
    displayValue,
    detail,
}: {
    label: string;
    value: number;
    color: string;
    icon: typeof Cpu;
    displayValue?: string;
    detail?: string;
}) {
    return (
        <div className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm dark:border-base-200 dark:bg-base-100">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <span className={`rounded-lg p-1.5 ${color}`}>
                    <Icon className="h-3.5 w-3.5" />
                </span>
                {label}
            </div>
            <div className="text-xl font-bold tracking-tight text-gray-900 dark:text-base-content" title={displayValue || formatTokens(value)}>
                {displayValue || compactTokens(value)}
            </div>
            <div className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                {detail || `${formatTokens(value)} Token`}
            </div>
        </div>
    );
}

function Dashboard() {
    const navigate = useNavigate();
    const [usage, setUsage] = useState<LocalTokenUsageSummary | null>(null);
    const [pricing, setPricing] = useState<ApiPricingSnapshot | null>(null);
    const [range, setRange] = useState<RangeKey>('today');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hoveredPoint, setHoveredPoint] = useState<TokenChartPoint | null>(null);
    const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
    const fetchInFlight = useRef(false);

    const fetchUsage = useCallback(async (notify = false) => {
        if (fetchInFlight.current) return;
        fetchInFlight.current = true;
        setLoading(true);
        setError(null);
        try {
            const result = await invoke<LocalTokenUsageSummary>('get_local_token_usage');
            setUsage(result);
            setLastUpdatedAt(Date.now());
            if (notify) {
                const dataTime = result.last_activity ? `，数据截至 ${formatTime(result.last_activity * 1000)}` : '';
                showToast(`本地 Token 统计已更新${dataTime}`, 'success');
            }
        } catch (fetchError) {
            const message = String(fetchError);
            setError(message);
            showToast(`读取本地 Token 统计失败：${message}`, 'error');
        } finally {
            fetchInFlight.current = false;
            setLoading(false);
        }
    }, []);

    const fetchPricing = useCallback(async () => {
        try {
            const result = await invoke<ApiPricingSnapshot>('get_api_pricing');
            setPricing(result);
        } catch (fetchError) {
            console.warn('读取 Google 官方 API 价格失败，使用内置兜底价格：', fetchError);
            setPricing(null);
        }
    }, []);

    useEffect(() => {
        fetchUsage();
        fetchPricing();
        const usageInterval = window.setInterval(fetchUsage, 60_000);
        const pricingInterval = window.setInterval(fetchPricing, 24 * 60 * 60 * 1000);
        return () => {
            window.clearInterval(usageInterval);
            window.clearInterval(pricingInterval);
        };
    }, [fetchPricing, fetchUsage]);

    const totals = useMemo<LocalTokenTotals>(() => {
        if (!usage) {
            return { input_tokens: 0, output_tokens: 0, cached_tokens: 0, total_tokens: 0, request_count: 0 };
        }
        if (range === '7d') return usage.last_7_days;
        if (range === '30d') return usage.last_30_days;
        return usage.today;
    }, [range, usage]);

    useEffect(() => {
        setHoveredPoint(null);
    }, [range]);

    const chartPoints = useMemo<TokenChartPoint[]>(() => {
        const now = new Date();
        if (range === 'today') {
            const today = dateKey(now);
            const byHour = new Map((usage?.hourly || []).map((item) => [item.hour, item]));
            return Array.from({ length: 24 }, (_, hour) => {
                const label = `${String(hour).padStart(2, '0')}:00`;
                const key = `${today} ${label}`;
                const item = byHour.get(key);
                return {
                    ...(item || emptyTokenTotals()),
                    key,
                    label,
                };
            });
        }

        const byDate = new Map((usage?.daily || []).map((item) => [item.date, item]));
        const days: TokenChartPoint[] = [];
        for (let offset = rangeDays[range] - 1; offset >= 0; offset -= 1) {
            const date = new Date(now);
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() - offset);
            const key = dateKey(date);
            const item = byDate.get(key);
            days.push({
                ...(item || emptyTokenTotals()),
                key,
                label: shortDate(key),
            });
        }
        return days;
    }, [range, usage]);

    const maxChartTokens = Math.max(...chartPoints.map((point) => point.total_tokens), 1);

    const modelsForRange = useMemo(() => {
        if (!usage) return [];
        if (range === 'today') return usage.by_model_today;
        if (range === '7d') return usage.by_model_7_days;
        return usage.by_model;
    }, [range, usage]);

    const cacheHitRate = useMemo(() => {
        const denominator = totals.input_tokens + totals.cached_tokens;
        return denominator > 0 ? (totals.cached_tokens / denominator) * 100 : 0;
    }, [totals]);

    const apiCost = useMemo(() => estimateApiCost(modelsForRange, pricing), [modelsForRange, pricing]);
    const pricingLabel = pricing
        ? pricing.stale
            ? '使用本地价格缓存'
            : '已同步 Google 官方价格'
        : '内置价格兜底';

    return (
        <div className="h-full w-full overflow-y-auto lg:overflow-hidden">
            <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-2 p-3 lg:h-full lg:min-h-0 lg:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-base-content">
                            <BarChart3 className="h-5 w-5 text-blue-500" />
                            首页
                        </h1>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                            Antigravity 本地 Token 用量
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="text-[10px] text-gray-400 dark:text-gray-500" aria-live="polite">
                            {loading
                                ? '正在扫描本地记录…'
                                : lastUpdatedAt
                                    ? `已扫描 ${formatTime(lastUpdatedAt)}${usage?.last_activity ? ` · 数据截至 ${formatTime(usage.last_activity * 1000)}` : ''}`
                                    : '等待扫描'}
                        </span>
                        <div className="flex items-center gap-1 rounded-xl border border-gray-100 bg-white p-1 shadow-sm dark:border-base-200 dark:bg-base-100">
                            <div className="flex items-center gap-1 px-1 text-[11px] text-gray-500 dark:text-gray-400">
                                <CalendarDays className="h-3.5 w-3.5" />
                                <span>统计范围</span>
                            </div>
                            {(Object.keys(rangeLabels) as RangeKey[]).map((key) => (
                                <button
                                    key={key}
                                    onClick={() => setRange(key)}
                                    className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${range === key
                                        ? 'bg-blue-50 text-blue-600 shadow-sm dark:bg-blue-900/20 dark:text-blue-400'
                                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                                        }`}
                                >
                                    {rangeLabels[key]}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => navigate('/accounts')}
                            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-base-200 dark:bg-base-100 dark:text-gray-300"
                        >
                            <Users className="h-3.5 w-3.5" />
                            账号管理
                        </button>
                        <button
                            onClick={() => fetchUsage(true)}
                            disabled={loading}
                            className="flex items-center gap-1.5 rounded-xl bg-blue-500 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                            {loading ? '刷新中…' : '刷新'}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-300">
                        {error}
                    </div>
                )}

                {!!usage?.unreadable_databases && (
                    <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-300">
                        有 {usage.unreadable_databases} 个本地对话数据库暂时无法读取，本次统计可能不完整；稍后再刷新即可重试。
                    </div>
                )}

                <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                    <TokenCard label={`${rangeLabels[range]}总 Token`} value={totals.total_tokens} color="bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300" icon={BarChart3} />
                    <TokenCard label="输入 Token" value={totals.input_tokens} color="bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-300" icon={MessageSquare} />
                    <TokenCard label="输出 Token" value={totals.output_tokens} color="bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-300" icon={Cpu} />
                    <TokenCard
                        label="缓存命中率"
                        value={cacheHitRate}
                        displayValue={`${cacheHitRate.toFixed(1)}%`}
                        detail="缓存 Token /（输入 + 缓存）"
                        color="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300"
                        icon={Database}
                    />
                    <TokenCard
                        label="API 费用估算"
                        value={apiCost.usd}
                        displayValue={formatUsd(apiCost.usd)}
                        detail={`${formatTokens(totals.request_count)} 次 API 请求 · ${pricingLabel}${apiCost.unpricedModels ? ' · 部分模型未计价' : ''}`}
                        color="bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300"
                        icon={DollarSign}
                    />
                </div>

                <div className="grid shrink-0 gap-2 lg:h-[176px] lg:grid-cols-[1.35fr_1fr]">
                    <section className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm dark:border-base-200 dark:bg-base-100 lg:flex lg:min-h-0 lg:flex-col">
                        <div className="mb-1.5 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-base-content">
                                    <BarChart3 className="h-4 w-4 text-blue-500" />
                                    {rangeLabels[range]}
                                </h2>
                                <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">按本地生成记录统计</p>
                            </div>
                            <div className="pointer-events-none h-14 w-full shrink-0 overflow-hidden text-right sm:w-[230px]" aria-live="polite">
                                {hoveredPoint ? (
                                    <div className="flex h-full flex-col justify-center">
                                        <div className="text-[10px] font-medium leading-3 text-blue-600 dark:text-blue-400">{hoveredPoint.label}</div>
                                        <div className="whitespace-nowrap text-sm font-bold leading-4 text-gray-900 dark:text-base-content">{formatTokens(hoveredPoint.total_tokens)} Token</div>
                                        <div className="whitespace-nowrap text-[10px] leading-3 text-gray-400 dark:text-gray-500">
                                            输入 {compactTokens(hoveredPoint.input_tokens)} · 输出 {compactTokens(hoveredPoint.output_tokens)}
                                        </div>
                                        <div className="whitespace-nowrap text-[10px] leading-3 text-gray-400 dark:text-gray-500">
                                            缓存 {compactTokens(hoveredPoint.cached_tokens)} · {formatTokens(hoveredPoint.request_count)} 次请求
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex h-full items-center justify-end text-[11px] text-gray-400 dark:text-gray-500">
                                        悬浮查看用量
                                    </div>
                                )}
                            </div>
                        </div>
                        <div
                            className="flex h-24 items-end gap-1 border-b border-gray-100 pb-1 dark:border-base-200 lg:min-h-0 lg:flex-1"
                            onMouseLeave={() => setHoveredPoint(null)}
                        >
                            {chartPoints.map((point, index) => {
                                const isEmpty = point.total_tokens === 0;
                                const height = Math.max((point.total_tokens / maxChartTokens) * 100, 6);
                                const showPointLabel = range === 'today'
                                    ? index % 3 === 0 || index === chartPoints.length - 1
                                    : range !== '30d' || index % 5 === 0 || index === chartPoints.length - 1;
                                return (
                                    <div
                                        key={point.key}
                                        className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                                        onMouseEnter={() => setHoveredPoint(point)}
                                    >
                                        <div className="relative flex w-full min-w-0 flex-1 items-end justify-center">
                                            <div
                                                className={`shrink-0 bg-gradient-to-t from-blue-500 to-cyan-400 transition-[filter,opacity] duration-150 group-hover:brightness-95 ${isEmpty ? 'rounded-none opacity-20' : 'rounded-t-[3px]'} ${hoveredPoint?.key === point.key ? 'brightness-95' : ''}`}
                                                style={{
                                                    width: '70%',
                                                    maxWidth: `${chartBarMaxWidth[range]}px`,
                                                    height: isEmpty ? '2px' : `${height}%`,
                                                }}
                                                title={`${point.label}: ${formatTokens(point.total_tokens)} Token · 输入 ${formatTokens(point.input_tokens)} · 输出 ${formatTokens(point.output_tokens)} · 缓存 ${formatTokens(point.cached_tokens)} · ${formatTokens(point.request_count)} 次请求`}
                                            />
                                        </div>
                                        <span className="w-full whitespace-nowrap text-center text-[10px] text-gray-400 dark:text-gray-500">{showPointLabel ? point.label : '\u00a0'}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    <section className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm dark:border-base-200 dark:bg-base-100 lg:flex lg:min-h-0 lg:flex-col">
                        <div className="mb-1.5 flex items-center justify-between">
                            <div>
                                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-base-content">
                                    <Cpu className="h-4 w-4 text-purple-500" />
                                    模型用量
                                </h2>
                                <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{rangeLabels[range]}本地记录</p>
                            </div>
                        </div>
                        <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1 lg:min-h-0 lg:flex-1 lg:max-h-none">
                            {modelsForRange.slice(0, 8).map((model) => {
                                const width = totals.total_tokens
                                    ? Math.max((model.total_tokens / totals.total_tokens) * 100, 2)
                                    : 0;
                                return (
                                    <div key={model.model}>
                                        <div className="mb-0.5 flex items-center justify-between gap-3 text-[11px]">
                                            <span className="truncate text-gray-600 dark:text-gray-300" title={model.model}>{model.model}</span>
                                            <span className="shrink-0 font-mono text-gray-500 dark:text-gray-400">{compactTokens(model.total_tokens)}</span>
                                        </div>
                                        <div className="h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-base-200">
                                            <div className="h-full rounded-full bg-purple-400" style={{ width: `${width}%` }} />
                                        </div>
                                    </div>
                                );
                            })}
                            {!loading && !modelsForRange.length && (
                                <div className="py-6 text-center text-xs text-gray-400 dark:text-gray-500">暂时没有可识别的模型用量</div>
                            )}
                        </div>
                    </section>
                </div>

                <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-base-200 dark:bg-base-100 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
                    <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-2 dark:border-base-200">
                        <div>
                            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-base-content">
                                <Cpu className="h-4 w-4 text-blue-500" />
                                模型明细
                            </h2>
                            <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{rangeLabels[range]}输入、输出、缓存和请求次数</p>
                        </div>
                        <span className="text-[11px] text-gray-400 dark:text-gray-500">{modelsForRange.length} 个模型</span>
                    </div>
                    <div className="max-h-[142px] overflow-y-auto lg:min-h-0 lg:flex-1 lg:max-h-none">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[560px] text-left text-xs">
                                <thead className="bg-gray-50 text-[10px] uppercase text-gray-500 dark:bg-base-200/60 dark:text-gray-400">
                                    <tr>
                                        <th className="px-4 py-1.5 font-medium">模型</th>
                                        <th className="px-4 py-1.5 text-right font-medium">总 Token</th>
                                        <th className="px-4 py-1.5 text-right font-medium">输入</th>
                                        <th className="px-4 py-1.5 text-right font-medium">输出</th>
                                        <th className="px-4 py-1.5 text-right font-medium">请求</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-base-200">
                                    {modelsForRange.map((model) => (
                                        <tr key={model.model} className="text-gray-700 dark:text-gray-300">
                                            <td className="max-w-[320px] truncate px-4 py-1.5 font-medium" title={model.model}>{model.model}</td>
                                            <td className="px-4 py-1.5 text-right font-mono">{formatTokens(model.total_tokens)}</td>
                                            <td className="px-4 py-1.5 text-right font-mono text-indigo-500">{formatTokens(model.input_tokens)}</td>
                                            <td className="px-4 py-1.5 text-right font-mono text-purple-500">{formatTokens(model.output_tokens)}</td>
                                            <td className="px-4 py-1.5 text-right font-mono">{formatTokens(model.request_count)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {!loading && !modelsForRange.length && (
                                <div className="px-4 py-8 text-center text-xs text-gray-400 dark:text-gray-500">
                                    使用 Antigravity 生成内容后，点击右上角刷新即可看到本地 Token 记录。
                                </div>
                            )}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}

export default Dashboard;
