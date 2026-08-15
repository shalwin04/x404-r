'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const SESSION_STORAGE_KEY = 'x404r_session';

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setError(errorParam);
      return;
    }

    if (token) {
      localStorage.setItem(SESSION_STORAGE_KEY, token);
      router.push('/');
    } else {
      setError('No token received');
    }
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="max-w-sm w-full mx-4 p-6 rounded-2xl text-center animate-scale-in" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', boxShadow: '0 4px 24px -8px rgba(0, 0, 0, 0.4)' }}>
          <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'rgba(239, 68, 68, 0.1)' }}>
            <svg className="w-6 h-6" style={{ color: 'var(--error)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Authentication Failed</h1>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>{error}</p>
          <a
            href="/login"
            className="inline-block px-5 py-2.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            Try Again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="text-center">
        <div className="w-10 h-10 mx-auto mb-4 rounded-full animate-spin" style={{ border: '2px solid var(--border-subtle)', borderTopColor: 'var(--accent)' }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Completing login...</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center">
          <div className="w-10 h-10 mx-auto mb-4 rounded-full animate-spin" style={{ border: '2px solid var(--border-subtle)', borderTopColor: 'var(--accent)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</p>
        </div>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  );
}
