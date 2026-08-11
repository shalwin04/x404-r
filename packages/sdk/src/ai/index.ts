/**
 * AI Provider Abstraction
 * Supports Gemini, OpenAI, and Anthropic
 */

import type { AIProvider, AIConfig, GenerateOptions, JSONSchema } from '../types.js';

/**
 * Create an AI provider from configuration
 */
export async function createAIProvider(config: AIConfig): Promise<AIProvider> {
  switch (config.provider) {
    case 'gemini':
      return GeminiProvider.create(config.apiKey, config.defaultModel);
    case 'openai':
      return OpenAIProvider.create(config.apiKey, config.defaultModel);
    case 'anthropic':
      return AnthropicProvider.create(config.apiKey, config.defaultModel);
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
 * No-op AI provider for testing
 */
export class MockAIProvider implements AIProvider {
  async generate(prompt: string): Promise<string> {
    return `Mock response for: ${prompt.slice(0, 50)}...`;
  }

  async generateJSON<T>(): Promise<T> {
    return {} as T;
  }

  async embed(): Promise<number[]> {
    return new Array(768).fill(0);
  }
}
