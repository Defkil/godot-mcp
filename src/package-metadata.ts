import { createRequire } from 'node:module';

interface PackageMetadata {
  version?: unknown;
}

const require = createRequire(import.meta.url);
const metadata = require('../package.json') as PackageMetadata;

if (typeof metadata.version !== 'string' || metadata.version.length === 0) {
  throw new Error('package.json must contain a version');
}

/** Version advertised to MCP clients, sourced from the installed package manifest. */
export const PACKAGE_VERSION = metadata.version;
