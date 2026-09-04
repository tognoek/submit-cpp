import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { compilerEnv } from "../compiler/index.js";

const MAX_CAPTURE = 8 * 1024 * 1024;

export type RunResult = {
  timedOut: boolean;
  exitCode: number | null;
  signal: string | null;
  timeMs: number;
  stdout: string;
  stderr: string;
};

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        process.kill(pid, "SIGKILL");
      }
    }
  } catch {
    // already exited
  }
}

function collect(stream: NodeJS.ReadableStream, limit: number): { text: () => string } {
  const chunks: Buffer[] = [];
  let size = 0;
  stream.on("data", (chunk: Buffer) => {
    if (size >= limit) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const room = limit - size;
    chunks.push(buf.length > room ? buf.subarray(0, room) : buf);
    size += Math.min(buf.length, room);
  });
  return {
    text: () => Buffer.concat(chunks).toString("utf8"),
  };
}

export function runBinary(options: {
  exePath: string;
  cwd: string;
  stdinPath?: string;
  timeLimitMs: number;
  binDir: string;
}): Promise<RunResult> {
  // Grace avoids false TLE from OS scheduling near the limit.
  const graceMs = 50;
  // Extra budget if 'spawn' event is delayed; absolute kill still happens.
  const spawnBudgetMs = 2000;
  const wallLimit = options.timeLimitMs + graceMs;

  return new Promise((resolve) => {
    const callStarted = process.hrtime.bigint();
    let started: bigint | null = null;

    const child = spawn(options.exePath, [], {
      cwd: options.cwd,
      env: compilerEnv(options.binDir),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdout = collect(child.stdout, MAX_CAPTURE);
    const stderr = collect(child.stderr, MAX_CAPTURE);
    child.stdin.on("error", () => {});
    child.stdout.on("error", () => {});
    child.stderr.on("error", () => {});

    let input: ReturnType<typeof createReadStream> | null = null;
    if (options.stdinPath) {
      input = createReadStream(options.stdinPath);
      input.on("error", () => {
        try {
          child.stdin.end();
        } catch {
          /* ignore */
        }
      });
      input.pipe(child.stdin);
    } else {
      // File I/O: close stdin so cin cannot hang forever.
      child.stdin.end();
    }

    let timedOut = false;
    let finished = false;
    let limitTimer: ReturnType<typeof setTimeout> | null = null;

    const markTimeoutAndKill = () => {
      timedOut = true;
      killTree(child.pid);
    };

    // Absolute watchdog (covers missing/late spawn events).
    const absoluteTimer = setTimeout(markTimeoutAndKill, wallLimit + spawnBudgetMs);

    const armLimitTimer = () => {
      if (limitTimer) return;
      limitTimer = setTimeout(markTimeoutAndKill, wallLimit);
    };

    child.on("spawn", () => {
      started = process.hrtime.bigint();
      armLimitTimer();
    });

    const elapsedMs = () => {
      const base = started ?? callStarted;
      return Number(process.hrtime.bigint() - base) / 1e6;
    };

    const finish = (exitCode: number | null, signal: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(absoluteTimer);
      if (limitTimer) clearTimeout(limitTimer);
      input?.destroy();

      const timeMs = elapsedMs();
      const overLimit = timedOut || timeMs > options.timeLimitMs;

      const done = () =>
        resolve({
          timedOut: overLimit,
          exitCode,
          signal,
          timeMs: overLimit ? options.timeLimitMs : timeMs,
          stdout: stdout.text(),
          stderr: stderr.text(),
        });

      // Brief delay after kill so handles / files flush on Windows.
      if (overLimit) setTimeout(done, 40);
      else done();
    };

    child.on("error", (err) => {
      finish(null, err.message);
    });
    child.on("close", (code, signal) => {
      finish(code, signal);
    });
  });
}
