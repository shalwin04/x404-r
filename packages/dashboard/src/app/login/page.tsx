'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function LoginPage() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleApiKeyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      api.setStoredApiKey(apiKey.trim());
      await api.getUsage();
      router.push('/');
    } catch {
      api.clearStoredApiKey();
      setError('Invalid API key');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGitHubLogin = () => {
    window.location.href = `${API_BASE}/auth/github`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-primary)' }}>
      <div className="w-full max-w-sm animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-semibold mb-2" style={{ color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
            x404-r
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            The runtime where context is never lost
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', boxShadow: '0 4px 24px -8px rgba(0, 0, 0, 0.4)' }}>
          {/* Error */}
          {error && (
            <div className="mb-5 p-3 rounded-lg text-sm animate-scale-in" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              {error}
            </div>
          )}

          {/* GitHub Login */}
          <button
            onClick={handleGitHubLogin}
            className="w-full flex items-center justify-center gap-2.5 py-3 rounded-lg text-sm font-medium"
            style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)' }}
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"
              />
            </svg>
            Continue with GitHub
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>or</span>
            <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
          </div>

          {/* API Key Form */}
          <form onSubmit={handleApiKeyLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="x404r_..."
                className="w-full px-3 py-2.5 rounded-lg text-sm font-mono outline-none transition-all focus:ring-2 focus:ring-blue-500/30"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !apiKey.trim()}
              className="w-full py-3 rounded-lg text-sm font-medium disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              {isLoading ? 'Verifying...' : 'Continue'}
            </button>
          </form>

          {/* Demo Mode */}
          <div className="mt-6 pt-5 text-center" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <Link
              href="/"
              className="text-sm transition-colors hover:opacity-80"
              style={{ color: 'var(--text-muted)' }}
            >
              Continue in Demo Mode
            </Link>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 space-y-2">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Crash-proof AI agents on CockroachDB
          </p>
          <div className="flex items-center justify-center gap-3 text-xs">
            <Link href="/admin" className="transition-colors hover:opacity-80" style={{ color: 'var(--accent)' }}>
              Admin
            </Link>
            <span style={{ color: 'var(--border-default)' }}>|</span>
            <a href="https://github.com" className="transition-colors hover:opacity-80" style={{ color: 'var(--accent)' }}>
              Docs
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
