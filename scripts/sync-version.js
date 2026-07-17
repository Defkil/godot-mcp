import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function readJson(rootDir, filename) {
  return JSON.parse(await readFile(path.join(rootDir, filename), 'utf8'));
}

async function writeJson(rootDir, filename, value) {
  await writeFile(path.join(rootDir, filename), `${JSON.stringify(value, null, 2)}\n`);
}

export async function syncVersions(rootDir = process.cwd()) {
  const packageJson = await readJson(rootDir, 'package.json');
  const packageLock = await readJson(rootDir, 'package-lock.json');
  const server = await readJson(rootDir, 'server.json');
  const { name, version } = packageJson;

  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('package.json must contain a name');
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('package.json must contain a version');
  }

  packageLock.name = name;
  packageLock.version = version;
  if (packageLock.packages && packageLock.packages['']) {
    packageLock.packages[''].name = name;
    packageLock.packages[''].version = version;
  }

  server.version = version;
  for (const entry of server.packages) {
    if (entry.registryType === 'npm') {
      entry.identifier = name;
    }
    entry.version = version;
  }

  await Promise.all([
    writeJson(rootDir, 'package-lock.json', packageLock),
    writeJson(rootDir, 'server.json', server),
  ]);
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);

if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await syncVersions();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
