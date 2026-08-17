'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import * as api from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Types
interface MetricsSummary {
  execution: {
    tasksTotal: number;
    tasksCompleted: number;
    tasksFailed: number;
    tasksPending: number;
    tasksRunning: number;
    successRate: number;
    throughput: number;
    queueDepth: number;
    activeWorkers: number;
  };
  cost: {
    totalCostUsd: number;
    costPerTask: number;
    tokensInput: number;
    tokensOutput: number;
    tokensTotal: number;
    savingsFromCheckpoints: number;
    projectedMonthlyCost: number;
  };
  performance: {
    latencyP50Ms: number;
    latencyP95Ms: number;
    latencyP99Ms: number;
    latencyAvgMs: number;
    throughputPerMinute: number;
    checkpointLatencyMs: number;
    aiLatencyMs: number;
  };
  reliability: {
    uptimePercent: number;
    mtbfMinutes: number;
    mttrSeconds: number;
    crashRecoveries: number;
    checkpointHitRate: number;
  };
  ai: {
    totalGenerations: number;
    modelBreakdown: Record<string, number>;
    avgTokensPerGeneration: number;
    contextUtilization: number;
  };
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  action?: {
    type: string;
    data?: Record<string, unknown>;
  };
}

// Fetcher
const fetcher = async (url: string) => {
  const headers: Record<string, string> = {};
  const apiKey = api.getStoredApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
};

// Mini sparkline chart component
function Sparkline({ data, color = 'var(--accent)', height = 30 }: { data: number[]; color?: string; height?: number }) {
  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 100 ${height}`} className="w-full" style={{ height }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Metric card component
function MetricCard({
  title,
  value,
  unit,
  change,
  sparklineData,
  color = 'var(--accent)',
  icon,
}: {
  title: string;
  value: string | number;
  unit?: string;
  change?: number;
  sparklineData?: number[];
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="p-4 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{title}</span>
        {icon && <span className="text-sm">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold font-mono" style={{ color }}>{value}</span>
        {unit && <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
      {change !== undefined && (
        <div className={`text-xs mt-1 ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}%
        </div>
      )}
      {sparklineData && sparklineData.length > 1 && (
        <div className="mt-2">
          <Sparkline data={sparklineData} color={color} />
        </div>
      )}
    </div>
  );
}

// Progress ring component
function ProgressRing({ value, size = 60, strokeWidth = 6, color = 'var(--accent)' }: {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--bg-elevated)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-500"
      />
    </svg>
  );
}

