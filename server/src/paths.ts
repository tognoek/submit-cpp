import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function isProjectRoot(dir: string): boolean {
  return (
    existsSync(join(dir, "package.json")) ||
    existsSync(join(dir, "compiler")) ||
    existsSync(join(dir, "Judge.exe"))
  );
}

export function getAppRoot(): string {
  if (process.env.JUDGE_ROOT) {
    return resolve(process.env.JUDGE_ROOT);
  }
  const candidates = [
    process.cwd(),
    join(here, "../.."),
    join(here, "../../.."),
    dirname(process.execPath),
  ];
  for (const dir of candidates) {
    if (isProjectRoot(dir)) return resolve(dir);
  }
  return resolve(process.cwd());
}

export type AppPaths = {
  root: string;
  data: string;
  dbFile: string;
  problems: string;
  temp: string;
  logs: string;
  logFile: string;
  compiler: string;
  web: string;
};

export function getPaths(root = getAppRoot()): AppPaths {
  const data = join(root, "data");
  const logs = join(root, "logs");
  return {
    root,
    data,
    dbFile: join(data, "judge.db"),
    problems: join(data, "problems"),
    temp: join(root, "temp"),
    logs,
    logFile: join(logs, "judge.log"),
    compiler: join(root, "compiler"),
    web: existsSync(join(root, "web", "index.html"))
      ? join(root, "dist", "web")
      : join(root, "web"),
  };
}

export async function ensureDirs(paths: AppPaths): Promise<void> {
  await mkdir(paths.data, { recursive: true });
  await mkdir(paths.problems, { recursive: true });
  await mkdir(paths.temp, { recursive: true });
  await mkdir(paths.logs, { recursive: true });
}

export function safeResolve(root: string, rel: string): string {
  const normalized = rel.replace(/\\/g, "/");
  if (isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error("Absolute paths are not allowed in archives");
  }
  const resolved = resolve(root, normalized);
  const rootResolved = resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + "\\") && !resolved.startsWith(rootResolved + "/")) {
    throw new Error("Path traversal is not allowed");
  }
  return resolved;
}
