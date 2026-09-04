import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { extractZipSafe, looksLikeZip, saveUploadedFile } from "./zip.js";
import { isDirectory, parseTestPackages } from "./parseTests.js";
import type { ParsedPackage } from "../types.js";
import { log } from "../logger.js";

export type StoredImport = {
  id: string;
  dir: string;
  /** One or more problem packages discovered under dir. */
  packages: ParsedPackage[];
  createdAt: number;
};

/** First / only package — used by reimport and single-problem flows. */
export function primaryPackage(item: StoredImport): ParsedPackage {
  return item.packages[0];
}

const imports = new Map<string, StoredImport>();
const TTL_MS = 30 * 60 * 1000;

function sweep(): void {
  const now = Date.now();
  for (const [id, item] of imports) {
    if (now - item.createdAt > TTL_MS) {
      imports.delete(id);
      void rm(item.dir, { recursive: true, force: true });
    }
  }
}

export function getImport(id: string): StoredImport | null {
  sweep();
  return imports.get(id) ?? null;
}

export async function discardImport(id: string): Promise<void> {
  const item = imports.get(id);
  imports.delete(id);
  if (item) await rm(item.dir, { recursive: true, force: true });
}

function storePackages(
  id: string,
  dir: string,
  packages: ParsedPackage[],
): StoredImport {
  const item: StoredImport = { id, dir, packages, createdAt: Date.now() };
  imports.set(id, item);
  if (packages.length === 1) {
    log.info(`Parsed package ${packages[0].name} with ${packages[0].tests.length} tests`);
  } else {
    log.info(
      `Parsed ${packages.length} packages: ${packages.map((p) => `${p.name}(${p.tests.length})`).join(", ")}`,
    );
  }
  return item;
}

export async function importFromDirectory(
  tempRoot: string,
  sourceDir: string,
  fallbackName: string,
): Promise<StoredImport> {
  const packages = await parseTestPackages(sourceDir, fallbackName);
  const id = randomUUID();
  return storePackages(id, sourceDir, packages);
}

export async function importFromZip(
  tempRoot: string,
  zipPath: string,
  fallbackName: string,
): Promise<StoredImport> {
  const id = randomUUID();
  const dir = join(tempRoot, `import_${id}`);
  await mkdir(dir, { recursive: true });
  try {
    await extractZipSafe(zipPath, dir);
    const packages = await parseTestPackages(dir, fallbackName);
    return storePackages(id, dir, packages);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}

export async function importFromUploads(
  tempRoot: string,
  files: { relativePath: string; data: Buffer }[],
  fallbackName: string,
): Promise<StoredImport> {
  if (files.length === 1 && looksLikeZip(files[0].relativePath)) {
    const id = randomUUID();
    const zipPath = join(tempRoot, `upload_${id}.zip`);
    await saveUploadedFile(tempRoot, `upload_${id}.zip`, files[0].data);
    try {
      return await importFromZip(tempRoot, zipPath, fallbackName);
    } finally {
      await rm(zipPath, { force: true });
    }
  }

  const id = randomUUID();
  const dir = join(tempRoot, `import_${id}`);
  await mkdir(dir, { recursive: true });
  try {
    for (const file of files) {
      if (!file.relativePath || file.relativePath.endsWith("/")) continue;
      await saveUploadedFile(dir, file.relativePath, file.data);
    }
    const packages = await parseTestPackages(dir, fallbackName);
    return storePackages(id, dir, packages);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}

export { isDirectory, looksLikeZip };