export default function MonitorPage() {
  // Metrics state
  const [metricsHistory, setMetricsHistory] = useState<number[][]>([[], [], [], []]);
  const [activeTab, setActiveTab] = useState<'overview' | 'performance' | 'cost' | 'reliability'>('overview');

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content: "Hi! I'm your x404-r assistant. I can help you understand your agent metrics, troubleshoot issues, or perform actions like creating workflows or replaying checkpoints. What would you like to know?",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Fetch metrics
  const { data: metricsData } = useSWR<{ metrics: MetricsSummary }>(
    `${API_BASE}/metrics`,
    fetcher,
    { refreshInterval: 5000, onError: () => {} }
  );

  // Fetch jobs for context
  const { data: jobsData } = useSWR<{ jobs: api.Job[] }>(
    `${API_BASE}/jobs`,
    fetcher,
    { refreshInterval: 5000 }
  );

  // Mock metrics if API not available
  const metrics: MetricsSummary = metricsData?.metrics || {
    execution: {
      tasksTotal: 156,
      tasksCompleted: 142,
      tasksFailed: 8,
      tasksPending: 3,
      tasksRunning: 3,
      successRate: 94.6,
      throughput: 12.4,
      queueDepth: 3,
      activeWorkers: 4,
    },
    cost: {
      totalCostUsd: 0.0847,
      costPerTask: 0.0006,
      tokensInput: 45230,
      tokensOutput: 12450,
      tokensTotal: 57680,
      savingsFromCheckpoints: 0.0234,
      projectedMonthlyCost: 2.54,
    },
    performance: {
      latencyP50Ms: 234,
      latencyP95Ms: 890,
      latencyP99Ms: 1450,
      latencyAvgMs: 312,
      throughputPerMinute: 12.4,
      checkpointLatencyMs: 45,
      aiLatencyMs: 780,
    },
    reliability: {
      uptimePercent: 99.7,
      mtbfMinutes: 45,
      mttrSeconds: 2.3,
      crashRecoveries: 8,
      checkpointHitRate: 87.5,
    },
    ai: {
      totalGenerations: 142,
      modelBreakdown: { 'gemini-2.5-flash': 98, 'claude-3-haiku': 44 },
      avgTokensPerGeneration: 406,
      contextUtilization: 0.35,
    },
  };

  // Update metrics history
  useEffect(() => {
    setMetricsHistory(prev => {
      const newHistory = [...prev];
      newHistory[0] = [...(newHistory[0] || []), metrics.execution.throughput].slice(-20);
      newHistory[1] = [...(newHistory[1] || []), metrics.performance.latencyP50Ms].slice(-20);
      newHistory[2] = [...(newHistory[2] || []), metrics.execution.successRate].slice(-20);
      newHistory[3] = [...(newHistory[3] || []), metrics.cost.totalCostUsd * 100].slice(-20);
      return newHistory;
    });
  }, [metrics]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle chat message
  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    // Simulate AI response
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

    const response = generateChatResponse(inputValue, metrics, jobsData?.jobs || []);

    const assistantMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: response.content,
      timestamp: new Date(),
      action: response.action,
    };

    setMessages(prev => [...prev, assistantMessage]);
    setIsTyping(false);
  }, [inputValue, metrics, jobsData]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="border-b glass sticky top-0 z-40" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-lg font-semibold" style={{ letterSpacing: '-0.02em' }}>x404-r</span>
            </Link>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>/</span>
            <span className="text-sm font-medium">Monitor</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span className="status-dot running"></span>
              <span>Live</span>
            </div>
            <Link href="/dashboard" className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Tab Navigation */}
        <div className="flex gap-1 mb-8 p-1 rounded-xl w-fit" style={{ background: 'var(--bg-secondary)' }}>
          {(['overview', 'performance', 'cost', 'reliability'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors"
              style={{
                background: activeTab === tab ? 'var(--bg-primary)' : 'transparent',
                color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Key Metrics Row */}
            <div className="grid grid-cols-4 gap-4">
              <MetricCard
                title="Success Rate"
                value={metrics.execution.successRate.toFixed(1)}
                unit="%"
                change={2.3}
                sparklineData={metricsHistory[2]}
                color="var(--success)"
                icon="✓"
              />
              <MetricCard
                title="Throughput"
                value={metrics.execution.throughput.toFixed(1)}
                unit="tasks/min"
                change={5.2}
                sparklineData={metricsHistory[0]}
                color="var(--accent)"
                icon="⚡"
              />
              <MetricCard
                title="P50 Latency"
                value={metrics.performance.latencyP50Ms.toFixed(0)}
                unit="ms"
                change={-12.5}
                sparklineData={metricsHistory[1]}
                color="#f59e0b"
                icon="⏱"
              />
              <MetricCard
                title="Total Cost"
                value={`$${metrics.cost.totalCostUsd.toFixed(4)}`}
                change={8.1}
                sparklineData={metricsHistory[3]}
                color="#8b5cf6"
                icon="💰"
              />
            </div>

            {/* Main Dashboard Grid */}
            <div className="grid grid-cols-3 gap-6">
              {/* Task Status */}
              <div className="p-6 rounded-xl col-span-2" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-medium mb-4">Task Execution</h3>
                <div className="grid grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-3xl font-bold font-mono" style={{ color: 'var(--success)' }}>
                      {metrics.execution.tasksCompleted}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Completed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold font-mono" style={{ color: 'var(--accent)' }}>
                      {metrics.execution.tasksRunning}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Running</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold font-mono" style={{ color: 'var(--text-muted)' }}>
                      {metrics.execution.tasksPending}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Pending</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold font-mono" style={{ color: 'var(--error)' }}>
                      {metrics.execution.tasksFailed}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Failed</div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-6 h-3 rounded-full overflow-hidden flex" style={{ background: 'var(--bg-elevated)' }}>
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${(metrics.execution.tasksCompleted / metrics.execution.tasksTotal) * 100}%`,
                      background: 'var(--success)',
                    }}
                  />
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${(metrics.execution.tasksRunning / metrics.execution.tasksTotal) * 100}%`,
                      background: 'var(--accent)',
                    }}
                  />
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${(metrics.execution.tasksFailed / metrics.execution.tasksTotal) * 100}%`,
                      background: 'var(--error)',
                    }}
                  />
                </div>
              </div>

              {/* Uptime Ring */}
              <div className="p-6 rounded-xl flex flex-col items-center justify-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                <div className="relative">
                  <ProgressRing value={metrics.reliability.uptimePercent} size={100} color="var(--success)" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold font-mono">{metrics.reliability.uptimePercent}%</span>
                  </div>
                </div>
                <div className="text-sm mt-3" style={{ color: 'var(--text-muted)' }}>Uptime</div>
              </div>
            </div>

            {/* AI & Cost Section */}
            <div className="grid grid-cols-2 gap-6">
              {/* AI Usage */}
              <div className="p-6 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-medium mb-4">AI Model Usage</h3>
                <div className="space-y-3">
                  {Object.entries(metrics.ai.modelBreakdown).map(([model, count]) => (
                    <div key={model} className="flex items-center justify-between">
                      <span className="text-sm font-mono">{model}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-32 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(count / metrics.ai.totalGenerations) * 100}%`,
                              background: 'var(--accent)',
                            }}
                          />
                        </div>
                        <span className="text-sm font-mono w-12 text-right">{count}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex justify-between text-sm">
                    <span style={{ color: 'var(--text-muted)' }}>Total Generations</span>
                    <span className="font-mono">{metrics.ai.totalGenerations}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-2">
                    <span style={{ color: 'var(--text-muted)' }}>Avg Tokens/Gen</span>
                    <span className="font-mono">{metrics.ai.avgTokensPerGeneration.toFixed(0)}</span>
                  </div>
                </div>
              </div>

              {/* Cost Breakdown */}
              <div className="p-6 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-medium mb-4">Cost Breakdown</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Input Tokens</span>
                    <div className="text-right">
                      <span className="font-mono">{(metrics.cost.tokensInput / 1000).toFixed(1)}K</span>
                      <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                        ${((metrics.cost.tokensInput / 1000000) * 0.15).toFixed(4)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Output Tokens</span>
                    <div className="text-right">
                      <span className="font-mono">{(metrics.cost.tokensOutput / 1000).toFixed(1)}K</span>
                      <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                        ${((metrics.cost.tokensOutput / 1000000) * 0.60).toFixed(4)}
                      </span>
                    </div>
                  </div>
                  <div className="pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium" style={{ color: 'var(--success)' }}>Checkpoint Savings</span>
                      <span className="font-mono" style={{ color: 'var(--success)' }}>
                        -${metrics.cost.savingsFromCheckpoints.toFixed(4)}
                      </span>
                    </div>
                  </div>
                  <div className="pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Projected Monthly</span>
                      <span className="font-mono text-lg">${metrics.cost.projectedMonthlyCost.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Reliability Section */}
            <div className="grid grid-cols-4 gap-4">
              <div className="p-4 rounded-xl text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                <div className="text-2xl font-bold font-mono">{metrics.reliability.mtbfMinutes.toFixed(0)}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>MTBF (min)</div>
              </div>
              <div className="p-4 rounded-xl text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                <div className="text-2xl font-bold font-mono">{metrics.reliability.mttrSeconds.toFixed(1)}s</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>MTTR</div>
              </div>
              <div className="p-4 rounded-xl text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                <div className="text-2xl font-bold font-mono" style={{ color: 'var(--success)' }}>{metrics.reliability.crashRecoveries}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Recoveries</div>
              </div>
              <div className="p-4 rounded-xl text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                <div className="text-2xl font-bold font-mono">{metrics.reliability.checkpointHitRate.toFixed(0)}%</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Checkpoint Hit Rate</div>
              </div>
            </div>
          </div>
        )}

        {/* Performance Tab */}
        {activeTab === 'performance' && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4">
              <MetricCard title="P50 Latency" value={metrics.performance.latencyP50Ms.toFixed(0)} unit="ms" color="var(--success)" />
              <MetricCard title="P95 Latency" value={metrics.performance.latencyP95Ms.toFixed(0)} unit="ms" color="#f59e0b" />
              <MetricCard title="P99 Latency" value={metrics.performance.latencyP99Ms.toFixed(0)} unit="ms" color="var(--error)" />
              <MetricCard title="Avg Latency" value={metrics.performance.latencyAvgMs.toFixed(0)} unit="ms" color="var(--accent)" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <MetricCard title="Throughput" value={metrics.performance.throughputPerMinute.toFixed(1)} unit="tasks/min" />
              <MetricCard title="Checkpoint Latency" value={metrics.performance.checkpointLatencyMs.toFixed(0)} unit="ms" />
              <MetricCard title="AI Latency" value={metrics.performance.aiLatencyMs.toFixed(0)} unit="ms" />
            </div>
          </div>
        )}

        {/* Cost Tab */}
        {activeTab === 'cost' && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4">
              <MetricCard title="Total Cost" value={`$${metrics.cost.totalCostUsd.toFixed(4)}`} color="#8b5cf6" />
              <MetricCard title="Cost/Task" value={`$${metrics.cost.costPerTask.toFixed(4)}`} />
              <MetricCard title="Savings" value={`$${metrics.cost.savingsFromCheckpoints.toFixed(4)}`} color="var(--success)" />
              <MetricCard title="Monthly Projection" value={`$${metrics.cost.projectedMonthlyCost.toFixed(2)}`} />
            </div>
            <div className="p-6 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
              <h3 className="text-sm font-medium mb-4">Token Usage</h3>
              <div className="flex items-center gap-8">
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span>Input Tokens</span>
                    <span className="font-mono">{(metrics.cost.tokensInput / 1000).toFixed(1)}K</span>
                  </div>
                  <div className="h-4 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(metrics.cost.tokensInput / metrics.cost.tokensTotal) * 100}%`,
                        background: 'var(--accent)',
                      }}
                    />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span>Output Tokens</span>
                    <span className="font-mono">{(metrics.cost.tokensOutput / 1000).toFixed(1)}K</span>
                  </div>
                  <div className="h-4 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(metrics.cost.tokensOutput / metrics.cost.tokensTotal) * 100}%`,
                        background: '#8b5cf6',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Reliability Tab */}
        {activeTab === 'reliability' && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4">
              <MetricCard title="Uptime" value={`${metrics.reliability.uptimePercent}%`} color="var(--success)" />
              <MetricCard title="MTBF" value={metrics.reliability.mtbfMinutes.toFixed(0)} unit="min" />
              <MetricCard title="MTTR" value={metrics.reliability.mttrSeconds.toFixed(1)} unit="sec" color="var(--accent)" />
              <MetricCard title="Crash Recoveries" value={metrics.reliability.crashRecoveries} color="var(--success)" />
            </div>
            <div className="p-6 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
              <h3 className="text-sm font-medium mb-4">Checkpoint Performance</h3>
              <div className="flex items-center justify-between">
                <span>Hit Rate</span>
                <div className="flex items-center gap-4">
                  <div className="w-48 h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${metrics.reliability.checkpointHitRate}%`, background: 'var(--success)' }}
                    />
                  </div>
                  <span className="font-mono">{metrics.reliability.checkpointHitRate.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Chat Button */}
      <button
        onClick={() => setChatOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full flex items-center justify-center shadow-lg z-50"
        style={{ background: 'var(--accent)' }}
      >
        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </button>

      {/* Chat Panel */}
      {chatOpen && (
        <div className="fixed bottom-6 right-6 w-96 h-[600px] rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden"
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
          {/* Chat Header */}
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                <span className="text-white text-sm">🤖</span>
              </div>
              <div>
                <div className="text-sm font-medium">x404-r Assistant</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Online</div>
              </div>
            </div>
            <button onClick={() => setChatOpen(false)} className="p-1" style={{ color: 'var(--text-muted)' }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm ${
                    msg.role === 'user' ? 'rounded-br-md' : 'rounded-bl-md'
                  }`}
                  style={{
                    background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-secondary)',
                    color: msg.role === 'user' ? 'white' : 'var(--text-primary)',
                  }}
                >
                  {msg.content}
                  {msg.action && (
                    <div className="mt-2 pt-2 border-t border-white/20">
                      <button
                        className="text-xs underline"
                        onClick={() => {
                          // Handle action
                          console.log('Action:', msg.action);
                        }}
                      >
                        {msg.action.type === 'navigate' ? 'Go to Dashboard →' : 'Execute Action'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="px-4 py-2 rounded-2xl rounded-bl-md" style={{ background: 'var(--bg-secondary)' }}>
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--text-muted)', animationDelay: '0ms' }}></span>
                    <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--text-muted)', animationDelay: '150ms' }}></span>
                    <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--text-muted)', animationDelay: '300ms' }}></span>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat Input */}
          <div className="p-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask about your agents..."
                className="flex-1 px-4 py-2 rounded-xl text-sm"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-default)' }}
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputValue.trim()}
                className="px-4 py-2 rounded-xl disabled:opacity-50"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              {['Show metrics', 'Recent failures', 'Cost breakdown'].map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => setInputValue(suggestion)}
                  className="text-xs px-2 py-1 rounded-full"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Chat response generator
function generateChatResponse(
  input: string,
  metrics: MetricsSummary,
  jobs: api.Job[]
): { content: string; action?: { type: string; data?: Record<string, unknown> } } {
  const lower = input.toLowerCase();

  if (lower.includes('metric') || lower.includes('status') || lower.includes('how are')) {
    return {
      content: `Here's a quick overview:\n\n📊 **Execution**: ${metrics.execution.tasksCompleted}/${metrics.execution.tasksTotal} tasks completed (${metrics.execution.successRate.toFixed(1)}% success rate)\n\n⚡ **Performance**: P50 latency is ${metrics.performance.latencyP50Ms}ms, throughput at ${metrics.execution.throughput.toFixed(1)} tasks/min\n\n💰 **Cost**: $${metrics.cost.totalCostUsd.toFixed(4)} total, saving $${metrics.cost.savingsFromCheckpoints.toFixed(4)} from checkpoints\n\n✅ **Reliability**: ${metrics.reliability.uptimePercent}% uptime, ${metrics.reliability.crashRecoveries} successful recoveries`,
    };
  }

  if (lower.includes('fail') || lower.includes('error')) {
    return {
      content: `I found ${metrics.execution.tasksFailed} failed tasks. The current MTTR (Mean Time To Recovery) is ${metrics.reliability.mttrSeconds.toFixed(1)} seconds.\n\nMost failures are automatically recovered through our checkpoint system. Would you like me to show you the failed tasks in the dashboard?`,
      action: { type: 'navigate', data: { path: '/dashboard', filter: 'failed' } },
    };
  }

  if (lower.includes('cost') || lower.includes('spending') || lower.includes('money')) {
    return {
      content: `💰 **Cost Analysis**:\n\n• Total spent: $${metrics.cost.totalCostUsd.toFixed(4)}\n• Per task: $${metrics.cost.costPerTask.toFixed(4)}\n• Input tokens: ${(metrics.cost.tokensInput/1000).toFixed(1)}K\n• Output tokens: ${(metrics.cost.tokensOutput/1000).toFixed(1)}K\n\n🎉 **Checkpoint savings**: $${metrics.cost.savingsFromCheckpoints.toFixed(4)} saved by not re-running recovered tasks!\n\n📈 Projected monthly: $${metrics.cost.projectedMonthlyCost.toFixed(2)}`,
    };
  }

  if (lower.includes('create') || lower.includes('new agent') || lower.includes('start')) {
    return {
      content: `I can help you create a new agent! You can either:\n\n1. **Natural language**: Describe what you want in the Create Agent page\n2. **SDK**: Use the x404-r SDK in your code\n\nWould you like me to take you to the Create Agent page?`,
      action: { type: 'navigate', data: { path: '/create' } },
    };
  }

  if (lower.includes('checkpoint') || lower.includes('recovery') || lower.includes('crash')) {
    return {
      content: `🔄 **Checkpoint & Recovery Stats**:\n\n• Checkpoint hit rate: ${metrics.reliability.checkpointHitRate.toFixed(1)}%\n• Successful recoveries: ${metrics.reliability.crashRecoveries}\n• Avg recovery time: ${metrics.reliability.mttrSeconds.toFixed(1)}s\n• MTBF: ${metrics.reliability.mtbfMinutes.toFixed(0)} minutes\n\nCheckpoints ensure your agents can resume exactly where they left off after any failure!`,
    };
  }

  if (lower.includes('job') || lower.includes('workflow')) {
    const runningJobs = jobs.filter(j => j.status === 'running').length;
    const completedJobs = jobs.filter(j => j.status === 'completed').length;
    return {
      content: `📋 **Workflow Status**:\n\n• Total workflows: ${jobs.length}\n• Running: ${runningJobs}\n• Completed: ${completedJobs}\n\n${jobs.slice(0, 3).map(j => `• ${j.name}: ${j.status}`).join('\n')}\n\nWant to see more details in the dashboard?`,
      action: { type: 'navigate', data: { path: '/dashboard' } },
    };
  }

  // Default response
  return {
    content: `I can help you with:\n\n• 📊 **Metrics** - "Show me the metrics"\n• 💰 **Costs** - "What's my spending?"\n• 🔄 **Recovery** - "How are checkpoints working?"\n• ❌ **Failures** - "Show recent failures"\n• 🚀 **Create** - "Create a new agent"\n\nWhat would you like to know?`,
  };
}

// Type for jobs in the component
declare module '@/lib/api' {
  interface Job {
    id: string;
    name: string;
    status: string;
    created_at: string;
  }
}
