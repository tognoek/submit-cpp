import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { mkdir, readFile, rm, unlink, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { compileCpp, findCompiler } from "../compiler/index.js";
import { runBinary } from "../runner/index.js";
import { checkOutput } from "../checker/index.js";
import { stripBom } from "../checker/exact.js";
import type { JudgeResult, Problem, RunResult, TestCase, TestResult, Verdict, IoMode } from "../types.js";
import { log } from "../logger.js";

const DISPLAY_LIMIT = 4000;
const FILE_READ_LIMIT = 8 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 256 * 1024;

/** Lower number = worse (more severe) overall verdict. */
const VERDICT_RANK: Record<Verdict, number> = {
  COMPILATION_ERROR: 0,
  RUNTIME_ERROR: 1,
  MEMORY_LIMIT_EXCEEDED: 2,
  TIME_LIMIT_EXCEEDED: 3,
  WRONG_ANSWER: 4,
  PRESENTATION_ERROR: 5,
  ACCEPTED: 6,
  NOT_RUN: 7,
};

function worseVerdict(current: Verdict | null, next: Verdict): Verdict {
  if (!current) return next;
  return VERDICT_RANK[next] < VERDICT_RANK[current] ? next : current;
}

/** Resolve how a problem should receive input / produce output. */
export function resolveIo(problem: Pick<Problem, "ioMode" | "inputFile" | "outputFile">): {
  mode: Exclude<IoMode, "auto">;
  useStdin: boolean;
  useFile: boolean;
  inputName: string;
  outputName: string;
} {
  const inputName = (problem.inputFile || "stdin").trim() || "stdin";
  const outputName = (problem.outputFile || "stdout").trim() || "stdout";
  const namedFile =
    Boolean(inputName) &&
    inputName.toLowerCase() !== "stdin" &&
    inputName.toLowerCase() !== "con" &&
    inputName.toLowerCase() !== "stdout";

  let mode: Exclude<IoMode, "auto"> = "stdio";
  if (problem.ioMode === "file") mode = "file";
  else if (problem.ioMode === "stdio") mode = "stdio";
  else mode = namedFile ? "file" : "stdio"; // auto

  if (mode === "file") {
    return { mode, useStdin: false, useFile: true, inputName, outputName };
  }
  return {
    mode: "stdio",
    useStdin: true,
    useFile: false,
    inputName: "stdin",
    outputName: "stdout",
  };
}

function truncate(s: string): { text: string; truncated: boolean } {
  if (s.length <= DISPLAY_LIMIT) return { text: s, truncated: false };
  return { text: s.slice(0, DISPLAY_LIMIT) + "\n…", truncated: true };
}

async function readLimited(path: string): Promise<string> {
  try {
    const buf = await readFile(path);
    const text =
      buf.length > FILE_READ_LIMIT
        ? buf.subarray(0, FILE_READ_LIMIT).toString("utf8")
        : buf.toString("utf8");
    return stripBom(text);
  } catch {
    return "";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    /* missing is fine */
  }
}

/** Windows may briefly lock .OUT after process exit — retry a few times. */
async function readOutputWithRetry(path: string, attempts = 8): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    if (await exists(path)) {
      const text = await readLimited(path);
      // Empty file is valid (e.g. expected empty output); only retry if missing.
      return text;
    }
    await new Promise((r) => setTimeout(r, 15 + i * 10));
  }
  return "";
}

function prepareSource(source: string): string {
  return stripBom(source).replace(/^\uFEFF/, "");
}

