export { GodotServer } from './server.js';
export type { GodotServerConfig } from './server.js';
export { PathPolicy, createPathPolicyFromEnvironment, parseAllowedRoots } from './security/path-policy.js';
export type { SupportedPlatform } from './security/path-policy.js';
export type { OperationParams } from './utils.js';

import { isDirectExecution, runGodotMcpCli } from './bin.js';

// Compatibility: existing clients may still execute build/index.js directly.
if (isDirectExecution(import.meta.url)) {
  void runGodotMcpCli();
}
