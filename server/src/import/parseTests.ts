import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { parseSettingsCfg } from "./settings.js";
import type { ParsedPackage } from "../types.js";

const SKIP_DIR = new Set(["__macosx", ".git", "node_modules"]);
const SKIP_FILE = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

type FoundFile = { abs: string; rel: string; base: string; ext: string; dir: string };

function kindOf(ext: string, base: string): "in" | "out" | "cfg" | "other" {
  const e = ext.toLowerCase();
  const b = base.toLowerCase();
  if (b === "settings.cfg" || e === ".cfg") return "cfg";
  if (e === ".inp" || e === ".in" || e === ".dat") return "in";
  if (e === ".out" || e === ".ans" || e === ".a" || e === ".ok" || e === ".sol") return "out";
  return "other";
}

async function walk(dir: string, root: string, out: FoundFile[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name.toLowerCase())) continue;
      await walk(abs, root, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILE.has(entry.name.toLowerCase())) continue;
    const rel = relative(root, abs).replace(/\\/g, "/");
    out.push({
      abs,
      rel,
      base: entry.name,
      ext: extname(entry.name),
      dir: dirname(abs),
    });
  }
}

function stem(name: string): string {
  const e = extname(name);
  return e ? name.slice(0, -e.length) : name;
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function isTestFolderName(name: string): boolean {
  const compact = name.replace(/\s+/g, "");
  return /^test\s*\d+$/i.test(compact) || /^(t|test)[-_]?\d+$/i.test(compact);
}

function parentTestName(file: FoundFile, root: string): string | null {
  const rel = relative(root, file.dir).replace(/\\/g, "/");
  const parts = rel.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && isTestFolderName(last)) return last;
  return null;
}

function pairKey(file: FoundFile, root: string): string {
  const folder = parentTestName(file, root);
  if (folder) {
    // Full relative dir so Test00 under different parents never collide
    return relative(root, file.dir).replace(/\\/g, "/").toLowerCase();
  }
  return `${file.dir.toLowerCase()}::${stem(file.base).toLowerCase()}`;
}

function displayName(inFile: FoundFile, root: string): string {
  return parentTestName(inFile, root) || stem(inFile.base);
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = values[0] || "";
  let n = 0;
  for (const [k, c] of counts) {
    if (c > n) {
      best = k;
      n = c;
    }
  }
  return best;
}

function packageNameFromRoot(root: string, files: FoundFile[]): string {
  const rels = files.map((f) => f.rel.split("/")[0]).filter(Boolean);
  if (rels.length && rels.every((p) => p === rels[0]) && files.some((f) => f.rel.includes("/"))) {
    const only = rels[0];
    if (only && only.toLowerCase() !== "tests") return only;
  }
  return basename(root);
}

/** Directories that look like a single Themis-style problem package. */
export async function findProblemRoots(root: string): Promise<string[]> {
  const found: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs: string[] = [];
    let hasIn = false;
    let hasOut = false;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIR.has(entry.name.toLowerCase())) continue;
        subdirs.push(entry.name);
      } else if (entry.isFile()) {
        if (SKIP_FILE.has(entry.name.toLowerCase())) continue;
        const kind = kindOf(extname(entry.name), entry.name);
        if (kind === "in") hasIn = true;
        if (kind === "out") hasOut = true;
      }
    }

    const hasTestSubdirs = subdirs.some(isTestFolderName);
    if (hasTestSubdirs || (hasIn && hasOut)) {
      found.push(dir);
      return;
    }

    for (const name of subdirs) {
      await visit(join(dir, name));
    }
  }

  await visit(root);
  found.sort(naturalCompare);
  return found;
}

