import type { FastifyInstance } from "fastify";
import { judgeSubmission, runCustom, MAX_SOURCE_BYTES } from "../judge/engine.js";
import type { ProblemManager } from "../problems/manager.js";
import type { AppPaths } from "../paths.js";
import type { Db } from "../database/index.js";
import { insertSubmission, listSubmissions, getSubmission, countSubmissions, problemStats, monthlyActivity, dailyActivity } from "../database/index.js";

export function registerJudgeRoutes(
  app: FastifyInstance,
  manager: ProblemManager,
  paths: AppPaths,
  db: Db,
): void {
  app.post("/api/judge", async (req, reply) => {
    const body = req.body as { problemId?: number; source?: string };
    const problemId = Number(body.problemId);
    const source = body.source ?? "";
    if (!problemId || !Number.isFinite(problemId)) {
      return reply.code(400).send({ error: "Select a problem first." });
    }
    if (!source.trim()) {
      return reply.code(400).send({ error: "Paste C++ code or drop a .cpp file." });
    }
    if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
      return reply.code(400).send({ error: `Source too large (max ${MAX_SOURCE_BYTES / 1024} KB).` });
    }
    const problem = manager.get(problemId);
    if (!problem) return reply.code(404).send({ error: "Problem not found" });
    const tests = manager.tests(problemId);
    if (tests.length === 0) {
      return reply.code(400).send({ error: "This problem has no test cases." });
    }
    try {
      const result = await judgeSubmission({
        source,
        problem,
        tests,
        tempRoot: paths.temp,
        compilerRoot: paths.compiler,
      });

      // Save submission to DB
      const accepted = result.tests.filter((t) => t.status === "ACCEPTED").length;
      const maxTime = result.tests.reduce((m, t) => Math.max(m, t.time_ms ?? 0), 0);
      const subId = insertSubmission(db, {
        problemId,
        problemName: problem.name,
        source,
        status: result.status,
        acceptedCount: accepted,
        totalCount: result.tests.length,
        maxTimeMs: maxTime || null,
        compilerOutput: result.compiler_output,
        resultsJson: JSON.stringify(result.tests),
      });

      return { ...result, submissionId: subId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Judge failed";
      return reply.code(500).send({ error: message });
    }
  });

  // Run with custom input (stdin only) — no problem time limit (safety cap only)
  app.post("/api/run", async (req, reply) => {
    const body = req.body as { source?: string; input?: string };
    const source = body.source ?? "";
    if (!source.trim()) {
      return reply.code(400).send({ error: "Paste C++ code or drop a .cpp file." });
    }
    if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
      return reply.code(400).send({ error: `Source too large (max ${MAX_SOURCE_BYTES / 1024} KB).` });
    }
    try {
      const result = await runCustom({
        source,
        input: body.input ?? "",
        // Chạy thử: không theo TL bài; chỉ có trần an toàn để cắt vòng lặp vô hạn
        timeLimitMs: 10 * 60 * 1000,
        tempRoot: paths.temp,
        compilerRoot: paths.compiler,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Run failed";
      return reply.code(500).send({ error: message });
    }
  });

  // Submissions list
  app.get("/api/submissions", async (req) => {
    const q = req.query as { problemId?: string; limit?: string; offset?: string };
    const problemId = q.problemId ? Number(q.problemId) : undefined;
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;
    const items = listSubmissions(db, { problemId, limit, offset });
    const total = countSubmissions(db, problemId);
    // Don't send source in list view (can be large)
    const list = items.map(({ source, resultsJson, compilerOutput, ...rest }) => rest);
    return { items: list, total };
  });

  // Problem stats (submission count + best verdict per problem)
  app.get("/api/stats/problems", async () => {
    return problemStats(db);
  });

  // Monthly activity
  app.get("/api/stats/monthly", async () => {
    return monthlyActivity(db);
  });

  // Daily activity (for contribution grid)
  app.get("/api/stats/daily", async (req) => {
    const q = req.query as { days?: string };
    const days = Math.min(Math.max(Number(q.days) || 180, 30), 2000);
    return dailyActivity(db, days);
  });

  // Single submission with full source + results
  app.get("/api/submissions/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const sub = getSubmission(db, id);
    if (!sub) return reply.code(404).send({ error: "Submission not found" });
    return {
      ...sub,
      tests: JSON.parse(sub.resultsJson),
    };
  });
}
