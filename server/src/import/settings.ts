import { inflateSync } from "node:zlib";
import type { CheckerType, IoMode } from "../types.js";

export type ExamSettings = {
  name: string;
  inputFile: string;
  outputFile: string;
  useStdIn: boolean;
  useStdOut: boolean;
  timeLimitMs: number;
  memoryLimitMb: number;
  checkerType: CheckerType;
  ignoreCase: boolean;
  ioMode: IoMode;
  testNames: string[];
};

function decodeXml(buf: Buffer): string | null {
  const tryInflate = (): string | null => {
    try {
      return inflateSync(buf).toString("utf8");
    } catch {
      return null;
    }
  };
  if (buf.length >= 2 && buf[0] === 0x78 && (buf[1] === 0x01 || buf[1] === 0x9c || buf[1] === 0xda)) {
    const inflated = tryInflate();
    if (inflated) return inflated;
  }
  const utf8 = buf.toString("utf8");
  if (utf8.includes("<ExamInformation") || utf8.includes("TimeLimit")) return utf8;
  const inflated = tryInflate();
  if (inflated) return inflated;
  const utf16 = buf.toString("utf16le").replace(/^\uFEFF/, "");
  if (utf16.includes("<") || utf16.includes("TimeLimit")) return utf16;
  return utf8 || null;
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  return tag.match(re)?.[1] ?? null;
}

function parseSecondsOrMs(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  if (n <= 180) return Math.round(n * 1000);
  return Math.round(n);
}

function parseMemoryMb(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

function looksIgnoreCase(evaluator: string): boolean {
  return /ignorecase|ignore_case|words/i.test(evaluator);
}

export function parseSettingsCfg(buf: Buffer): ExamSettings | null {
  const xml = decodeXml(buf);
  if (!xml) return null;
  const examMatch = xml.match(/<ExamInformation\b([^>]*)>/i);
  if (!examMatch) return null;
  const tag = examMatch[1];
  const name = attr(tag, "Name") || "";
  const inputFile = attr(tag, "InputFile") || "";
  const outputFile = attr(tag, "OutputFile") || "";
  const useStdIn = (attr(tag, "UseStdIn") || "false").toLowerCase() === "true";
  const useStdOut = (attr(tag, "UseStdOut") || "false").toLowerCase() === "true";
  const evaluator = attr(tag, "EvaluatorName") || "";
  const testNames = [...xml.matchAll(/<TestCase\b([^>]*)>/gi)]
    .map((m) => attr(m[1], "Name"))
    .filter((v): v is string => Boolean(v));

  let ioMode: IoMode = "auto";
  if (!useStdIn && !useStdOut && (inputFile || outputFile)) ioMode = "file";
  else if (useStdIn && useStdOut) ioMode = "stdio";

  return {
    name,
    inputFile,
    outputFile,
    useStdIn,
    useStdOut,
    timeLimitMs: parseSecondsOrMs(attr(tag, "TimeLimit"), 1000),
    memoryLimitMb: parseMemoryMb(attr(tag, "MemoryLimit"), 256),
    checkerType: "token",
    ignoreCase: looksIgnoreCase(evaluator),
    ioMode,
    testNames,
  };
}
