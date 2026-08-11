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

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(newTenant.slug)) {
      setError('Slug must be lowercase letters, numbers, and hyphens only');
      return;
    }

    try {
      setIsCreating(true);
      const tenant = await api.createTenant(newTenant.name, newTenant.slug, newTenant.plan);
      setTenants(prev => [...prev, { ...tenant, apiKeys: [] }]);
      setNewTenant({ name: '', slug: '', plan: 'free' });
      setSuccess(`Tenant "${tenant.name}" created successfully!`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tenant');
    } finally {
      setIsCreating(false);
    }
  }, [newTenant]);

  const handleCreateApiKey = useCallback(async (tenantId: string) => {
    if (!newKeyName.trim()) {
      setError('API key name is required');
      return;
    }

    try {
      setError(null);
      const key = await api.createApiKey(tenantId, newKeyName.trim());
      setNewApiKey(key);

      // Refresh the tenant's API keys
      const { keys } = await api.listApiKeys(tenantId);
      setTenants(prev =>
        prev.map(t =>
          t.id === tenantId ? { ...t, apiKeys: keys } : t
        )
      );

      setCreatingKeyFor(null);
      setNewKeyName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    }
  }, [newKeyName]);

  const handleLoadApiKeys = useCallback(async (tenantId: string) => {
    try {
      const { keys } = await api.listApiKeys(tenantId);
      setTenants(prev =>
        prev.map(t =>
          t.id === tenantId ? { ...t, apiKeys: keys } : t
        )
      );
    } catch (err) {
      console.error('Failed to load API keys:', err);
    }
  }, []);

  const getPlanColor = (plan: string) => {
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard!');
    setTimeout(() => setSuccess(null), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold">Admin Panel</h1>
                <p className="text-xs text-gray-400">Tenant Management</p>
              </div>
            </Link>
          </div>

          <Link
            href="/"
            className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </header>

      {/* Notifications */}
      {error && (
        <div className="bg-red-500/10 border-b border-red-500/30 px-6 py-3">
          <div className="flex items-center justify-between">
            <span className="text-red-400 text-sm">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {success && (
        <div className="bg-green-500/10 border-b border-green-500/30 px-6 py-3">
          <div className="flex items-center justify-between">
            <span className="text-green-400 text-sm">{success}</span>
            <button onClick={() => setSuccess(null)} className="text-green-400 hover:text-green-300">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* New API Key Modal */}
      {newApiKey && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-lg w-full mx-4 border border-gray-700">
            <h3 className="text-lg font-bold mb-4">API Key Created</h3>
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4">
              <p className="text-yellow-400 text-sm mb-2">
                Save this key now. It will not be shown again!
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-900 px-3 py-2 rounded text-sm font-mono break-all">
                  {newApiKey.key}
                </code>
                <button
                  onClick={() => copyToClipboard(newApiKey.key)}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
                >
                  Copy
                </button>
              </div>
            </div>
            <div className="text-sm text-gray-400 space-y-1">
              <p><span className="text-gray-500">Name:</span> {newApiKey.name}</p>
              <p><span className="text-gray-500">Prefix:</span> {newApiKey.prefix}</p>
              <p><span className="text-gray-500">Scopes:</span> {newApiKey.scopes.join(', ')}</p>
            </div>
            <button
              onClick={() => setNewApiKey(null)}
              className="w-full mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="p-6 max-w-6xl mx-auto">
        {/* Create Tenant Form */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
          <h2 className="text-lg font-bold mb-4">Create New Tenant</h2>
          <form onSubmit={handleCreateTenant} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={newTenant.name}
                  onChange={(e) => setNewTenant(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Acme Corp"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Slug</label>
                <input
                  type="text"
                  value={newTenant.slug}
                  onChange={(e) => setNewTenant(prev => ({ ...prev, slug: e.target.value.toLowerCase() }))}
                  placeholder="acme-corp"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Plan</label>
                <select
                  value={newTenant.plan}
                  onChange={(e) => setNewTenant(prev => ({ ...prev, plan: e.target.value as TenantPlan }))}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
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
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {isCreating ? 'Creating...' : 'Create Tenant'}
            </button>
          </form>
        </div>

        {/* Tenants List */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold">Tenants ({tenants.length})</h2>

          {tenants.length === 0 ? (
            <div className="bg-gray-800 rounded-lg p-8 text-center border border-gray-700">
              <p className="text-gray-400">No tenants created yet.</p>
              <p className="text-sm text-gray-500 mt-1">Create your first tenant above to get started.</p>
            </div>
          ) : (
            tenants.map((tenant) => (
              <div key={tenant.id} className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold">{tenant.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded border ${getPlanColor(tenant.plan)}`}>
                      {tenant.plan.toUpperCase()}
                    </span>
                  </div>
                  <code className="text-xs text-gray-500 bg-gray-900 px-2 py-1 rounded">
                    {tenant.id}
                  </code>
                </div>

                <div className="text-sm text-gray-400 mb-4">
                  <span className="text-gray-500">Slug:</span> {tenant.slug} |{' '}
                  <span className="text-gray-500">Limits:</span> {tenant.limits.task_limit_monthly.toLocaleString()} tasks/month, {tenant.limits.concurrent_task_limit} concurrent
                </div>

                {/* API Keys Section */}
                <div className="border-t border-gray-700 pt-4 mt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-gray-300">API Keys</h4>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleLoadApiKeys(tenant.id)}
                        className="text-xs text-gray-400 hover:text-white"
                      >
                        Refresh
                      </button>
                      <button
                        onClick={() => setCreatingKeyFor(tenant.id)}
                        className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded"
                      >
                        + New Key
                      </button>
                    </div>
                  </div>

                  {/* Create Key Form */}
                  {creatingKeyFor === tenant.id && (
                    <div className="flex items-center gap-2 mb-3">
                      <input
                        type="text"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        placeholder="Key name (e.g., Production)"
                        className="flex-1 px-3 py-2 text-sm bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
                        autoFocus
                      />
                      <button
                        onClick={() => handleCreateApiKey(tenant.id)}
                        className="px-3 py-2 text-sm bg-green-600 hover:bg-green-700 rounded-lg"
                      >
                        Create
                      </button>
                      <button
                        onClick={() => {
                          setCreatingKeyFor(null);
                          setNewKeyName('');
                        }}
                        className="px-3 py-2 text-sm text-gray-400 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Keys List */}
                  {tenant.apiKeys.length > 0 ? (
                    <div className="space-y-2">
                      {tenant.apiKeys.map((key) => (
                        <div
                          key={key.id}
                          className="flex items-center justify-between bg-gray-900 px-3 py-2 rounded text-sm"
                        >
                          <div className="flex items-center gap-3">
                            <code className="text-gray-400">{key.prefix}...</code>
                            <span className="text-gray-300">{key.name}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span>{key.scopes.join(', ')}</span>
                            {key.last_used_at && (
                              <span>Last used: {new Date(key.last_used_at).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No API keys. Click "Refresh" to load or create a new one.</p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Quick Start Guide */}
        <div className="bg-gray-800 rounded-lg p-6 mt-6 border border-gray-700">
          <h2 className="text-lg font-bold mb-4">Quick Start</h2>
          <ol className="list-decimal list-inside space-y-3 text-gray-300">
            <li>
              <span className="text-gray-400">Create a tenant above with a unique name and slug</span>
            </li>
            <li>
              <span className="text-gray-400">Generate an API key for the tenant</span>
            </li>
            <li>
              <span className="text-gray-400">Copy the API key (it's only shown once!)</span>
            </li>
            <li>
              <span className="text-gray-400">Go to the <Link href="/" className="text-blue-400 hover:underline">Dashboard</Link> and click "Connect Workspace"</span>
            </li>
            <li>
              <span className="text-gray-400">Paste your API key to authenticate</span>
            </li>
          </ol>

          <div className="mt-4 p-4 bg-gray-900 rounded-lg">
            <h3 className="text-sm font-medium text-gray-300 mb-2">Using the API directly:</h3>
            <pre className="text-xs text-gray-400 overflow-x-auto">
{`# Create a job
curl -X POST http://localhost:3001/jobs \\
  -H "Authorization: Bearer af_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "My Job", "taskDescription": "Do something"}'

# Check usage
curl http://localhost:3001/usage \\
  -H "Authorization: Bearer af_your_api_key_here"`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