export async function runCustom(options: {
  source: string;
  input: string;
  timeLimitMs: number;
  tempRoot: string;
  compilerRoot?: string;
}): Promise<RunResult> {
  const compiler = await findCompiler(options.compilerRoot);
  if (!compiler) throw new Error("C++ compiler not found");

  const workDir = join(options.tempRoot, `run-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  try {
    const srcFile = join(workDir, "solution.cpp");
    const exePath = join(workDir, process.platform === "win32" ? "solution.exe" : "solution");
    const stdinFile = join(workDir, "stdin.txt");

    await writeFile(srcFile, prepareSource(options.source));
    await writeFile(stdinFile, options.input ?? "");

    const comp = await compileCpp({ compiler, sourcePath: srcFile, exePath, cwd: workDir });
    if (!comp.ok) {
      return {
        output: "",
        stderr: "",
        exitCode: null,
        timeMs: 0,
        timedOut: false,
        compilerOutput: comp.output,
        truncated: false,
      };
    }

    // Custom run always uses keyboard I/O (stdin/stdout).
    const run = await runBinary({
      exePath,
      cwd: workDir,
      stdinPath: stdinFile,
      timeLimitMs: options.timeLimitMs,
      binDir: compiler.binDir,
    });

    const out = truncate(run.stdout);
    const err = truncate(run.stderr);

    return {
      output: out.text,
      stderr: err.text,
      exitCode: run.exitCode,
      timeMs: Math.round(run.timeMs),
      timedOut: run.timedOut,
      compilerOutput: "",
      truncated: out.truncated || err.truncated,
    };
  } finally {
    for (let i = 0; i < 6; i++) {
      try {
        await rm(workDir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 80));
      }
    }
  }
}

export async function judgeSubmission(options: {
  source: string;
  problem: Problem;
  tests: TestCase[];
  tempRoot: string;
  compilerRoot?: string;
}): Promise<JudgeResult> {
  const compiler = await findCompiler(options.compilerRoot);
  if (!compiler) {
    return {
      status: "COMPILATION_ERROR",
      compiler_output:
        "Bundled C++ compiler was not found. Run npm run setup (development) or use a packaged build that includes compiler/.",
      tests: [],
    };
  }

  const workDir = join(options.tempRoot, `sub_${randomUUID()}`);
  const sourcePath = join(workDir, "main.cpp");
  const exePath = join(workDir, process.platform === "win32" ? "main.exe" : "main");
  await mkdir(workDir, { recursive: true });

  try {
    await writeFile(sourcePath, prepareSource(options.source), "utf8");
    const compiled = await compileCpp({
      compiler,
      sourcePath,
      exePath,
      cwd: workDir,
    });
    if (!compiled.ok) {
      log.info("Compilation error");
      return {
        status: "COMPILATION_ERROR",
        compiler_output: compiled.output,
        tests: [],
      };
    }

    const results: TestResult[] = [];
    let worst: Verdict | null = null;
    const io = resolveIo(options.problem);
    const limit = Math.max(100, Number(options.problem.timeLimitMs) || 1000);

    log.info(
      `Judge ${options.problem.name}: ${options.tests.length} tests, TL=${limit}ms, io=${io.mode}` +
        (io.useFile ? ` (${io.inputName}→${io.outputName})` : " (stdin→stdout)"),
    );

    for (let i = 0; i < options.tests.length; i++) {
      const test = options.tests[i];
      const stagedIn = join(workDir, io.inputName);
      const stagedOut = join(workDir, io.outputName);

      // Clean leftovers from previous test (especially Windows file locks).
      await safeUnlink(stagedOut);
      if (io.useFile) {
        await safeUnlink(stagedIn);
        await copyFile(test.inputPath, stagedIn);
      }

      const inputRaw = await readLimited(test.inputPath);
      const inp = truncate(inputRaw);

      const run = await runBinary({
        exePath,
        cwd: workDir,
        stdinPath: io.useStdin ? test.inputPath : undefined,
        timeLimitMs: limit,
        binDir: compiler.binDir,
      });

      if (run.timedOut) {
        worst = worseVerdict(worst, "TIME_LIMIT_EXCEEDED");
        results.push({
          name: test.name,
          status: "TIME_LIMIT_EXCEEDED",
          time_ms: limit,
          exit_code: run.exitCode,
          input: inp.text,
          stderr: truncate(run.stderr).text,
          truncated: inp.truncated,
        });
        continue;
      }

      // Non-zero exit / signal / spawn failure ⇒ runtime error.
      const crashed = run.exitCode === null || run.exitCode !== 0 || Boolean(run.signal);
      if (crashed) {
        worst = worseVerdict(worst, "RUNTIME_ERROR");
        const err = truncate(run.stderr);
        results.push({
          name: test.name,
          status: "RUNTIME_ERROR",
          time_ms: Math.round(run.timeMs),
          exit_code: run.exitCode,
          input: inp.text,
          stderr: err.text,
          truncated: inp.truncated || err.truncated,
        });
        continue;
      }

      // File mode: only .OUT counts. Stdio mode: only stdout counts.
      const actual = io.useFile ? await readOutputWithRetry(stagedOut) : stripBom(run.stdout);
      const expected = await readLimited(test.outputPath);
      const checked = checkOutput(
        actual,
        expected,
        options.problem.checkerType,
        options.problem.ignoreCase,
      );

      if (checked.ok) {
        results.push({
          name: test.name,
          status: "ACCEPTED",
          time_ms: Math.round(run.timeMs),
          exit_code: run.exitCode,
          input: inp.text,
          expected: truncate(expected).text,
          actual: truncate(actual).text,
          truncated: inp.truncated,
        });
        continue;
      }

      const status: Verdict =
        options.problem.checkerType === "exact" && checked.presentationError
          ? "PRESENTATION_ERROR"
          : "WRONG_ANSWER";
      worst = worseVerdict(worst, status);
      const exp = truncate(expected);
      const act = truncate(actual);
      results.push({
        name: test.name,
        status,
        time_ms: Math.round(run.timeMs),
        exit_code: run.exitCode,
        input: inp.text,
        expected: exp.text,
        actual: act.text,
        truncated: inp.truncated || exp.truncated || act.truncated,
      });
    }

    const finalStatus = worst ?? (results.length ? "ACCEPTED" : "WRONG_ANSWER");
    const accepted = results.filter((t) => t.status === "ACCEPTED").length;
    return {
      status: finalStatus,
      compiler_output: "",
      tests: results,
      message: `${accepted}/${results.length} tests passed.`,
    };
  } finally {
    for (let i = 0; i < 6; i++) {
      try {
        await rm(workDir, { recursive: true, force: true });
        break;
      } catch (err) {
        if (i === 5) log.warn("Failed to cleanup submission temp dir", err);
        await new Promise((r) => setTimeout(r, 80));
      }
    }
  }
}
