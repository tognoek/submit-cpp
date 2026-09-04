import type { FastifyInstance } from "fastify";
import { findCompiler } from "../compiler/index.js";
import type { AppPaths } from "../paths.js";

export function registerSettingsRoutes(app: FastifyInstance, paths: AppPaths): void {
  app.get("/api/health", async () => {
    const compiler = await findCompiler(paths.compiler);
    return {
      ok: Boolean(compiler),
      compiler: compiler
        ? { path: compiler.path, version: compiler.version }
        : null,
      dataDir: paths.data,
    };
  });
}
