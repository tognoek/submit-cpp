import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

let logFile = "";

export function initLogger(file: string): void {
  logFile = file;
}

function stamp(level: string, msg: string): string {
  return `${new Date().toISOString()} [${level}] ${msg}`;
}

async function write(level: string, msg: string, extra?: unknown): Promise<void> {
  const line = extra === undefined ? stamp(level, msg) : `${stamp(level, msg)} ${stringify(extra)}`;
  if (level !== "debug") {
    console.log(line);
  }
  if (!logFile) return;
  try {
    await mkdir(dirname(logFile), { recursive: true });
    await appendFile(logFile, line + "\n", "utf8");
  } catch {
    // ignore logging failures
  }
}

function stringify(extra: unknown): string {
  if (extra instanceof Error) return extra.stack || extra.message;
  try {
    return JSON.stringify(extra);
  } catch {
    return String(extra);
  }
}

export const log = {
  info: (msg: string, extra?: unknown) => void write("info", msg, extra),
  warn: (msg: string, extra?: unknown) => void write("warn", msg, extra),
  error: (msg: string, extra?: unknown) => void write("error", msg, extra),
  debug: (msg: string, extra?: unknown) => void write("debug", msg, extra),
};
