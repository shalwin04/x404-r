/**
 * Backend Module
 * Provides abstraction for embedded (direct DB) and cloud (HTTP API) modes
 */

export type { Backend } from './interface.js';
export { isEmbeddedBackend } from './interface.js';
export { EmbeddedBackend } from './embedded.js';
export type { EmbeddedBackendConfig } from './embedded.js';
export { CloudBackend } from './cloud.js';
export type { CloudBackendConfig } from './cloud.js';
