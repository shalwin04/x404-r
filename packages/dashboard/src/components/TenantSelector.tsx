'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  getStoredApiKey,
  setStoredApiKey,
  clearStoredApiKey,
  getStoredSession,
  clearStoredSession,
  getUsage,
  getMe,
  logout as apiLogout,
  isAuthenticated,
  getGitHubLoginUrl,
} from '../lib/api';
import type { TenantInfo } from '../lib/types';

interface TenantSelectorProps {
  onTenantChange?: (tenant: TenantInfo | null) => void;
}

interface UserInfo {
  email: string;
  name?: string;
  avatar_url?: string;
}

export function TenantSelector({ onTenantChange }: TenantSelectorProps) {
  const [apiKey, setApiKey] = useState('');
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInput, setShowInput] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  // Check for existing auth on mount
  useEffect(() => {
    if (isAuthenticated()) {
      fetchAuthInfo();
    }
  }, []);

  const fetchAuthInfo = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Try to get user info if session exists
      const session = getStoredSession();
      if (session) {
        try {
          const meData = await getMe();
          setUser(meData.user);
          if (meData.memberships.length > 0) {
            const firstTenant = meData.memberships[0].tenant;
            setTenant({
              id: firstTenant.id,
              name: firstTenant.name,
              plan: firstTenant.plan as TenantInfo['plan'],
            });
            onTenantChange?.({
              id: firstTenant.id,
              name: firstTenant.name,
              plan: firstTenant.plan as TenantInfo['plan'],
            });
          }
          setIsLoading(false);
          return;
        } catch {
          // Session invalid, fall through to try API key
          clearStoredSession();
        }
      }

      // Try API key auth
      const usage = await getUsage();
      setTenant(usage.tenant);
      onTenantChange?.(usage.tenant);
    } catch (err) {
      setError('Failed to authenticate');
      setTenant(null);
      setUser(null);
      onTenantChange?.(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }

    setStoredApiKey(apiKey.trim());
    await fetchAuthInfo();
    setShowInput(false);
    setApiKey('');
  };

  const handleDisconnect = async () => {
    await apiLogout();
    setTenant(null);
    setUser(null);
    setApiKey('');
    setShowMenu(false);
    onTenantChange?.(null);
  };

  const handleGitHubLogin = () => {
    window.location.href = getGitHubLoginUrl();
  };

  const getPlanBadgeColor = (plan: string) => {
    switch (plan) {
      case 'enterprise':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/50';
      case 'team':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/50';
      case 'pro':
        return 'bg-green-500/20 text-green-300 border-green-500/50';
      default:
        return 'bg-gray-500/20 text-gray-300 border-gray-500/50';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 rounded-lg">
        <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  if (tenant || user) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="flex items-center gap-3 px-3 py-2 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
        >
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="" className="w-6 h-6 rounded-full" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-xs text-white font-medium">
              {(user?.name || tenant?.name || 'U')[0].toUpperCase()}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">
              {user?.name || tenant?.name}
            </span>
            {tenant && (
              <span
                className={`text-xs px-2 py-0.5 rounded border ${getPlanBadgeColor(tenant.plan)}`}
              >
                {tenant.plan.toUpperCase()}
              </span>
            )}
          </div>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${showMenu ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
            <div className="absolute right-0 mt-2 w-56 bg-gray-800 rounded-lg border border-gray-700 shadow-lg z-20">
              <div className="p-3 border-b border-gray-700">
                <p className="text-sm font-medium text-white">{user?.name || tenant?.name}</p>
                <p className="text-xs text-gray-400">{user?.email || tenant?.id}</p>
              </div>
              <div className="p-2">
                <Link
                  href="/admin"
                  className="block px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded transition-colors"
                  onClick={() => setShowMenu(false)}
                >
                  Manage Workspaces
                </Link>
                <button
                  onClick={handleDisconnect}
                  className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-gray-700 rounded transition-colors"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  if (showInput) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
          placeholder="Enter API key (af_...)"
          className="px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 w-64"
          autoFocus
        />
        <button
          onClick={handleConnect}
          className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          Connect
        </button>
        <button
          onClick={() => {
            setShowInput(false);
            setApiKey('');
            setError(null);
          }}
          className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 rounded-lg border border-gray-700">
        <div className="w-2 h-2 rounded-full bg-yellow-500" />
        <span className="text-sm text-gray-400">Demo Mode</span>
      </div>
      <button
        onClick={handleGitHubLogin}
        className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"
          />
        </svg>
        Sign in
      </button>
      <button
        onClick={() => setShowInput(true)}
        className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
      >
        Use API Key
      </button>
    </div>
  );
}

export default TenantSelector;