async function parseOnePackage(root: string, fallbackName = ""): Promise<ParsedPackage> {
  const files: FoundFile[] = [];
  await walk(root, root, files);
  if (files.length === 0) {
    throw new Error("The package is empty.");
  }

  let settings = null;
  const cfg = files.find((f) => f.base.toLowerCase() === "settings.cfg");
  if (cfg) {
    try {
      settings = parseSettingsCfg(await readFile(cfg.abs));
    } catch {
      settings = null;
    }
  }

  const inputs = files.filter((f) => kindOf(f.ext, f.base) === "in");
  const outputs = files.filter((f) => kindOf(f.ext, f.base) === "out");
  const outMap = new Map<string, FoundFile[]>();
  for (const o of outputs) {
    const key = pairKey(o, root);
    const list = outMap.get(key) || [];
    list.push(o);
    outMap.set(key, list);
  }

  const warnings: string[] = [];
  const tests: { name: string; inputPath: string; outputPath: string }[] = [];
  const usedOut = new Set<string>();

  for (const input of inputs) {
    const key = pairKey(input, root);
    const candidates = (outMap.get(key) || []).filter((o) => !usedOut.has(o.abs));
    let output = candidates.find((o) => stem(o.base).toLowerCase() === stem(input.base).toLowerCase());
    if (!output) output = candidates[0];
    if (!output) {
      warnings.push(`${displayName(input, root)} has input but no matching output.`);
      continue;
    }
    usedOut.add(output.abs);
    tests.push({
      name: displayName(input, root),
      inputPath: input.abs,
      outputPath: output.abs,
    });
  }

  tests.sort((a, b) => naturalCompare(a.name, b.name));

  if (tests.length === 0) {
    throw new Error("No test cases found. Expected pairs such as TOIUU.INP/TOIUU.OUT inside Test00, Test01, …");
  }

  const inNames = inputs.map((f) => stem(f.base)).filter(Boolean);
  const codeFromFiles = mostCommon(inNames);
  const folderName = packageNameFromRoot(root, files);
  const name = settings?.name || fallbackName || folderName || codeFromFiles || "Problem";
  const code = stem(settings?.inputFile || "") || codeFromFiles || name;
  const inputFile = settings?.inputFile || `${code}.INP`;
  const outputFile = settings?.outputFile || `${code}.OUT`;

  return {
    name,
    code,
    timeLimitMs: settings?.timeLimitMs ?? 1000,
    memoryLimitMb: settings?.memoryLimitMb ?? 256,
    checkerType: settings?.checkerType ?? "token",
    ioMode: settings?.ioMode ?? "auto",
    inputFile,
    outputFile,
    ignoreCase: settings?.ignoreCase ?? false,
    tests,
    warnings,
  };
}

/** Parse one problem folder (or a contest folder — returns the first / only package). */
export async function parseTestPackage(root: string, fallbackName = ""): Promise<ParsedPackage> {
  const all = await parseTestPackages(root, fallbackName);
  return all[0];
}

/**
 * Parse a folder/ZIP root. If it contains multiple problem packages
 * (e.g. GOM/BAI1, GOM/BAI2), returns one ParsedPackage per problem.
 */
export async function parseTestPackages(root: string, fallbackName = ""): Promise<ParsedPackage[]> {
  const roots = await findProblemRoots(root);
  const targets = roots.length > 0 ? roots : [root];

  if (targets.length === 1) {
    const only = targets[0];
    const name =
      fallbackName ||
      (only === root ? "" : basename(only)) ||
      basename(root);
    return [await parseOnePackage(only, name)];
  }

  const packages: ParsedPackage[] = [];
  const errors: string[] = [];
  for (const dir of targets) {
    try {
      packages.push(await parseOnePackage(dir, basename(dir)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${basename(dir)}: ${msg}`);
    }
  }

  if (packages.length === 0) {
    throw new Error(
      errors.length
        ? `Không tìm thấy bài hợp lệ. ${errors.join(" · ")}`
        : "No test cases found. Expected pairs such as TOIUU.INP/TOIUU.OUT inside Test00, Test01, …",
    );
  }

  packages.sort((a, b) => naturalCompare(a.name, b.name));
  return packages;
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
