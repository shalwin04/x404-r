'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import type { ApiKeyInfo, CreateApiKeyResponse } from '@/lib/types';

export default function SettingsPage() {
  const [user, setUser] = useState<api.UserInfo | null>(null);
  const [memberships, setMemberships] = useState<api.MembershipInfo[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newApiKey, setNewApiKey] = useState<CreateApiKeyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    if (selectedTenant) {
      loadApiKeys(selectedTenant);
    }
  }, [selectedTenant]);

  const loadUser = async () => {
    try {
      const data = await api.getMe();
      setUser(data.user);
      setMemberships(data.memberships);
      if (data.memberships.length > 0) {
        setSelectedTenant(data.memberships[0].tenant_id);
      }
    } catch {
      // Not logged in - that's OK
    }
  };

  const loadApiKeys = async (tenantId: string) => {
    setIsLoadingKeys(true);
    try {
      const { keys } = await api.listApiKeys(tenantId);
      setApiKeys(keys);
    } catch (err) {
      console.error('Failed to load API keys:', err);
    } finally {
      setIsLoadingKeys(false);
    }
  };

  const handleCreateApiKey = useCallback(async () => {
    if (!selectedTenant || !newKeyName.trim()) return;

    setIsCreatingKey(true);
    setError(null);
    try {
      const key = await api.createApiKey(selectedTenant, newKeyName.trim());
      setNewApiKey(key);
      setNewKeyName('');
      await loadApiKeys(selectedTenant);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setIsCreatingKey(false);
    }
  }, [selectedTenant, newKeyName]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard!');
    setTimeout(() => setSuccess(null), 2000);
  };

  const handleLogout = async () => {
    await api.logout();
    window.location.href = '/login';
  };

  const currentTenant = memberships.find(m => m.tenant_id === selectedTenant);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="border-b glass" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="h-14 px-6 flex items-center justify-between max-w-5xl mx-auto">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-lg font-semibold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              x404-r
            </Link>
            <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              settings
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/usage" className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Usage
            </Link>
            <Link href="/dashboard" className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* Success/Error Messages */}
      {error && (
        <div className="px-6 py-2 max-w-5xl mx-auto" style={{ background: 'rgba(239, 68, 68, 0.1)' }}>
          <span className="text-sm" style={{ color: 'var(--error)' }}>{error}</span>
        </div>
      )}
      {success && (
        <div className="px-6 py-2 max-w-5xl mx-auto" style={{ background: 'rgba(34, 197, 94, 0.1)' }}>
          <span className="text-sm" style={{ color: 'var(--success)' }}>{success}</span>
        </div>
      )}

      {/* New API Key Modal */}
      {newApiKey && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md mx-4 rounded-2xl p-6 animate-scale-in" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', boxShadow: '0 24px 48px -12px rgba(0, 0, 0, 0.5)' }}>
            <h3 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>API Key Created</h3>

            <div className="p-4 rounded-lg mb-4" style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
              <p className="text-sm mb-3" style={{ color: 'var(--warning)' }}>
                Save this key now. It won't be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 rounded text-xs font-mono break-all" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                  {newApiKey.key}
                </code>
                <button
                  onClick={() => copyToClipboard(newApiKey.key)}
                  className="px-3 py-2 rounded text-sm font-medium"
                  style={{ background: 'var(--accent)', color: 'white' }}
                >
                  Copy
                </button>
              </div>
            </div>

            <div className="text-sm space-y-1 mb-4" style={{ color: 'var(--text-muted)' }}>
              <p><span style={{ color: 'var(--text-secondary)' }}>Name:</span> {newApiKey.name}</p>
              <p><span style={{ color: 'var(--text-secondary)' }}>Prefix:</span> {newApiKey.prefix}</p>
            </div>

            <button
              onClick={() => setNewApiKey(null)}
              className="w-full py-2.5 rounded-lg text-sm font-medium"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="p-6 max-w-5xl mx-auto space-y-6 animate-fade-in">
        {/* User Profile */}
        {user ? (
          <div className="rounded-2xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <h2 className="text-sm font-medium uppercase mb-4" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
              Profile
            </h2>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {user.avatar_url && (
                  <img src={user.avatar_url} alt="" className="w-12 h-12 rounded-full" />
                )}
                <div>
                  <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{user.name || user.email}</div>
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{user.email}</div>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
              >
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <p className="mb-4" style={{ color: 'var(--text-muted)' }}>Sign in to manage your settings</p>
            <Link
              href="/login"
              className="inline-block px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              Sign In
            </Link>
          </div>
        )}

        {/* Tenant Selection */}
        {memberships.length > 0 && (
          <div className="rounded-2xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <h2 className="text-sm font-medium uppercase mb-4" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
              Organization
            </h2>
            <div className="flex items-center gap-4">
              <select
                value={selectedTenant || ''}
                onChange={(e) => setSelectedTenant(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
              >
                {memberships.map(m => (
                  <option key={m.tenant_id} value={m.tenant_id}>
                    {m.tenant.name} ({m.tenant.plan})
                  </option>
                ))}
              </select>
              {currentTenant && (
                <span className={`text-xs px-2 py-1 rounded ${
                  currentTenant.tenant.plan === 'enterprise' ? 'bg-purple-500/20 text-purple-400' :
                  currentTenant.tenant.plan === 'team' ? 'bg-blue-500/20 text-blue-400' :
                  currentTenant.tenant.plan === 'pro' ? 'bg-green-500/20 text-green-400' :
                  'bg-zinc-500/20 text-zinc-400'
                }`}>
                  {currentTenant.role}
                </span>
              )}
            </div>
          </div>
        )}

        {/* API Keys */}
        {selectedTenant && (
          <div className="rounded-2xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium uppercase" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                API Keys
              </h2>
            </div>

            {/* Create new key */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g., Production, CI/CD)"
                className="flex-1 px-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
              />
              <button
                onClick={handleCreateApiKey}
                disabled={isCreatingKey || !newKeyName.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                {isCreatingKey ? 'Creating...' : 'Create Key'}
              </button>
            </div>

            {/* Keys list */}
            {isLoadingKeys ? (
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</div>
            ) : apiKeys.length === 0 ? (
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>No API keys yet</div>
            ) : (
              <div className="space-y-2">
                {apiKeys.map(key => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between px-4 py-3 rounded-lg"
                    style={{ background: 'var(--bg-elevated)' }}
                  >
                    <div>
                      <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{key.name}</div>
                      <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                        {key.prefix}... · Created {new Date(key.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {key.scopes.map((scope: string) => (
                        <span key={scope} className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                          {scope}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Quick Links */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/usage"
            className="rounded-2xl p-6 card-interactive"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="text-2xl mb-2">📊</div>
            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>Usage & Billing</div>
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>View usage metrics and cost breakdown</div>
          </Link>
          <Link
            href="/admin"
            className="rounded-2xl p-6 card-interactive"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="text-2xl mb-2">⚙️</div>
            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>Admin Console</div>
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Manage tenants and API keys</div>
          </Link>
        </div>
      </div>
    </div>
  );
}
