/**
 * Cloud Backend
 * HTTP API client for hosted x404-r platform
 */

import type { Backend } from './interface.js';
import type { Workflow, Task, WorkflowStatus } from '../types.js';

export interface CloudBackendConfig {
  apiKey: string;
  baseUrl?: string;
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

/**
 * Cloud backend - connects to hosted x404-r API
 * Used when running in cloud mode (no local DB needed)
 */
export class CloudBackend implements Backend {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: CloudBackendConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.x404r.io';
  }

  async ready(): Promise<void> {
    // Validate API key by calling health endpoint
    const response = await this.request<{ status: string }>('GET', '/health');
    if (!response.data) {
      throw new Error('Failed to connect to x404-r API');
    }
  }

  async close(): Promise<void> {
    // No cleanup needed for HTTP client
  }

  // ============ HTTP Client ============

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const data = (await response.json()) as T & { error?: string };

      if (!response.ok) {
        return { error: data.error || `HTTP ${response.status}` };
      }

      return { data: data as T };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private handleError(response: ApiResponse<any>, context: string): never {
    throw new Error(`${context}: ${response.error}`);
  }

  // ============ Workflow Operations ============

  async createWorkflow(
    name: string,
    version: string,
    input: Record<string, unknown>,
    priority: number = 0
  ): Promise<Workflow> {
    const response = await this.request<Workflow>('POST', '/workflows', {
      name,
      version,
      input,
      priority,
    });

    if (response.error || !response.data) {
      this.handleError(response, 'Failed to create workflow');
    }

    return response.data;
  }

  async getWorkflow(id: string): Promise<Workflow | null> {
    const response = await this.request<Workflow>('GET', `/workflows/${id}`);

    if (response.error) {
      if (response.error.includes('404')) {
        return null;
      }
      this.handleError(response, 'Failed to get workflow');
    }

    return response.data || null;
  }

  async updateWorkflowStatus(
    id: string,
    status: WorkflowStatus,
    output?: Record<string, unknown>,
    error?: string
  ): Promise<void> {
    const response = await this.request('PUT', `/workflows/${id}/status`, {
      status,
      output,
      error,
    });

    if (response.error) {
      this.handleError(response, 'Failed to update workflow status');
    }
  }

