import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ProblemManager } from "../problems/manager.js";
import { discardImport, getImport, importFromDirectory, importFromUploads } from "../import/index.js";
import { isDirectory } from "../import/parseTests.js";
import { buildProblemsZip } from "../export/zipProblems.js";
import { getTest } from "../database/index.js";
import type { Db } from "../database/index.js";
import type { AppPaths } from "../paths.js";

const DISPLAY = 12_000;

function previewItem(parsed: {
  name: string;
  code: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  checkerType: string;
  ioMode: string;
  inputFile: string;
  outputFile: string;
  ignoreCase: boolean;
  tests: { name: string }[];
  warnings: string[];
}) {
  return {
    name: parsed.name,
    code: parsed.code,
    timeLimitMs: parsed.timeLimitMs,
    memoryLimitMb: parsed.memoryLimitMb,
    checkerType: parsed.checkerType,
    ioMode: parsed.ioMode,
    inputFile: parsed.inputFile,
    outputFile: parsed.outputFile,
    ignoreCase: parsed.ignoreCase,
    testCount: parsed.tests.length,
    tests: parsed.tests.map((t) => ({ name: t.name })),
    warnings: parsed.warnings,
  };
}

function previewOf(item: { id: string; packages: Parameters<typeof previewItem>[0][] }) {
  const items = item.packages.map(previewItem);
  const first = items[0];
  return {
    importId: item.id,
    name: first.name,
    code: first.code,
    timeLimitMs: first.timeLimitMs,
    memoryLimitMb: first.memoryLimitMb,
    checkerType: first.checkerType,
    ioMode: first.ioMode,
    inputFile: first.inputFile,
    outputFile: first.outputFile,
    ignoreCase: first.ignoreCase,
    testCount: first.testCount,
    tests: first.tests,
    warnings: first.warnings,
    problemCount: items.length,
    items,
  };
}

async function readUploads(req: { parts: () => AsyncIterable<unknown> }): Promise<{
  fields: Record<string, string>;
  files: { relativePath: string; data: Buffer }[];
}> {
  const fields: Record<string, string> = {};
  const files: { relativePath: string; data: Buffer }[] = [];
  const paths: string[] = [];
  for await (const part of req.parts() as AsyncIterable<{
    type: string;
    fieldname: string;
    filename?: string;
    value?: unknown;
    toBuffer?: () => Promise<Buffer>;
  }>) {
    if (part.type === "file" && part.toBuffer && part.filename) {
      const data = await part.toBuffer();
      files.push({ relativePath: part.filename, data });
    } else if (part.type === "field") {
      const value = String(part.value ?? "");
      if (part.fieldname === "relativePath" || part.fieldname === "relativePaths") {
        paths.push(value);
      } else {
        fields[part.fieldname] = value;
      }
    }
  }
  if (paths.length && paths.length === files.length) {
    for (let i = 0; i < files.length; i++) files[i].relativePath = paths[i];
  }
  return { fields, files };
}

