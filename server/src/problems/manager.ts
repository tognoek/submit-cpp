import { mkdir, copyFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Db } from "../database/index.js";
import {
  deleteProblem,
  deleteTests,
  getProblem,
  getTests,
  insertProblem,
  insertTest,
  listProblems,
  updateProblem,
} from "../database/index.js";
import type { StoredImport } from "../import/index.js";
import { discardImport, primaryPackage } from "../import/index.js";
import type { ParsedPackage, Problem } from "../types.js";
import type { AppPaths } from "../paths.js";

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "test";
}

async function copyPackageTests(
  paths: AppPaths,
  problemId: number,
  db: Db,
  parsed: ParsedPackage,
): Promise<void> {
  const testsDir = join(paths.problems, String(problemId), "tests");
  await mkdir(testsDir, { recursive: true });
  let index = 0;
  for (const test of parsed.tests) {
    const base = `${String(index).padStart(2, "0")}_${sanitize(test.name)}`;
    const inputPath = join(testsDir, `${base}.in`);
    const outputPath = join(testsDir, `${base}.out`);
    await copyFile(test.inputPath, inputPath);
    await copyFile(test.outputPath, outputPath);
    insertTest(db, problemId, test.name, inputPath, outputPath, index);
    index += 1;
  }
  await writeFile(
    join(paths.problems, String(problemId), "metadata.json"),
    JSON.stringify(
      {
        name: parsed.name,
        code: parsed.code,
        tests: parsed.tests.length,
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function createFromPackage(
  db: Db,
  paths: AppPaths,
  parsed: ParsedPackage,
  overrides: { name?: string; timeLimitMs?: number; checkerType?: "token" | "exact" },
): Promise<Problem> {
  const id = insertProblem(db, {
    name: (overrides.name || parsed.name).trim() || parsed.name,
    code: parsed.code,
    timeLimitMs: overrides.timeLimitMs ?? parsed.timeLimitMs,
    memoryLimitMb: parsed.memoryLimitMb,
    checkerType: overrides.checkerType ?? parsed.checkerType,
    ioMode: parsed.ioMode,
    inputFile: parsed.inputFile,
    outputFile: parsed.outputFile,
    ignoreCase: parsed.ignoreCase,
  });
  try {
    await copyPackageTests(paths, id, db, parsed);
  } catch (err) {
    deleteProblem(db, id);
    await rm(join(paths.problems, String(id)), { recursive: true, force: true });
    throw err;
  }
  const created = getProblem(db, id);
  if (!created) throw new Error("Failed to create problem");
  return created;
}

export function createProblemManager(db: Db, paths: AppPaths) {
  return {
    list: () => listProblems(db),
    get: (id: number) => getProblem(db, id),
    tests: (id: number) => getTests(db, id),

    async commitImport(
      item: StoredImport,
      overrides: { name?: string; timeLimitMs?: number; checkerType?: "token" | "exact" },
    ): Promise<Problem[]> {
      const created: Problem[] = [];
      try {
        if (item.packages.length === 1) {
          created.push(await createFromPackage(db, paths, item.packages[0], overrides));
        } else {
          for (const parsed of item.packages) {
            created.push(
              await createFromPackage(db, paths, parsed, {
                timeLimitMs: overrides.timeLimitMs,
                checkerType: overrides.checkerType,
              }),
            );
          }
        }
      } catch (err) {
        for (const p of created) {
          deleteProblem(db, p.id);
          await rm(join(paths.problems, String(p.id)), { recursive: true, force: true });
        }
        throw err;
      }
      await discardImport(item.id);
      return created;
    },

    async reimport(problemId: number, item: StoredImport): Promise<Problem> {
      if (item.packages.length > 1) {
        throw new Error("Gói có nhiều bài. Hãy thả đúng thư mục (hoặc ZIP) của một bài để reimport.");
      }
      const current = getProblem(db, problemId);
      if (!current) throw new Error("Problem not found");
      const parsed = primaryPackage(item);
      deleteTests(db, problemId);
      await rm(join(paths.problems, String(problemId), "tests"), {
        recursive: true,
        force: true,
      });
      await copyPackageTests(paths, problemId, db, parsed);
      updateProblem(db, problemId, {
        name: current.name,
        timeLimitMs: current.timeLimitMs,
      });
      await discardImport(item.id);
      const updated = getProblem(db, problemId);
      if (!updated) throw new Error("Problem not found");
      return updated;
    },

    update(
      id: number,
      patch: { name?: string; timeLimitMs?: number; checkerType?: "token" | "exact" },
    ): Problem {
      updateProblem(db, id, patch);
      const updated = getProblem(db, id);
      if (!updated) throw new Error("Problem not found");
      return updated;
    },

    async remove(id: number): Promise<void> {
      deleteProblem(db, id);
      await rm(join(paths.problems, String(id)), { recursive: true, force: true });
    },
  };
}

export type ProblemManager = ReturnType<typeof createProblemManager>;

export { basename };
