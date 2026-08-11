import type { IncomingMessage } from 'http';
import type { Database } from './db.js';
import type { TenantContext } from './types.js';
import { validateApiKey } from './auth.js';
import { DEFAULT_TENANT_CONTEXT } from './tenant-db.js';

/**
 * Check if running in demo mode
 */
export function isDemoMode(): boolean {
  return (
    process.env.DEMO_MODE === 'true' ||
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test'
  );
}

/**
 * Extract Authorization header from various request types
 */
function getAuthorizationHeader(
  request: IncomingMessage | Request | { headers: Record<string, string | undefined> }
): string | null {
  // Node.js IncomingMessage
  if ('headers' in request && typeof request.headers === 'object') {
    const headers = request.headers as Record<string, string | string[] | undefined>;
    const auth = headers['authorization'] || headers['Authorization'];
    if (Array.isArray(auth)) return auth[0] ?? null;
    return auth ?? null;
  }

  // Web API Request
  if (request instanceof Request) {
    return request.headers.get('authorization');
  }

  return null;
}

/**
 * Extract tenant context from request
 * Falls back to demo tenant in development mode
 */
export async function extractTenantContext(
  db: Database,
  request: IncomingMessage | Request | { headers: Record<string, string | undefined> }
): Promise<TenantContext | null> {
  const authHeader = getAuthorizationHeader(request);

  // Try to extract API key from Authorization header
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      const apiKey = match[1];
      const context = await validateApiKey(db, apiKey);
      if (context) {
        return context;
      }
    }
  }

  // Fall back to demo tenant in development mode
  if (isDemoMode()) {
    return DEFAULT_TENANT_CONTEXT;
  }

  return null;
}

/**
 * Require tenant context - throws if not found
 */
export async function requireTenantContext(
  db: Database,
  request: IncomingMessage | Request | { headers: Record<string, string | undefined> }
): Promise<TenantContext> {
  const context = await extractTenantContext(db, request);

  if (!context) {
    throw new AuthenticationError('Authentication required. Provide a valid API key.');
  }

  return context;
}

/**
 * Custom error class for authentication failures
 */
export class AuthenticationError extends Error {
  public readonly statusCode = 401;

  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Custom error class for authorization failures
 */
export class AuthorizationError extends Error {
  public readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * Custom error class for rate limit exceeded
 */
export class RateLimitError extends Error {
  public readonly statusCode = 429;
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * HTTP request wrapper with tenant context
 */
export interface TenantRequest<T = unknown> {
  context: TenantContext;
  body: T;
  params: Record<string, string>;
  query: Record<string, string>;
}

/**
 * Create middleware for Express-like frameworks
 */
export function createTenantMiddleware(db: Database) {
  return async (
    req: IncomingMessage & { tenantContext?: TenantContext },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: (err?: Error) => void
  ): Promise<void> => {
    try {
      req.tenantContext = await requireTenantContext(db, req);
      next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        res.status(401).json({ error: error.message });
      } else {
        next(error as Error);
      }
    }
  };
}

/**
 * Parse API key from various formats
 */
export function parseApiKey(input: string): string | null {
  // Direct API key
  if (input.startsWith('af_')) {
    return input;
  }

  // Bearer token
  const bearerMatch = input.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    return bearerMatch[1];
  }

  return null;
}
