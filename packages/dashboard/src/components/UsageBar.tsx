'use client';

import { useState, useEffect } from 'react';
import { getUsage, isAuthenticated } from '../lib/api';
import type { UsageInfo, TenantInfo } from '../lib/types';

interface UsageBarProps {
  refreshKey?: number;
}

export function UsageBar({ refreshKey }: UsageBarProps) {
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsage();
  }, [refreshKey]);

  const fetchUsage = async () => {
    if (!isAuthenticated()) {
      // In demo mode, show default values
      setUsage({
        used: 0,
        limit: 999999,
        remaining: 999999,
        resetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
      });
      setTenant({ id: 'demo', name: 'Demo', plan: 'free' });
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const data = await getUsage();
      setUsage(data.usage);
      setTenant(data.tenant);
    } catch (err) {
      setError('Failed to load usage');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 animate-pulse">
        <div className="h-4 bg-gray-700 rounded w-24 mb-2" />
        <div className="h-3 bg-gray-700 rounded w-full" />
      </div>
    );
  }

  if (error || !usage) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <span className="text-sm text-gray-500">{error || 'No usage data'}</span>
      </div>
    );
  }

  const percentage = Math.min((usage.used / usage.limit) * 100, 100);
  const isNearLimit = percentage >= 80;
  const isAtLimit = percentage >= 100;

  const getBarColor = () => {
    if (isAtLimit) return 'bg-red-500';
    if (isNearLimit) return 'bg-yellow-500';
    return 'bg-blue-500';
  };

  const getTextColor = () => {
    if (isAtLimit) return 'text-red-400';
    if (isNearLimit) return 'text-yellow-400';
    return 'text-gray-400';
  };

  const formatResetDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return 'Resets today';
    if (diffDays === 1) return 'Resets tomorrow';
    return `Resets in ${diffDays} days`;
  };

  return (
    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">Monthly Tasks</span>
          {tenant && tenant.id !== 'demo' && (
            <span className="text-xs text-gray-500">({tenant.name})</span>
          )}
        </div>
        <span className={`text-sm ${getTextColor()}`}>
          {usage.used.toLocaleString()} / {usage.limit.toLocaleString()}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full ${getBarColor()} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Footer info */}
      <div className="flex justify-between items-center text-xs">
        <span className="text-gray-500">{formatResetDate(usage.resetAt)}</span>
        <span className={getTextColor()}>
          {usage.remaining.toLocaleString()} remaining
        </span>
      </div>

      {/* Warning message */}
      {isAtLimit && (
        <div className="mt-3 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
          Task limit reached. Upgrade your plan to continue.
        </div>
      )}
      {isNearLimit && !isAtLimit && (
        <div className="mt-3 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-sm text-yellow-400">
          Approaching task limit. Consider upgrading your plan.
        </div>
      )}
    </div>
  );
}

interface UsageBadgeProps {
  used: number;
  limit: number;
  compact?: boolean;
}

export function UsageBadge({ used, limit, compact = false }: UsageBadgeProps) {
  const percentage = Math.min((used / limit) * 100, 100);
  const isNearLimit = percentage >= 80;
  const isAtLimit = percentage >= 100;

  const getBadgeColor = () => {
    if (isAtLimit) return 'bg-red-500/20 text-red-300 border-red-500/50';
    if (isNearLimit) return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50';
    return 'bg-gray-500/20 text-gray-300 border-gray-500/50';
  };

  if (compact) {
    return (
      <span className={`text-xs px-2 py-0.5 rounded border ${getBadgeColor()}`}>
        {used}/{limit}
      </span>
    );
  }

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded border ${getBadgeColor()}`}>
      <div className="w-12 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${isAtLimit ? 'bg-red-500' : isNearLimit ? 'bg-yellow-500' : 'bg-blue-500'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs">
        {used.toLocaleString()} / {limit.toLocaleString()}
      </span>
    </div>
  );
}

export default UsageBar;
