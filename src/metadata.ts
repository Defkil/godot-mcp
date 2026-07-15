import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getMetadata() {
  try {
    const packageJsonPath = join(__dirname, '..', 'package.json');
    const content = readFileSync(packageJsonPath, 'utf8');
    const pkg = JSON.parse(content);
    return {
      mcpName: pkg.mcpName || pkg.name,
      version: pkg.version
    };
  } catch (error) {
    return {
      mcpName: 'gi-go-mcp',
      version: '3.1.0'
    };
  }
}
