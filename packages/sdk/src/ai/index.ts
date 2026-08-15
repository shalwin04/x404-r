/**
 * AI Provider Abstraction
 * Supports Gemini, OpenAI, Anthropic, and AWS Bedrock
 */

import type { AIProvider, AIConfig, GenerateOptions, JSONSchema, TokenUsage } from '../types.js';

// Token pricing per 1M tokens (USD)
const PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 3.50, output: 10.50 },
  'gpt-4-turbo-preview': { input: 10.00, output: 30.00 },
  'gpt-4o': { input: 5.00, output: 15.00 },
  'claude-3-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'anthropic.claude-3-sonnet-20240229-v1:0': { input: 3.00, output: 15.00 },
  'anthropic.claude-3-haiku-20240307-v1:0': { input: 0.25, output: 1.25 },
};

export function estimateCost(model: string, usage: TokenUsage): number {
  const pricing = PRICING[model] || { input: 1.00, output: 2.00 }; // Default pricing
  return (
    (usage.inputTokens / 1_000_000) * pricing.input +
    (usage.outputTokens / 1_000_000) * pricing.output
  );
}

/**
 * Create an AI provider from configuration
 */
export async function createAIProvider(config: AIConfig): Promise<AIProvider> {
  switch (config.provider) {
    case 'gemini':
      return GeminiProvider.create(config.apiKey!, config.defaultModel);
    case 'openai':
      return OpenAIProvider.create(config.apiKey!, config.defaultModel);
    case 'anthropic':
      return AnthropicProvider.create(config.apiKey!, config.defaultModel);
    case 'bedrock':
      return BedrockProvider.create(config.region || 'us-east-1', config.defaultModel);
    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}

/**
 * Gemini AI Provider
 */
class GeminiProvider implements AIProvider {
  private client: any;
  private defaultModel: string;

  private constructor(client: any, defaultModel: string) {
    this.client = client;
    this.defaultModel = defaultModel;
  }

  static async create(apiKey: string, defaultModel?: string): Promise<GeminiProvider> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const client = new GoogleGenerativeAI(apiKey);
    return new GeminiProvider(client, defaultModel || 'gemini-2.5-flash');
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: options?.model || this.defaultModel,
    });

    const fullPrompt = options?.systemPrompt
      ? `${options.systemPrompt}\n\n${prompt}`
      : prompt;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 2048,
      },
    });

    return result.response.text();
  }

  async generateJSON<T>(prompt: string, schema?: JSONSchema): Promise<T> {
    const jsonPrompt = schema
      ? `${prompt}\n\nRespond with valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}\n\nOnly output the JSON, no markdown or explanation.`
      : `${prompt}\n\nRespond with valid JSON only. No markdown or explanation.`;

    const response = await this.generate(jsonPrompt);

    // Clean and parse response
    const cleaned = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    return JSON.parse(cleaned);
  }

  async embed(text: string): Promise<number[]> {
    // Use a simple hash-based embedding as fallback
    // In production, you would use a proper embedding model
    const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const embedding = new Array(768).fill(0).map((_, i) =>
      Math.sin(hash * (i + 1)) * Math.cos(hash / (i + 1))
    );
    return embedding;
  }
}

/**
 * OpenAI Provider
 */
class OpenAIProvider implements AIProvider {
  private client: any;
  private defaultModel: string;

  private constructor(client: any, defaultModel: string) {
    this.client = client;
    this.defaultModel = defaultModel;
  }

