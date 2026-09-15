import { useMemo } from 'react';
import { ArrowRightLeft, RefreshCw, Lock, Ban, Diamond, Gem, Circle, Sparkles, Tag, Clock, Bot } from 'lucide-react';
import { Account, ModelQuota } from '../../types/account';
import { cn } from '../../utils/cn';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../../stores/useConfigStore';
import { QuotaItem } from './QuotaItem';
import { MODEL_CONFIG, sortModels, getModelProtectionKey, resolveQuotaModels, ensurePinnedImageSelector } from '../../config/modelConfig';
import { getValidationBlockedStatusLabel } from './accountValidationStatus';
import { getLiveLimitForModel } from '../../utils/liveLimit';

interface AccountCardProps {
    account: Account;
    selected: boolean;
    onSelect: () => void;
    isCurrent: boolean;
    isRefreshing: boolean;
    isSwitching?: boolean;
    onSwitch: (targetIde?: string) => void;
    onRefresh: () => void;
    quotaWindow?: '5h' | 'weekly';
}

// 使用统一的模型配置
const DEFAULT_MODELS = Object.entries(MODEL_CONFIG).map(([id, config]) => ({
    id,
    label: config.label,
    protectedKey: config.protectedKey,
    Icon: config.Icon
}));

function AccountCard({ account, selected, onSelect, isCurrent: propIsCurrent, isRefreshing, isSwitching = false, onSwitch, onRefresh, quotaWindow }: AccountCardProps) {
    const { t } = useTranslation();
    const { config, showAllQuotas } = useConfigStore();
    const isDisabled = Boolean(account.disabled);
    const validationBlockedLabel = getValidationBlockedStatusLabel(account.validation_blocked_reason, t);

    // Use the prop directly from parent component
    const isCurrent = propIsCurrent;

    const displayModels = useMemo(() => {
        // Build map of friendly labels and icons from DEFAULT_MODELS
        const iconMap = new Map(DEFAULT_MODELS.map(m => [m.id, m.Icon]));

        // Get all models from account (source of truth)
        const accountModels = account.quota?.models?.map(m => {
            // 注意：DEFAULT_MODELS 现在应该包含 shortLabel，我们需要确保它被正确映射
            // 但 DEFAULT_MODELS 是从 MODEL_CONFIG 生成的，我们需要确保它包含 shortLabel
            // 这里为了安全，直接从 MODEL_CONFIG 获取
            const fullConfig = MODEL_CONFIG[m.name.toLowerCase()];
            return {
                id: m.name,
                label: m.display_name || fullConfig?.shortLabel || fullConfig?.label || m.name,
                protectedKey: getModelProtectionKey(m.name) ?? fullConfig?.protectedKey ?? m.name,
                Icon: iconMap.get(m.name) || Bot,
                data: m
            };
        }) || [];

        let models: typeof accountModels;

        if (showAllQuotas) {
            models = accountModels;
        } else {
            // Filter for pinned or defaults
            const pinned = config?.pinned_quota_models?.models;
            if (pinned && pinned.length > 0) {
                const selections = resolveQuotaModels(
                    accountModels.map(m => m.data),
                    ensurePinnedImageSelector(pinned),
                );
                models = selections
                    .map(sel => sel.model ? accountModels.find(am => am.data === sel.model) : undefined)
                    .filter((m): m is typeof accountModels[number] => m !== undefined);
                // 也保留无配额数据的 pinned 模型（显示 0%）
                for (const sel of selections) {
                    if (!sel.model) {
                        const selectorConfig = MODEL_CONFIG[sel.selectorId.toLowerCase()];
                        if (selectorConfig) {
                            models = [...models, {
                                id: sel.selectorId,
                                label: selectorConfig.shortLabel || selectorConfig.label,
                                protectedKey: selectorConfig.protectedKey,
                                Icon: selectorConfig.Icon,
                                data: { name: sel.selectorId, percentage: 0 } as ModelQuota,
                            }];
                        }
                    }
                }
            } else {
                // Default fallback: show known default models, plus we show all dynamic pinned models
                // 暂时退化：如果没有 config 就不阻拦了？不，没有 pinned 就显示内置+有 display_name 的。
                models = accountModels.filter(m => DEFAULT_MODELS.some(d => d.id === m.id) || m.data.display_name);
            }
        }

        // 应用排序并过滤过期模型
        return sortModels(models).filter(m => m.id !== 'claude-sonnet-4-6-thinking' && m.id !== 'claude-sonnet-4-5-thinking' && m.id !== 'claude-opus-4-5-thinking');
    }, [config, account, showAllQuotas]);

    // 解析周配额项 (当处于 weekly 视图时)
    const weeklyItems = useMemo(() => {
        if (quotaWindow !== 'weekly') return [];
        return (account.quota?.quota_groups || []).flatMap(group => {
            return group.buckets
                .filter(b => b.window.toLowerCase().includes('week') || b.bucket_id.toLowerCase().includes('week'))
                .map(b => {
                    const shortGroupName = group.display_name
                        .replace(/ models?$/i, '')
                        .replace(/Claude and GPT/i, 'Claude/GPT');
                    const weeklySuffix = t('accounts.quota_window_weekly_short', 'Semanal');
                    return {
                        id: `${group.display_name}-${b.bucket_id}`,
                        label: b.display_name ? `${shortGroupName} (${b.display_name})` : `${shortGroupName} (${weeklySuffix})`,
                        percentage: Math.round((b.remaining_fraction || 0) * 100),
                        resetTime: b.reset_time,
                        Icon: shortGroupName.toLowerCase().includes('claude') ? Sparkles : Bot,
                    };
                });
        });
    }, [quotaWindow, account.quota?.quota_groups]);

    const isModelProtected = (key?: string) => {
        if (!config?.quota_protection?.enabled) return false;
        if (!key) return false;
        return account.protected_models?.includes(key);
    };

    return (
        <div className={cn(
            "flex flex-col p-3 rounded-xl border transition-all hover:shadow-md",
            isCurrent
                ? "bg-blue-50/30 border-blue-200 dark:bg-blue-900/10 dark:border-blue-900/30"
                : "bg-white dark:bg-base-100 border-gray-200 dark:border-base-300",
            (isRefreshing || isDisabled) && "opacity-70"
        )}>

            {/* Header: Checkbox + Email + Badges */}
            <div className="flex-none flex items-start gap-3 mb-2">
                <input
                    type="checkbox"
                    className="mt-1 checkbox checkbox-xs rounded border-2 border-gray-400 dark:border-gray-500 checked:border-blue-600 checked:bg-blue-600 [--chkbg:theme(colors.blue.600)] [--chkfg:white]"
                    checked={selected}
                    onChange={() => onSelect()}
                    onClick={(e) => e.stopPropagation()}
                />
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                    <h3 className={cn(
                        "font-semibold text-sm truncate w-full",
                        isCurrent ? "text-blue-700 dark:text-blue-400" : "text-gray-900 dark:text-base-content"
                    )} title={account.email}>
                        {account.email}
                    </h3>
                    <div className="flex items-center justify-between w-full gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {isCurrent && (
                                <span className="px-1.5 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[9px] font-bold shadow-sm border border-blue-200/50">
                                    {t('accounts.current').toUpperCase()}
                                </span>
                            )}
                            {isDisabled && (
                                <span
                                    className="px-1.5 py-0.5 rounded-md bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[9px] font-bold flex items-center gap-1 shadow-sm border border-rose-200/50"
                                >
                                    <Ban className="w-2.5 h-2.5" />
                                    {t('accounts.disabled').toUpperCase()}
                                </span>
                            )}
                            {account.quota?.is_forbidden && (
                                <span className="px-1.5 py-0.5 rounded-md bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[9px] font-bold flex items-center gap-1 shadow-sm border border-red-200/50">
                                    <Lock className="w-2.5 h-2.5" />
                                    {t('accounts.forbidden').toUpperCase()}
                                </span>
                            )}
                            {account.validation_blocked && (
                                <span className="px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-[9px] font-bold flex items-center gap-1 shadow-sm border border-amber-200/50">
                                    <Clock className="w-2.5 h-2.5" />
                                    {validationBlockedLabel.toUpperCase()}
                                </span>
                            )}
                            {/* 订阅类型徽章 */}
                            {account.quota?.subscription_tier && (() => {
                                const tier = account.quota.subscription_tier.toLowerCase();
                                if (tier.includes('ultra')) {
                                    return (
                                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gradient-to-r from-purple-600 to-pink-600 text-white text-[9px] font-bold shadow-sm">
                                            <Gem className="w-2.5 h-2.5 fill-current" />
                                            ULTRA
                                        </span>
                                    );
                                } else if (tier.includes('pro')) {
                                    return (
                                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[9px] font-bold shadow-sm">
                                            <Diamond className="w-2.5 h-2.5 fill-current" />
                                            PRO
                                        </span>
                                    );
                                } else {
                                    return (
                                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 text-[9px] font-bold shadow-sm border border-gray-200 dark:border-white/10">
                                            <Circle className="w-2.5 h-2.5" />
                                            FREE
                                        </span>
                                    );
                                }
                            })()}
                            {/* 自定义标签 */}
                            {account.custom_label && (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 text-[9px] font-bold shadow-sm border border-orange-200/50 dark:border-orange-800/50">
                                    <Tag className="w-2.5 h-2.5" />
                                    {account.custom_label}
                                </span>
                            )}
                        </div>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono shrink-0 whitespace-nowrap">
                            {new Date(account.last_used * 1000).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                </div>
            </div>


            {/* 配额展示 */}
            <div className="flex-1 px-2 mb-2 overflow-y-auto scrollbar-none">
                {isDisabled || account.quota?.is_forbidden || account.validation_blocked ? (
                    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 h-full py-4 text-center">
                        <div className={cn(
                            "flex items-center gap-1.5",
                            account.validation_blocked ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"
                        )}>
                            {account.validation_blocked ? <Clock className="w-4 h-4" /> : (isDisabled ? <Ban className="w-4 h-4" /> : <Lock className="w-4 h-4" />)}
                            <span className="text-[11px] font-bold">
                                {account.validation_blocked ? validationBlockedLabel : (isDisabled ? t('accounts.status.disabled') : t('accounts.forbidden_msg'))}
                            </span>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-2 content-start">
                        {quotaWindow === 'weekly' && weeklyItems.length > 0 ? (
                            weeklyItems.map((item) => (
                                <QuotaItem
                                    key={item.id}
                                    label={item.label}
                                    percentage={item.percentage}
                                    resetTime={item.resetTime}
                                    Icon={item.Icon}
                                />
                            ))
                        ) : (
                            displayModels.map((model) => (
                                <QuotaItem
                                    key={model.id}
                                    label={model.label}
                                    percentage={model.data?.percentage || 0}
                                    resetTime={model.data?.reset_time}
                                    isProtected={isModelProtected(model.protectedKey)}
                                    liveLimit={getLiveLimitForModel(account, model.id, model.protectedKey)}
                                    Icon={model.Icon}
                                />
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Footer: Actions Only */}
            <div className="flex-none flex items-center justify-center pt-2 pb-1 border-t border-gray-100 dark:border-base-200">
                <div className="flex items-center justify-center gap-2 w-full">
                    <button
                        className={`p-1.5 rounded-lg transition-all ${(isSwitching || isDisabled) ? 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/10 cursor-not-allowed' : 'text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30'}`}
                        onClick={(e) => { e.stopPropagation(); onSwitch(); }}
                        title={isDisabled ? t('accounts.disabled_tooltip') : (isSwitching ? t('common.loading') : t('accounts.switch_to_classic', '切换到 Antigravity (经典版)'))}
                        disabled={isSwitching || isDisabled}
                    >
                        <ArrowRightLeft className={`w-3.5 h-3.5 ${isSwitching ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        className={`p-1.5 rounded-lg transition-all ${isRefreshing
                            ? 'text-green-600 bg-green-50'
                            : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}
                        onClick={(e) => { e.stopPropagation(); onRefresh(); }}
                        disabled={isRefreshing || isDisabled}
                        title={isDisabled ? t('accounts.disabled_tooltip') : t('common.refresh')}
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>
        </div >
    );
}

export default AccountCard;