  async listWorkflows(
    options: { status?: WorkflowStatus; limit?: number; offset?: number } = {}
  ): Promise<Workflow[]> {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));

    const query = params.toString() ? `?${params}` : '';
    const response = await this.request<Workflow[]>(
      'GET',
      `/workflows${query}`
    );

    if (response.error || !response.data) {
      this.handleError(response, 'Failed to list workflows');
    }

    return response.data;
  }

  // ============ Task Operations ============

  async createTasks(
    workflowId: string,
    tasks: Array<{
      name: string;
      type: string;
      input: Record<string, unknown>;
      dependsOn: string[];
      maxAttempts?: number;
    }>
  ): Promise<Task[]> {
    const response = await this.request<Task[]>(
      'POST',
      `/workflows/${workflowId}/tasks`,
      { tasks }
    );

    if (response.error || !response.data) {
      this.handleError(response, 'Failed to create tasks');
    }

    return response.data;
  }

  async getWorkflowTasks(workflowId: string): Promise<Task[]> {
    const response = await this.request<Task[]>(
      'GET',
      `/workflows/${workflowId}/tasks`
    );

    if (response.error || !response.data) {
      this.handleError(response, 'Failed to get workflow tasks');
    }

    return response.data;
  }

  // Note: claimTask and heartbeat are not available in cloud mode
  // Workers run on Lambda, not locally

  async completeTask(
    taskId: string,
    output: Record<string, unknown>
  ): Promise<void> {
    const response = await this.request('PUT', `/tasks/${taskId}/complete`, {
      output,
    });

    if (response.error) {
      this.handleError(response, 'Failed to complete task');
    }
  }

  async failTask(taskId: string, error: string): Promise<void> {
    const response = await this.request('PUT', `/tasks/${taskId}/fail`, {
      error,
    });

    if (response.error) {
      this.handleError(response, 'Failed to fail task');
    }
  }

  // ============ Checkpoint Operations ============

  async createCheckpoint(
    taskId: string,
    stepIndex: number,
    state: Record<string, unknown>
  ): Promise<void> {
    const response = await this.request('POST', `/tasks/${taskId}/checkpoint`, {
      stepIndex,
      state,
    });

    if (response.error) {
      this.handleError(response, 'Failed to create checkpoint');
    }
  }

  async getCheckpoint(
    taskId: string
  ): Promise<{ stepIndex: number; state: Record<string, unknown> } | null> {
    const response = await this.request<{
      stepIndex: number;
      state: Record<string, unknown>;
    }>('GET', `/tasks/${taskId}/checkpoint`);

    if (response.error) {
      if (response.error.includes('404')) {
        return null;
      }
      this.handleError(response, 'Failed to get checkpoint');
    }

    return response.data || null;
  }

  async getWorkflowCheckpoints(workflowId: string): Promise<
    Array<{
      taskId: string;
      taskName: string;
      stepIndex: number;
      state: Record<string, unknown>;
      createdAt: Date;
    }>
  > {
    const response = await this.request<
      Array<{
        taskId: string;
        taskName: string;
        stepIndex: number;
        state: Record<string, unknown>;
        createdAt: string;
      }>
    >('GET', `/workflows/${workflowId}/checkpoints`);

    if (response.error || !response.data) {
      this.handleError(response, 'Failed to get workflow checkpoints');
    }

    return response.data.map((cp) => ({
      ...cp,
      createdAt: new Date(cp.createdAt),
    }));
  }

  // ============ Memory Operations ============

  async storeMemory(
    taskId: string,
    eventType: string,
    summary: string,
    embedding: number[],
    taskType?: string,
    errorCategory?: string,
    resolution?: string
  ): Promise<void> {
    const response = await this.request('POST', '/memories', {
      taskId,
      eventType,
      summary,
      embedding,
      taskType,
      errorCategory,
      resolution,
    });

    if (response.error) {
      this.handleError(response, 'Failed to store memory');
    }
  }

  async queryMemories(
    embedding: number[],
    taskType?: string,
    limit = 5
  ): Promise<
    Array<{
      summary: string;
      eventType: string;
      resolution?: string;
      similarity: number;
    }>
  > {
    const response = await this.request<
      Array<{
        summary: string;
        eventType: string;
        resolution?: string;
        similarity: number;
      }>
    >('POST', '/memories/query', {
      embedding,
      taskType,
      limit,
    });

    if (response.error || !response.data) {
      this.handleError(response, 'Failed to query memories');
    }

    return response.data;
  }

  // ============ Workflow Status ============

  async isWorkflowComplete(workflowId: string): Promise<{
    complete: boolean;
    failed: number;
    done: number;
    pending: number;
  }> {
    const response = await this.request<{
      complete: boolean;
      failed: number;
      done: number;
      pending: number;
    }>('GET', `/workflows/${workflowId}/status`);

    if (response.error || !response.data) {
      this.handleError(response, 'Failed to get workflow status');
    }

    return response.data;
  }

  // ============ Time Travel ============

  async replayFromCheckpoint(
    workflowId: string,
    checkpointId: string,
    newInput?: Record<string, unknown>
  ): Promise<Workflow> {
    const response = await this.request<Workflow>(
      'POST',
      `/workflows/${workflowId}/replay`,
      {
        checkpointId,
        newInput,
      }
    );

    if (response.error || !response.data) {
      this.handleError(response, 'Failed to replay from checkpoint');
    }

    return response.data;
  }

  // ============ Cost Tracking ============

  async getWorkflowCost(workflowId: string): Promise<{
    totalTokens: number;
    estimatedCostUsd: number;
    savedByRecoveryUsd: number;
  }> {
    const response = await this.request<{
      totalTokens: number;
      estimatedCostUsd: number;
      savedByRecoveryUsd: number;
    }>('GET', `/workflows/${workflowId}/cost`);

    if (response.error || !response.data) {
      this.handleError(response, 'Failed to get workflow cost');
    }

    return response.data;
  }

  // ============ Cloud-Specific Methods ============

  /**
   * Submit a workflow for execution (cloud workers will pick it up)
   */
  async submit(
    workflowName: string,
    input: Record<string, unknown>,
    options: { priority?: number; wait?: boolean; timeout?: number } = {}
  ): Promise<{ workflowId: string; status: WorkflowStatus }> {
    const response = await this.request<{
      workflowId: string;
      status: WorkflowStatus;
    }>('POST', '/submit', {
      workflow: workflowName,
      input,
      priority: options.priority || 0,
      wait: options.wait || false,
      timeout: options.timeout,
    });

    if (response.error || !response.data) {
      this.handleError(response, 'Failed to submit workflow');
    }

    return response.data;
  }

  /**
   * Wait for a workflow to complete
   */
  async waitForCompletion(
    workflowId: string,
    options: { timeout?: number; pollInterval?: number } = {}
  ): Promise<Workflow> {
    const { timeout = 300000, pollInterval = 1000 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const workflow = await this.getWorkflow(workflowId);

      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`);
      }

      if (workflow.status === 'completed' || workflow.status === 'failed') {
        return workflow;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Workflow ${workflowId} timed out after ${timeout}ms`);
  }
}
