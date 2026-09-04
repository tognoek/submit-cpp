import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { ensureDirs, getPaths } from "./paths.js";
import { initLogger, log } from "./logger.js";
import { openDatabase } from "./database/index.js";
import { createProblemManager } from "./problems/manager.js";
import { registerProblemRoutes } from "./api/problems.js";
import { registerJudgeRoutes } from "./api/judge.js";
import { registerSettingsRoutes } from "./api/settings.js";
import { findCompiler } from "./compiler/index.js";

const DEFAULT_PORT = Number(process.env.JUDGE_PORT || 27181);

function openBrowser(url: string): void {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function pickPort(host: string): Promise<number> {
  for (let p = DEFAULT_PORT; p < DEFAULT_PORT + 20; p++) {
    if (await portFree(p, host)) return p;
  }
  throw new Error("No free port found");
}

async function cleanupTemp(tempDir: string): Promise<void> {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function main(): Promise<void> {
  const paths = getPaths();
  await ensureDirs(paths);
  initLogger(paths.logFile);
  await cleanupTemp(paths.temp);
  await ensureDirs(paths);

  const db = openDatabase(paths.dbFile);
  const manager = createProblemManager(db, paths);
  const compiler = await findCompiler(paths.compiler);

  const app = Fastify({
    logger: false,
    requestTimeout: 300_000,
    bodyLimit: 120 * 1024 * 1024,
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024,
      files: 400,
      fields: 400,
    },
  });

  registerProblemRoutes(app, manager, db, paths);
  registerJudgeRoutes(app, manager, paths, db);
  registerSettingsRoutes(app, paths);

  const distWeb = join(paths.root, "dist", "web");
  const portableWeb = join(paths.root, "web");
  const packaged = Boolean(process.env.JUDGE_ROOT);
  const webDir = existsSync(join(distWeb, "index.html"))
    ? distWeb
    : packaged && existsSync(join(portableWeb, "index.html"))
      ? portableWeb
      : "";

  if (webDir) {
    await app.register(fastifyStatic, {
      root: webDir,
      prefix: "/",
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    log.error("Request failed", err);
    const status = typeof err.statusCode === "number" && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(status).send({ error: err.message || "Internal error" });
  });

  const host = "127.0.0.1";
  const port = await pickPort(host);
  await app.listen({ host, port });
  app.server.timeout = 300_000;
  app.server.headersTimeout = 310_000;
  const url = `http://${host}:${port}`;
  log.info(`Chấm C++ running at ${url}`);
  if (compiler) {
    log.info(`Compiler: ${compiler.version}`);
    log.debug(compiler.path);
  } else {
    log.warn("Bundled compiler not found. Run npm run setup.");
  }

  const shouldOpen =
    process.env.JUDGE_OPEN_BROWSER === "1" || process.env.NODE_ENV === "production";
  if (shouldOpen) openBrowser(url);
}

main().catch((err) => {
  log.error("Fatal", err);
  process.exit(1);
});
