import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(`${ROOT}/${relativePath}`, 'utf8')) as T;
}

interface PackageJson {
  name: string;
  version: string;
  description: string;
  author?: string | { name?: string; email?: string };
  license: string;
  repository: { type?: string; url: string };
  bugs?: { url?: string };
  homepage?: string;
  keywords?: string[];
  mcpName?: string;
}

interface ServerJson {
  $schema: string;
  name: string;
  title: string;
  description: string;
  repository: { url: string; source: string };
  version: string;
  websiteUrl?: string;
  packages: Array<{
    registryType: string;
    identifier: string;
    version: string;
    transport: { type: string };
  }>;
}

interface PackageLockJson {
  name: string;
  version: string;
  packages: { '': { name: string; version: string } };
}

describe('Defkil fork package identity', () => {
  it('publishes under the @defkil/godot-mcp npm scope', async () => {
    const pkg = await readJson<PackageJson>('package.json');
    expect(pkg.name).toBe('@defkil/godot-mcp');
  });

  it('keeps the Defkil repository URL everywhere a release manifest names one', async () => {
    const pkg = await readJson<PackageJson>('package.json');
    const server = await readJson<ServerJson>('server.json');

    // npm convention: `https://github.com/<owner>/<repo>.git` (no git+ prefix)
    expect(pkg.repository.url).toBe('https://github.com/Defkil/godot-mcp.git');
    expect(pkg.bugs?.url).toBe('https://github.com/Defkil/godot-mcp/issues');
    expect(pkg.homepage).toBe('https://github.com/Defkil/godot-mcp');

    expect(server.repository.url).toBe('https://github.com/Defkil/godot-mcp');
    expect(server.websiteUrl).toBe('https://github.com/Defkil/godot-mcp');
  });

  it('uses io.github.Defkil/godot-mcp as the MCP Registry server name', async () => {
    const pkg = await readJson<PackageJson>('package.json');
    const server = await readJson<ServerJson>('server.json');

    expect(pkg.mcpName).toBe('io.github.Defkil/godot-mcp');
    expect(server.name).toBe('io.github.Defkil/godot-mcp');
  });

  it('keeps the npm identifier in server.json aligned with package.json', async () => {
    const pkg = await readJson<PackageJson>('package.json');
    const server = await readJson<ServerJson>('server.json');

    const npmEntry = server.packages.find((entry) => entry.registryType === 'npm');
    expect(npmEntry?.identifier).toBe(pkg.name);
    expect(npmEntry?.version).toBe(pkg.version);
    expect(server.version).toBe(pkg.version);
  });

  it('keeps package-lock.json in sync with the new Defkil name and version', async () => {
    const pkg = await readJson<PackageJson>('package.json');
    const lock = await readJson<PackageLockJson>('package-lock.json');

    expect(lock.name).toBe(pkg.name);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].name).toBe(pkg.name);
    expect(lock.packages[''].version).toBe(pkg.version);
  });

  it('preserves the MIT license with both predecessor copyright notices', async () => {
    const pkg = await readJson<PackageJson>('package.json');
    expect(pkg.license).toBe('MIT');

    const license = await readFile(`${ROOT}/LICENSE`, 'utf8');
    // Tugcan Topaloglu authored the 158-tool immediate upstream this fork extends.
    // Solomon Elias authored the 20-tool original source.
    // Both copyright lines MUST stay in any Defkil-published artifact because
    // the project inherits code from both MIT-licensed works.
    expect(license).toMatch(/Copyright \(c\) 2025 Tugcan Topaloglu/);
    expect(license).toMatch(/Copyright \(c\) 2025 Solomon Elias/);
    expect(license).toMatch(/MIT License/);
  });

  it('describes itself as a Defkil fork with an authoritative bug tracker', async () => {
    const pkg = await readJson<PackageJson>('package.json');
    const server = await readJson<ServerJson>('server.json');

    // Description must not claim upstream authorship and must point users to
    // the Defkil-owned repository for issues and source.
    expect(pkg.description).not.toMatch(/tugcantopaloglu/i);
    expect(pkg.description).not.toMatch(/github\.com\/tugcantopaloglu/i);
    expect(server.description).not.toMatch(/tugcantopaloglu/i);
    expect(pkg.bugs?.url).toMatch(/github\.com\/Defkil\/godot-mcp/);
  });
});
