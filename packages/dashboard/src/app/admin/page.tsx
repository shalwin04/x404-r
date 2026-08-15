'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import type { CreateTenantResponse, CreateApiKeyResponse, ApiKeyInfo, TenantPlan } from '@/lib/types';

interface TenantWithKeys extends CreateTenantResponse {
  apiKeys: ApiKeyInfo[];
}

export default function AdminPage() {
  const [tenants, setTenants] = useState<TenantWithKeys[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: '', slug: '', plan: 'free' as TenantPlan });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newApiKey, setNewApiKey] = useState<CreateApiKeyResponse | null>(null);
  const [creatingKeyFor, setCreatingKeyFor] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');

  const handleCreateTenant = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!newTenant.name || !newTenant.slug) {
      setError('Name and slug are required');
      return;
    }

    if (!/^[a-z0-9-]+$/.test(newTenant.slug)) {
      setError('Slug must be lowercase letters, numbers, and hyphens only');
      return;
    }

    try {
      setIsCreating(true);
      const tenant = await api.createTenant(newTenant.name, newTenant.slug, newTenant.plan);
      setTenants(prev => [...prev, { ...tenant, apiKeys: [] }]);
      setNewTenant({ name: '', slug: '', plan: 'free' });
      setSuccess(`Tenant "${tenant.name}" created`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tenant');
    } finally {
      setIsCreating(false);
    }
  }, [newTenant]);

  const handleCreateApiKey = useCallback(async (tenantId: string) => {
    if (!newKeyName.trim()) {
      setError('Key name is required');
      return;
    }

    try {
      setError(null);
      const key = await api.createApiKey(tenantId, newKeyName.trim());
      setNewApiKey(key);

      const { keys } = await api.listApiKeys(tenantId);
      setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, apiKeys: keys } : t));

      setCreatingKeyFor(null);
      setNewKeyName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    }
  }, [newKeyName]);

  const handleLoadApiKeys = useCallback(async (tenantId: string) => {
    try {
      const { keys } = await api.listApiKeys(tenantId);
      setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, apiKeys: keys } : t));
    } catch (err) {
      console.error('Failed to load API keys:', err);
    }
  }, []);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied!');
    setTimeout(() => setSuccess(null), 2000);
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Header - glass material */}
      <header className="border-b glass" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="h-14 px-6 flex items-center justify-between max-w-5xl mx-auto">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-lg font-semibold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              x404-r
            </Link>
            <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              admin
            </span>
          </div>
          <Link href="/dashboard" className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Back to Dashboard
          </Link>
        </div>
      </header>

      {/* Notifications */}
      {error && (
        <div className="px-6 py-2 flex items-center justify-between max-w-5xl mx-auto" style={{ background: 'rgba(239, 68, 68, 0.1)' }}>
          <span className="text-sm" style={{ color: 'var(--error)' }}>{error}</span>
          <button onClick={() => setError(null)} style={{ color: 'var(--error)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {success && (
        <div className="px-6 py-2 flex items-center justify-between max-w-5xl mx-auto" style={{ background: 'rgba(34, 197, 94, 0.1)' }}>
          <span className="text-sm" style={{ color: 'var(--success)' }}>{success}</span>
          <button onClick={() => setSuccess(null)} style={{ color: 'var(--success)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* API Key Modal */}
      {newApiKey && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md mx-4 rounded-2xl p-6 animate-scale-in" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', boxShadow: '0 24px 48px -12px rgba(0, 0, 0, 0.5)' }}>
            <h3 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>API Key Created</h3>

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
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="p-6 max-w-5xl mx-auto space-y-6 animate-fade-in">
        {/* Create Tenant */}
        <div className="rounded-2xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', boxShadow: '0 2px 12px -4px rgba(0, 0, 0, 0.3)' }}>
          <h2 className="text-sm font-medium uppercase mb-4" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            Create Tenant
          </h2>
          <form onSubmit={handleCreateTenant} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>Name</label>
                <input
                  type="text"
                  value={newTenant.name}
                  onChange={(e) => setNewTenant(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Acme Corp"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>Slug</label>
                <input
                  type="text"
                  value={newTenant.slug}
                  onChange={(e) => setNewTenant(prev => ({ ...prev, slug: e.target.value.toLowerCase() }))}
                  placeholder="acme-corp"
                  className="w-full px-3 py-2 rounded-lg text-sm font-mono outline-none"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>Plan</label>
                <select
                  value={newTenant.plan}
                  onChange={(e) => setNewTenant(prev => ({ ...prev, plan: e.target.value as TenantPlan }))}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                >
                  <option value="free">Free</option>
                  <option value="pro">Pro</option>
                  <option value="team">Team</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={isCreating}
              className="px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              {isCreating ? 'Creating...' : 'Create Tenant'}
            </button>
          </form>
        </div>

        {/* Tenants List */}
        <div>
          <h2 className="text-sm font-medium uppercase mb-4" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            Tenants ({tenants.length})
          </h2>

          {tenants.length === 0 ? (
            <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
              <p style={{ color: 'var(--text-muted)' }}>No tenants yet</p>
            </div>
          ) : (
            <div className="space-y-3 stagger-enter">
              {tenants.map((tenant) => (
                <div key={tenant.id} className="rounded-2xl p-5 card-interactive animate-fade-in" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{tenant.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        tenant.plan === 'enterprise' ? 'bg-purple-500/20 text-purple-400' :
                        tenant.plan === 'team' ? 'bg-blue-500/20 text-blue-400' :
                        tenant.plan === 'pro' ? 'bg-green-500/20 text-green-400' :
                        'bg-zinc-500/20 text-zinc-400'
                      }`}>
                        {tenant.plan}
                      </span>
                    </div>
                    <code className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{tenant.id.slice(0, 8)}</code>
                  </div>

                  <div className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                    {tenant.slug} · {tenant.limits.task_limit_monthly.toLocaleString()} tasks/mo
                  </div>

                  {/* API Keys */}
                  <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>API Keys</span>
                      <div className="flex gap-2">
                        <button onClick={() => handleLoadApiKeys(tenant.id)} className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          Refresh
                        </button>
                        <button
                          onClick={() => setCreatingKeyFor(tenant.id)}
                          className="text-xs px-2 py-1 rounded"
                          style={{ background: 'var(--accent)', color: 'white' }}
                        >
                          + New
                        </button>
                      </div>
                    </div>

                    {creatingKeyFor === tenant.id && (
                      <div className="flex gap-2 mb-3">
                        <input
                          type="text"
                          value={newKeyName}
                          onChange={(e) => setNewKeyName(e.target.value)}
                          placeholder="Key name"
                          className="flex-1 px-3 py-1.5 rounded text-sm outline-none"
                          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                          autoFocus
                        />
                        <button onClick={() => handleCreateApiKey(tenant.id)} className="px-3 py-1.5 rounded text-sm" style={{ background: 'var(--success)', color: 'white' }}>
                          Create
                        </button>
                        <button onClick={() => { setCreatingKeyFor(null); setNewKeyName(''); }} className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          Cancel
                        </button>
                      </div>
                    )}

                    {tenant.apiKeys.length > 0 ? (
                      <div className="space-y-2">
                        {tenant.apiKeys.map((key) => (
                          <div key={key.id} className="flex items-center justify-between px-3 py-2 rounded text-sm" style={{ background: 'var(--bg-elevated)' }}>
                            <div className="flex items-center gap-2">
                              <code style={{ color: 'var(--text-muted)' }}>{key.prefix}...</code>
                              <span style={{ color: 'var(--text-secondary)' }}>{key.name}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No keys</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