  static async create(apiKey: string, defaultModel?: string): Promise<OpenAIProvider> {
    try {
      // @ts-ignore - optional dependency
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey });
      return new OpenAIProvider(client, defaultModel || 'gpt-4-turbo-preview');
    } catch {
      throw new Error('openai package not installed. Run: npm install openai');
    }
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const messages: any[] = [];

    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await this.client.chat.completions.create({
      model: options?.model || this.defaultModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
    });

    return response.choices[0]?.message?.content || '';
  }

  async generateJSON<T>(prompt: string, schema?: JSONSchema): Promise<T> {
    const response = await this.client.chat.completions.create({
      model: this.defaultModel,
      messages: [
        { role: 'system', content: 'You are a helpful assistant that responds only with valid JSON.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    });

    return JSON.parse(response.choices[0]?.message?.content || '{}');
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }
}

/**
 * Anthropic Provider
 */
class AnthropicProvider implements AIProvider {
  private client: any;
  private defaultModel: string;

  private constructor(client: any, defaultModel: string) {
    this.client = client;
    this.defaultModel = defaultModel;
  }

  static async create(apiKey: string, defaultModel?: string): Promise<AnthropicProvider> {
    try {
      // @ts-ignore - optional dependency
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey });
      return new AnthropicProvider(client, defaultModel || 'claude-3-sonnet-20240229');
    } catch {
      throw new Error('@anthropic-ai/sdk package not installed. Run: npm install @anthropic-ai/sdk');
    }
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const response = await this.client.messages.create({
      model: options?.model || this.defaultModel,
      max_tokens: options?.maxTokens ?? 2048,
      system: options?.systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0]?.type === 'text' ? response.content[0].text : '';
  }

  async generateJSON<T>(prompt: string, schema?: JSONSchema): Promise<T> {
    const jsonPrompt = schema
      ? `${prompt}\n\nRespond with valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}\n\nOnly output the JSON, no markdown or explanation.`
      : `${prompt}\n\nRespond with valid JSON only. No markdown or explanation.`;

    const response = await this.generate(jsonPrompt);

    const cleaned = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    return JSON.parse(cleaned);
  }

  async embed(text: string): Promise<number[]> {
    // Anthropic doesn't have embeddings API, use a simple hash-based fallback
    // In production, you'd use a dedicated embedding service
    throw new Error('Anthropic does not support embeddings. Use Gemini or OpenAI for embeddings.');
  }
}

/**
 * AWS Bedrock Provider
 * Uses AWS SDK for Bedrock Runtime
 */
class BedrockProvider implements AIProvider {
  private client: any;
  private defaultModel: string;
  private _lastUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, embeddingTokens: 0 };

  private constructor(client: any, defaultModel: string) {
    this.client = client;
    this.defaultModel = defaultModel;
  }

  static async create(region: string, defaultModel?: string): Promise<BedrockProvider> {
    try {
      // Dynamic import for optional AWS dependency
      const bedrockModule = await import('@aws-sdk/client-bedrock-runtime').catch(() => null);
      if (!bedrockModule) {
        throw new Error('@aws-sdk/client-bedrock-runtime not installed. Run: npm install @aws-sdk/client-bedrock-runtime');
      }
      const { BedrockRuntimeClient, InvokeModelCommand } = bedrockModule;
      const client = new BedrockRuntimeClient({ region });
      // Store InvokeModelCommand on client for later use
      (client as any).InvokeModelCommand = InvokeModelCommand;
      return new BedrockProvider(client, defaultModel || 'anthropic.claude-3-sonnet-20240229-v1:0');
    } catch (err) {
      if (err instanceof Error && err.message.includes('not installed')) {
        throw err;
      }
      throw new Error('@aws-sdk/client-bedrock-runtime not installed. Run: npm install @aws-sdk/client-bedrock-runtime');
    }
  }

  get lastUsage(): TokenUsage {
    return this._lastUsage;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const model = options?.model || this.defaultModel;
    const InvokeModelCommand = (this.client as any).InvokeModelCommand;

    // Build request based on model provider
    let body: any;
    if (model.startsWith('anthropic.')) {
      body = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: options?.maxTokens ?? 2048,
        messages: [{ role: 'user', content: prompt }],
        ...(options?.systemPrompt && { system: options.systemPrompt }),
      };
    } else if (model.startsWith('amazon.titan')) {
      body = {
        inputText: options?.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt,
        textGenerationConfig: {
          maxTokenCount: options?.maxTokens ?? 2048,
          temperature: options?.temperature ?? 0.7,
        },
      };
    } else if (model.startsWith('meta.llama')) {
      body = {
        prompt: options?.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt,
        max_gen_len: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0.7,
      };
    } else {
      // Default to Anthropic format
      body = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: options?.maxTokens ?? 2048,
        messages: [{ role: 'user', content: prompt }],
      };
    }

    const command = new InvokeModelCommand({
      modelId: model,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    });

    const response = await this.client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Track token usage
    if (responseBody.usage) {
      this._lastUsage = {
        inputTokens: responseBody.usage.input_tokens || 0,
        outputTokens: responseBody.usage.output_tokens || 0,
        embeddingTokens: 0,
      };
    }

    // Parse response based on model
    if (model.startsWith('anthropic.')) {
      return responseBody.content?.[0]?.text || '';
    } else if (model.startsWith('amazon.titan')) {
      return responseBody.results?.[0]?.outputText || '';
    } else if (model.startsWith('meta.llama')) {
      return responseBody.generation || '';
    }

    return responseBody.content?.[0]?.text || responseBody.completion || '';
  }

  async generateJSON<T>(prompt: string, schema?: JSONSchema): Promise<T> {
    const jsonPrompt = schema
      ? `${prompt}\n\nRespond with valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}\n\nOnly output the JSON, no markdown or explanation.`
      : `${prompt}\n\nRespond with valid JSON only. No markdown or explanation.`;

    const response = await this.generate(jsonPrompt);

    const cleaned = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    return JSON.parse(cleaned);
  }

  async embed(text: string): Promise<number[]> {
    // Use Titan embeddings model
    const InvokeModelCommand = (this.client as any).InvokeModelCommand;

    try {
      const command = new InvokeModelCommand({
        modelId: 'amazon.titan-embed-text-v1',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ inputText: text }),
      });

      const response = await this.client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      this._lastUsage.embeddingTokens += text.split(/\s+/).length; // Approximate

      return responseBody.embedding || [];
    } catch {
      // Fallback to hash-based embedding if Titan not available
      const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return new Array(1536).fill(0).map((_, i) =>
        Math.sin(hash * (i + 1)) * Math.cos(hash / (i + 1))
      );
    }
  }
}

/**
 * No-op AI provider for testing
 */
export class MockAIProvider implements AIProvider {
  private _lastUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, embeddingTokens: 0 };

  get lastUsage(): TokenUsage {
    return this._lastUsage;
  }

  async generate(prompt: string): Promise<string> {
    this._lastUsage = { inputTokens: prompt.length / 4, outputTokens: 50, embeddingTokens: 0 };
    return `Mock response for: ${prompt.slice(0, 50)}...`;
  }

  async generateJSON<T>(): Promise<T> {
    this._lastUsage = { inputTokens: 100, outputTokens: 50, embeddingTokens: 0 };
    return {} as T;
  }

  async embed(): Promise<number[]> {
    this._lastUsage.embeddingTokens += 10;
    return new Array(768).fill(0);
  }
}

