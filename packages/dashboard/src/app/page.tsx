'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function LandingPage() {
  const [copied, setCopied] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const copyInstall = () => {
    navigator.clipboard.writeText('npm install @x404-r/sdk');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyAuthExample = () => {
    navigator.clipboard.writeText(`const runtime = await new x404r({
  connectionString: process.env.DATABASE_URL,
  apiKey: process.env.X404R_API_KEY, // Your API key
}).ready();`);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold" style={{ letterSpacing: '-0.02em' }}>x404-r</span>
            <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              beta
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#features" className="text-sm" style={{ color: 'var(--text-muted)' }}>Features</a>
            <a href="#authentication" className="text-sm" style={{ color: 'var(--text-muted)' }}>Auth</a>
            <Link href="/monitor" className="text-sm" style={{ color: 'var(--text-muted)' }}>Monitor</Link>
            <Link href="/dashboard" className="text-sm" style={{ color: 'var(--text-muted)' }}>Dashboard</Link>
            <Link
              href="/dashboard"
              className="text-sm px-4 py-2 rounded-lg font-medium"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-8" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <span className="status-dot running"></span>
            <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>Built for CockroachDB x AWS Hackathon</span>
          </div>

          <h1 className="text-5xl md:text-6xl font-bold mb-6" style={{ letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            The runtime where<br />
            <span style={{ color: 'var(--accent)' }}>context is never lost</span>
          </h1>

          <p className="text-xl mb-10 max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Database-native infrastructure for crash-proof AI agents.
            State lives in CockroachDB, not memory. Workers can die anytime —
            agents resume exactly where they left off.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              href="/create"
              className="px-6 py-3 rounded-lg text-base font-medium"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              Create Agent
            </Link>
            <button
              onClick={copyInstall}
              className="px-6 py-3 rounded-lg text-base font-mono flex items-center gap-3"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
            >
              <span style={{ color: 'var(--text-muted)' }}>$</span>
              <span>npm install @x404-r/sdk</span>
              <span style={{ color: copied ? 'var(--success)' : 'var(--text-muted)' }}>
                {copied ? '✓' : '⎘'}
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Code Example */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <div className="px-4 py-3 flex items-center gap-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="w-3 h-3 rounded-full" style={{ background: '#ff5f57' }}></div>
              <div className="w-3 h-3 rounded-full" style={{ background: '#febc2e' }}></div>
              <div className="w-3 h-3 rounded-full" style={{ background: '#28c840' }}></div>
              <span className="ml-3 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>crash-proof-agent.ts</span>
            </div>
            <pre className="p-6 text-sm font-mono overflow-x-auto" style={{ color: 'var(--text-secondary)' }}>
              <code>{`import { durable } from '@x404-r/sdk';

// One line to make any function crash-proof
const result = await durable('process-documents', async (ctx) => {
  for (const doc of documents) {
    await processDocument(doc);

    // Checkpoint - survives any crash!
    await ctx.checkpoint('processed-' + doc.id);

    // Worker dies here? No problem.
    // Next worker resumes from checkpoint.
  }

  return { success: true, count: documents.length };
});`}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Authentication Section */}
      <section id="authentication" className="py-20 px-6" style={{ background: 'var(--bg-secondary)' }}>
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4" style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
              <svg className="w-4 h-4" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>AUTHENTICATION</span>
            </div>
            <h2 className="text-3xl font-bold mb-4" style={{ letterSpacing: '-0.02em' }}>
              Secure API Key Authentication
            </h2>
            <p className="max-w-2xl mx-auto" style={{ color: 'var(--text-muted)' }}>
              x404-r uses API keys to authenticate requests. Each key is scoped to your organization
              and provides secure access to your workflows and data.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* How to get API key */}
            <div className="p-6 rounded-2xl" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--accent)', color: 'white' }}>1</span>
                Get Your API Key
              </h3>
              <ol className="space-y-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex items-start gap-2">
                  <span style={{ color: 'var(--accent)' }}>→</span>
                  <span>Go to <Link href="/settings" className="underline" style={{ color: 'var(--accent)' }}>Settings</Link> in the dashboard</span>
                </li>
                <li className="flex items-start gap-2">
                  <span style={{ color: 'var(--accent)' }}>→</span>
                  <span>Click "Create Key" and give it a name</span>
                </li>
                <li className="flex items-start gap-2">
                  <span style={{ color: 'var(--accent)' }}>→</span>
                  <span>Copy and securely store your key (shown only once)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span style={{ color: 'var(--accent)' }}>→</span>
                  <span>Add to your environment: <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--bg-elevated)' }}>X404R_API_KEY=af_...</code></span>
                </li>
              </ol>
            </div>

            {/* Using API key */}
            <div className="p-6 rounded-2xl" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--accent)', color: 'white' }}>2</span>
                Use in Your Code
              </h3>
              <div className="rounded-lg overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                <div className="px-3 py-2 flex items-center justify-between border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>config.ts</span>
                  <button onClick={copyAuthExample} className="text-xs" style={{ color: copiedKey ? 'var(--success)' : 'var(--text-muted)' }}>
                    {copiedKey ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="p-4 text-xs font-mono overflow-x-auto" style={{ color: 'var(--text-secondary)' }}>
{`const runtime = await new x404r({
  connectionString: process.env.DATABASE_URL,
  apiKey: process.env.X404R_API_KEY,
}).ready();`}
                </pre>
              </div>
            </div>
          </div>

          {/* API Key Security Note */}
          <div className="mt-6 p-4 rounded-xl flex items-start gap-3" style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
            <svg className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: 'var(--warning)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-medium text-sm" style={{ color: 'var(--warning)' }}>Keep your API key secure</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                Never commit API keys to version control. Use environment variables or a secrets manager.
                Keys are hashed (SHA-256) and cannot be recovered if lost.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Data Usage Section */}
      <section id="data-usage" className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4" style={{ background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
              <svg className="w-4 h-4" style={{ color: 'var(--success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="text-xs font-medium" style={{ color: 'var(--success)' }}>DATA POLICY</span>
            </div>
            <h2 className="text-3xl font-bold mb-4" style={{ letterSpacing: '-0.02em' }}>
              Your Data, Your Control
            </h2>
            <p className="max-w-2xl mx-auto" style={{ color: 'var(--text-muted)' }}>
              We believe in transparency. Here's exactly what data we store and how we use it.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* What we store */}
            <div className="p-6 rounded-2xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(59, 130, 246, 0.1)' }}>
                <svg className="w-5 h-5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
              </div>
              <h3 className="font-semibold mb-3">What We Store</h3>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                <li className="flex items-center gap-2">
                  <span style={{ color: 'var(--success)' }}>✓</span>
                  Workflow state & checkpoints
                </li>
                <li className="flex items-center gap-2">
                  <span style={{ color: 'var(--success)' }}>✓</span>
                  Task inputs & outputs
                </li>
                <li className="flex items-center gap-2">
                  <span style={{ color: 'var(--success)' }}>✓</span>
                  Token usage metrics
                </li>
                <li className="flex items-center gap-2">
                  <span style={{ color: 'var(--success)' }}>✓</span>
                  Error logs for debugging
                </li>
              </ul>
            </div>

            {/* How we use it */}
            <div className="p-6 rounded-2xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(34, 197, 94, 0.1)' }}>
                <svg className="w-5 h-5" style={{ color: 'var(--success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <h3 className="font-semibold mb-3">How We Use It</h3>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                <li className="flex items-center gap-2">
                  <span style={{ color: 'var(--accent)' }}>→</span>
                  Resume workflows after crashes
                </li>
                <li className="flex items-center gap-2">
                  <span style={{ color: 'var(--accent)' }}>→</span>
                  Time-travel debugging
                </li>
                <li className="flex items-center gap-2">
                  <span style={{ color: 'var(--accent)' }}>→</span>
                  Usage billing & analytics
                </li>
                <li className="flex items-center gap-2">
                  <span style={{ color: 'var(--accent)' }}>→</span>
                  Service improvement
                </li>
              </ul>
            </div>

            {/* What we DON'T do */}
            <div className="p-6 rounded-2xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(239, 68, 68, 0.1)' }}>
                <svg className="w-5 h-5" style={{ color: 'var(--error)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
              <h3 className="font-semibold mb-3">What We Don't Do</h3>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                <li className="flex items-center gap-2">
                  <span style={{ color: 'var(--error)' }}>✗</span>
                  Sell your data to third parties
                </li>
                <li className="flex items-center gap-2">
                  <span style={{ color: 'var(--error)' }}>✗</span>
                  Train AI models on your data
                </li>
                <li className="flex items-center gap-2">
                  <span style={{ color: 'var(--error)' }}>✗</span>
                  Share data across tenants
                </li>
                <li className="flex items-center gap-2">
                  <span style={{ color: 'var(--error)' }}>✗</span>
                  Retain data after deletion
                </li>
              </ul>
            </div>
          </div>

          {/* Tenant Isolation */}
          <div className="mt-8 p-6 rounded-2xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(139, 92, 246, 0.1)' }}>
                <svg className="w-6 h-6" style={{ color: '#8b5cf6' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold mb-2">Complete Tenant Isolation</h3>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Each organization's data is completely isolated using CockroachDB's row-level security.
                  Your workflows, checkpoints, and AI outputs are never accessible by other tenants.
                  All data is scoped by your unique tenant ID and enforced at the database level.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-20 px-6" style={{ background: 'var(--bg-secondary)' }}>
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4" style={{ letterSpacing: '-0.02em' }}>
            Everything you need for crash-proof agents
          </h2>
          <p className="text-center mb-12 max-w-2xl mx-auto" style={{ color: 'var(--text-muted)' }}>
            Built on CockroachDB's distributed architecture. Deploy with AWS Lambda.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="p-6 rounded-2xl card-interactive" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(59, 130, 246, 0.1)' }}>
                <svg className="w-5 h-5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Crash-Proof Checkpoints</h3>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Save progress to CockroachDB at any point. Workers can crash, restart, or scale — agents resume exactly where they left off.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-6 rounded-2xl card-interactive" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(34, 197, 94, 0.1)' }}>
                <svg className="w-5 h-5" style={{ color: 'var(--success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Time Travel Debugging</h3>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Replay any workflow from any checkpoint. Debug failures by rewinding time. Test different inputs without re-running entire workflows.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-6 rounded-2xl card-interactive" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(245, 158, 11, 0.1)' }}>
                <svg className="w-5 h-5" style={{ color: 'var(--warning)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Cost Transparency</h3>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Track exactly what you're spending on AI. See per-task token usage, cost breakdowns, and how much crash recovery saves you.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="p-6 rounded-2xl card-interactive" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(239, 68, 68, 0.1)' }}>
                <svg className="w-5 h-5" style={{ color: 'var(--error)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Chaos Engineering</h3>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Built-in failure injection for testing. Simulate crashes, timeouts, OOM, and rate limits. Verify your agents handle failures gracefully.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="p-6 rounded-2xl card-interactive" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(139, 92, 246, 0.1)' }}>
                <svg className="w-5 h-5" style={{ color: '#8b5cf6' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Multi-Tenant SaaS</h3>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Built-in tenant isolation, API key auth, usage tracking, and priority scheduling. Enterprise customers get processed first.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="p-6 rounded-2xl card-interactive" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(59, 130, 246, 0.1)' }}>
                <svg className="w-5 h-5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">AWS Bedrock Ready</h3>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Use Claude, Titan, or Llama via AWS Bedrock. Also supports Gemini, OpenAI, and Anthropic directly. One config to switch providers.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12" style={{ letterSpacing: '-0.02em' }}>
            Built on battle-tested infrastructure
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
                <span className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>CR</span>
              </div>
              <h3 className="font-semibold mb-1">CockroachDB</h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Distributed SQL</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
                <span className="text-2xl font-bold" style={{ color: '#ff9900' }}>λ</span>
              </div>
              <h3 className="font-semibold mb-1">AWS Lambda</h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Serverless Workers</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
                <span className="text-2xl font-bold" style={{ color: '#00d4aa' }}>TS</span>
              </div>
              <h3 className="font-semibold mb-1">TypeScript</h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Type-safe SDK</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
                <span className="text-2xl font-bold" style={{ color: '#61dafb' }}>RF</span>
              </div>
              <h3 className="font-semibold mb-1">React Flow</h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>DAG Visualization</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6" style={{ background: 'var(--bg-secondary)' }}>
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4" style={{ letterSpacing: '-0.02em' }}>
            Ready to build crash-proof agents?
          </h2>
          <p className="mb-8" style={{ color: 'var(--text-muted)' }}>
            Try the live demo or explore the SDK documentation.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/dashboard"
              className="px-8 py-3 rounded-lg text-base font-medium"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              Open Dashboard
            </Link>
            <Link
              href="https://github.com/x404-r/sdk"
              className="px-8 py-3 rounded-lg text-base font-medium"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
            >
              View on GitHub
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold">x404-r</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Context never lost</span>
          </div>
          <div className="flex items-center gap-6 text-xs" style={{ color: 'var(--text-muted)' }}>
            <a href="#data-usage" className="hover:underline">Data Policy</a>
            <a href="#authentication" className="hover:underline">API Docs</a>
            <a href="https://cockroachdb-ai.devpost.com/" className="hover:underline">Hackathon</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