export function registerProblemRoutes(
  app: FastifyInstance,
  manager: ProblemManager,
  db: Db,
  paths: AppPaths,
): void {
  app.get("/api/problems", async () => manager.list());

  app.get("/api/problems/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const problem = manager.get(id);
    if (!problem) return reply.code(404).send({ error: "Problem not found" });
    const tests = manager.tests(id).map((t) => ({
      id: t.id,
      name: t.name,
      orderIndex: t.orderIndex,
    }));
    return { ...problem, tests };
  });

  app.put("/api/problems/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!manager.get(id)) return reply.code(404).send({ error: "Problem not found" });
    const body = req.body as { name?: string; timeLimitMs?: number; checkerType?: "token" | "exact" };
    return manager.update(id, body);
  });

  app.delete("/api/problems/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!manager.get(id)) return reply.code(404).send({ error: "Problem not found" });
    await manager.remove(id);
    return { ok: true };
  });

  app.post("/api/problems/bulk-delete", async (req, reply) => {
    const body = req.body as { ids?: number[] };
    const ids = [...new Set((body.ids || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
    if (!ids.length) return reply.code(400).send({ error: "Chưa chọn bài nào." });
    let deleted = 0;
    for (const id of ids) {
      if (!manager.get(id)) continue;
      await manager.remove(id);
      deleted += 1;
    }
    return { ok: true, deleted };
  });

  app.post("/api/problems/export", async (req, reply) => {
    const body = req.body as { ids?: number[] };
    const ids = [...new Set((body.ids || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
    if (!ids.length) return reply.code(400).send({ error: "Chưa chọn bài nào." });

    const packs: { problem: NonNullable<ReturnType<ProblemManager["get"]>>; tests: ReturnType<ProblemManager["tests"]> }[] = [];
    for (const id of ids) {
      const problem = manager.get(id);
      if (!problem) continue;
      packs.push({ problem, tests: manager.tests(id) });
    }
    if (!packs.length) return reply.code(404).send({ error: "Không tìm thấy bài đã chọn." });

    try {
      const zip = await buildProblemsZip(packs);
      const stamp = new Date().toISOString().slice(0, 10);
      const filename =
        packs.length === 1
          ? `${packs[0].problem.name.replace(/[<>:"/\\|?*]+/g, "_") || "problem"}.zip`
          : `problems_${packs.length}_${stamp}.zip`;
      return reply
        .header("Content-Type", "application/zip")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(zip);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export thất bại";
      return reply.code(500).send({ error: message });
    }
  });

  app.post("/api/problems/import", async (req, reply) => {
    const { fields, files } = await readUploads(req);
    if (files.length === 0) {
      return reply.code(400).send({ error: "Drop a ZIP file or a test folder." });
    }
    const fallback = fields.name || basename(files[0].relativePath).replace(/\.zip$/i, "");
    try {
      const item = await importFromUploads(paths.temp, files, fallback);
      return previewOf(item);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to import package";
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/api/problems/import-local", async (req, reply) => {
    const body = req.body as { path?: string; name?: string };
    if (!body.path) return reply.code(400).send({ error: "Missing path" });
    if (!(await isDirectory(body.path))) {
      return reply.code(400).send({ error: "Path is not a folder" });
    }
    try {
      const item = await importFromDirectory(paths.temp, body.path, body.name || basename(body.path));
      return previewOf(item);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to import folder";
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/api/problems", async (req, reply) => {
    const body = req.body as {
      importId?: string;
      name?: string;
      timeLimitMs?: number;
      checkerType?: "token" | "exact";
    };
    if (!body.importId) return reply.code(400).send({ error: "Missing importId" });
    const item = getImport(body.importId);
    if (!item) return reply.code(400).send({ error: "Import expired. Drop the package again." });
    try {
      const problems = await manager.commitImport(item, {
        name: body.name,
        timeLimitMs: body.timeLimitMs,
        checkerType: body.checkerType,
      });
      if (problems.length === 1) return problems[0];
      return { problems, count: problems.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create problem";
      return reply.code(500).send({ error: message });
    }
  });

  app.post("/api/problems/:id/reimport", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!manager.get(id)) return reply.code(404).send({ error: "Problem not found" });
    const body = req.body as { importId?: string };
    if (!body.importId) return reply.code(400).send({ error: "Missing importId" });
    const item = getImport(body.importId);
    if (!item) return reply.code(400).send({ error: "Import expired. Drop the package again." });
    return manager.reimport(id, item);
  });

  app.delete("/api/problems/import/:id", async (req) => {
    await discardImport((req.params as { id: string }).id);
    return { ok: true };
  });

  app.get("/api/problems/:id/tests/:testId", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const testId = Number((req.params as { testId: string }).testId);
    const test = getTest(db, id, testId);
    if (!test) return reply.code(404).send({ error: "Test not found" });
    const part = (req.query as { part?: string }).part || "both";
    const slice = async (file: string) => {
      const buf = await readFile(file);
      const truncated = buf.length > DISPLAY;
      const text = buf.subarray(0, DISPLAY).toString("utf8") + (truncated ? "\n…" : "");
      return { text, truncated, bytes: buf.length };
    };
    const payload: Record<string, unknown> = { id: test.id, name: test.name };
    if (part === "input" || part === "both") payload.input = await slice(test.inputPath);
    if (part === "expected" || part === "both") payload.expected = await slice(test.outputPath);
    return payload;
  });
}
