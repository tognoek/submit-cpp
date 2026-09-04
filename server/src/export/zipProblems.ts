import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import type { Problem, TestCase } from "../types.js";

function sanitizeFolder(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").replace(/\.+$/, "").trim();
  return cleaned.slice(0, 80) || "Problem";
}

function testFolderName(test: TestCase, index: number): string {
  const n = test.name.trim();
  if (/^test\s*\d+$/i.test(n.replace(/\s+/g, "")) || /^(t|test)[-_]?\d+$/i.test(n)) {
    return n.replace(/\s+/g, "");
  }
  return `Test${String(index).padStart(2, "0")}`;
}

function settingsXml(problem: Problem): string {
  const seconds = Math.max(0.001, problem.timeLimitMs / 1000);
  const useStd = problem.ioMode === "stdio";
  const evaluator =
    problem.checkerType === "exact"
      ? "Exact"
      : problem.ignoreCase
        ? "IgnoreCase"
        : "Token";
  return (
    `<ExamInformation Name="${escapeXml(problem.name)}" ` +
    `InputFile="${escapeXml(problem.inputFile)}" ` +
    `OutputFile="${escapeXml(problem.outputFile)}" ` +
    `UseStdIn="${useStd}" UseStdOut="${useStd}" ` +
    `TimeLimit="${seconds}" MemoryLimit="${problem.memoryLimitMb}" ` +
    `EvaluatorName="${evaluator}" />\n`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function buildProblemsZip(
  problems: { problem: Problem; tests: TestCase[] }[],
): Promise<Buffer> {
  const zip = new JSZip();
  const usedNames = new Map<string, number>();

  for (const { problem, tests } of problems) {
    let folder = sanitizeFolder(problem.name || problem.code || `Problem${problem.id}`);
    const count = (usedNames.get(folder.toLowerCase()) || 0) + 1;
    usedNames.set(folder.toLowerCase(), count);
    if (count > 1) folder = `${folder}_${count}`;

    const root = zip.folder(folder);
    if (!root) continue;

    root.file("Settings.cfg", settingsXml(problem));

    const sorted = [...tests].sort((a, b) => a.orderIndex - b.orderIndex);
    for (let i = 0; i < sorted.length; i++) {
      const test = sorted[i];
      const tf = root.folder(testFolderName(test, i));
      if (!tf) continue;
      const input = await readFile(test.inputPath);
      const output = await readFile(test.outputPath);
      tf.file(problem.inputFile || `${problem.code}.INP`, input);
      tf.file(problem.outputFile || `${problem.code}.OUT`, output);
    }
  }

  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}
