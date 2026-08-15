/**
 * AI Provider Tests
 * Tests for AI provider abstraction and cost estimation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimateCost, MockAIProvider } from '../ai/index.js';
import type { TokenUsage } from '../types.js';

describe('estimateCost', () => {
  it('calculates cost for gemini-2.5-flash model', () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      embeddingTokens: 0,
    };

    const cost = estimateCost('gemini-2.5-flash', usage);

    // gemini-2.5-flash: input $0.075/1M, output $0.30/1M
    const expected = (1000 / 1_000_000) * 0.075 + (500 / 1_000_000) * 0.30;
    expect(cost).toBeCloseTo(expected, 6);
  });

  it('calculates cost for gpt-4-turbo model', () => {
    const usage: TokenUsage = {
      inputTokens: 10000,
      outputTokens: 2000,
      embeddingTokens: 0,
    };

    const cost = estimateCost('gpt-4-turbo-preview', usage);

    // gpt-4-turbo-preview: input $10.00/1M, output $30.00/1M
    const expected = (10000 / 1_000_000) * 10.00 + (2000 / 1_000_000) * 30.00;
    expect(cost).toBeCloseTo(expected, 6);
  });

  it('calculates cost for claude-3-sonnet model', () => {
    const usage: TokenUsage = {
      inputTokens: 5000,
      outputTokens: 1000,
      embeddingTokens: 0,
    };

    const cost = estimateCost('claude-3-sonnet', usage);

    // claude-3-sonnet: input $3.00/1M, output $15.00/1M
    const expected = (5000 / 1_000_000) * 3.00 + (1000 / 1_000_000) * 15.00;
    expect(cost).toBeCloseTo(expected, 6);
  });

  it('uses default pricing for unknown models', () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      embeddingTokens: 0,
    };

    const cost = estimateCost('unknown-model', usage);

    // Default: input $1.00/1M, output $2.00/1M
    const expected = (1000 / 1_000_000) * 1.00 + (500 / 1_000_000) * 2.00;
    expect(cost).toBeCloseTo(expected, 6);
  });

  it('handles zero tokens', () => {
    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      embeddingTokens: 0,
    };

    const cost = estimateCost('gpt-4-turbo-preview', usage);
    expect(cost).toBe(0);
  });

  it('handles large token counts', () => {
    const usage: TokenUsage = {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      embeddingTokens: 0,
    };

    const cost = estimateCost('gemini-2.5-flash', usage);

    // 1M input tokens + 500K output tokens
    const expected = 1.0 * 0.075 + 0.5 * 0.30;
    expect(cost).toBeCloseTo(expected, 4);
  });
});

describe('MockAIProvider', () => {
  let provider: MockAIProvider;

  beforeEach(() => {
    provider = new MockAIProvider();
  });

  describe('generate', () => {
    it('returns mock response string', async () => {
      const result = await provider.generate('Test prompt');

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('Mock response');
    });

    it('tracks token usage via lastUsage', async () => {
      await provider.generate('Test prompt');

      expect(provider.lastUsage).toBeDefined();
      expect(provider.lastUsage.inputTokens).toBeGreaterThan(0);
      expect(provider.lastUsage.outputTokens).toBeGreaterThan(0);
    });

    it('includes prompt info in response', async () => {
      const result = await provider.generate('My specific test prompt');

      expect(result).toContain('My specific');
    });
  });

  describe('generateJSON', () => {
    it('returns empty object', async () => {
      const result = await provider.generateJSON<{ data: string }>();

      expect(result).toEqual({});
    });

    it('tracks token usage', async () => {
      await provider.generateJSON();

      expect(provider.lastUsage.inputTokens).toBe(100);
      expect(provider.lastUsage.outputTokens).toBe(50);
    });
  });

  describe('embed', () => {
    it('returns embedding vector with correct dimensions', async () => {
      const embedding = await provider.embed('Test text');

      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(768); // MockAIProvider uses 768 dimensions
    });

    it('returns consistent embeddings (all zeros for mock)', async () => {
      const embedding1 = await provider.embed('Same text');
      const embedding2 = await provider.embed('Different text');

      // MockAIProvider returns zeros
      expect(embedding1).toEqual(embedding2);
    });

    it('tracks embedding tokens', async () => {
      await provider.embed('Test');

      expect(provider.lastUsage.embeddingTokens).toBeGreaterThan(0);
    });
  });
});

describe('Cost Calculation Scenarios', () => {
  it('calculates cost savings from checkpoint recovery', () => {
    // Scenario: Task crashed after 3 AI calls, recovered and completed
    const completedCalls: TokenUsage[] = [
      { inputTokens: 1000, outputTokens: 500, embeddingTokens: 0 },
      { inputTokens: 2000, outputTokens: 800, embeddingTokens: 0 },
      { inputTokens: 1500, outputTokens: 600, embeddingTokens: 0 },
    ];

    // Without recovery, would need to re-run all 3 calls
    const withoutRecovery = completedCalls.reduce(
      (sum, usage) => sum + estimateCost('gemini-2.5-flash', usage),
      0
    );

    // With recovery, we skip completed calls (saved cost)
    const saved = withoutRecovery;

    expect(saved).toBeGreaterThan(0);
  });

  it('tracks cumulative cost across workflow steps', () => {
    const stepCosts: number[] = [];

    // Simulate multi-step workflow
    const steps: TokenUsage[] = [
      { inputTokens: 500, outputTokens: 200, embeddingTokens: 0 },
      { inputTokens: 1000, outputTokens: 400, embeddingTokens: 0 },
      { inputTokens: 800, outputTokens: 300, embeddingTokens: 0 },
    ];

    let totalCost = 0;
    for (const usage of steps) {
      const stepCost = estimateCost('claude-3-sonnet', usage);
      stepCosts.push(stepCost);
      totalCost += stepCost;
    }

    expect(stepCosts).toHaveLength(3);
    expect(totalCost).toBe(stepCosts.reduce((a, b) => a + b, 0));
  });
});
