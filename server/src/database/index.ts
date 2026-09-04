import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "./schema.js";
import type { CheckerType, IoMode, Problem, TestCase } from "../types.js";

export type Db = DatabaseSync;

export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

function nowIso(): string {
  return new Date().toISOString();
}

type ProblemRow = {
  id: number;
  name: string;
  code: string;
  time_limit_ms: number;
  memory_limit_mb: number;
  checker_type: string;
  io_mode: string;
  input_file: string;
  output_file: string;
  ignore_case: number;
  created_at: string;
  updated_at: string;
  test_count?: number;
};

type TestRow = {
  id: number;
  problem_id: number;
  name: string;
  input_path: string;
  output_path: string;
  order_index: number;
};

function mapProblem(row: ProblemRow): Problem {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    timeLimitMs: row.time_limit_ms,
    memoryLimitMb: row.memory_limit_mb,
    checkerType: row.checker_type as CheckerType,
    ioMode: row.io_mode as IoMode,
    inputFile: row.input_file,
    outputFile: row.output_file,
    ignoreCase: Boolean(row.ignore_case),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    testCount: row.test_count ?? 0,
  };
}

function mapTest(row: TestRow): TestCase {
  return {
    id: row.id,
    problemId: row.problem_id,
    name: row.name,
    inputPath: row.input_path,
    outputPath: row.output_path,
    orderIndex: row.order_index,
  };
}

export function listProblems(db: Db): Problem[] {
  const rows = db
    .prepare(
      `SELECT p.*, COUNT(t.id) AS test_count
       FROM problems p
       LEFT JOIN test_cases t ON t.problem_id = p.id
       GROUP BY p.id
       ORDER BY p.updated_at DESC`,
    )
    .all() as ProblemRow[];
  return rows.map(mapProblem);
}

export function getProblem(db: Db, id: number): Problem | null {
  const row = db
    .prepare(
      `SELECT p.*, COUNT(t.id) AS test_count
       FROM problems p
       LEFT JOIN test_cases t ON t.problem_id = p.id
       WHERE p.id = ?
       GROUP BY p.id`,
    )
    .get(id) as ProblemRow | undefined;
  return row ? mapProblem(row) : null;
}

export function getTests(db: Db, problemId: number): TestCase[] {
  const rows = db
    .prepare(
      `SELECT * FROM test_cases WHERE problem_id = ? ORDER BY order_index ASC, id ASC`,
    )
    .all(problemId) as TestRow[];
  return rows.map(mapTest);
}

export function getTest(db: Db, problemId: number, testId: number): TestCase | null {
  const row = db
    .prepare(`SELECT * FROM test_cases WHERE problem_id = ? AND id = ?`)
    .get(problemId, testId) as TestRow | undefined;
  return row ? mapTest(row) : null;
}

export type NewProblem = {
  name: string;
  code: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  checkerType: CheckerType;
  ioMode: IoMode;
  inputFile: string;
  outputFile: string;
  ignoreCase: boolean;
};

export function insertProblem(db: Db, data: NewProblem): number {
  const ts = nowIso();
  const result = db
    .prepare(
      `INSERT INTO problems
        (name, code, time_limit_ms, memory_limit_mb, checker_type, io_mode, input_file, output_file, ignore_case, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.name,
      data.code,
      data.timeLimitMs,
      data.memoryLimitMb,
      data.checkerType,
      data.ioMode,
      data.inputFile,
      data.outputFile,
      data.ignoreCase ? 1 : 0,
      ts,
      ts,
    );
  return Number(result.lastInsertRowid);
}

export function updateProblem(
  db: Db,
  id: number,
  patch: Partial<Pick<Problem, "name" | "timeLimitMs" | "memoryLimitMb" | "checkerType">>,
): void {
  const current = getProblem(db, id);
  if (!current) throw new Error("Problem not found");
  db.prepare(
    `UPDATE problems
     SET name = ?, time_limit_ms = ?, memory_limit_mb = ?, checker_type = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.name ?? current.name,
    patch.timeLimitMs ?? current.timeLimitMs,
    patch.memoryLimitMb ?? current.memoryLimitMb,
    patch.checkerType ?? current.checkerType,
    nowIso(),
    id,
  );
}

export function deleteProblem(db: Db, id: number): void {
  db.prepare(`DELETE FROM test_cases WHERE problem_id = ?`).run(id);
  db.prepare(`DELETE FROM problems WHERE id = ?`).run(id);
}

export function insertTest(
  db: Db,
  problemId: number,
  name: string,
  inputPath: string,
  outputPath: string,
  orderIndex: number,
): void {
  db.prepare(
    `INSERT INTO test_cases (problem_id, name, input_path, output_path, order_index)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(problemId, name, inputPath, outputPath, orderIndex);
}

export function deleteTests(db: Db, problemId: number): void {
  db.prepare(`DELETE FROM test_cases WHERE problem_id = ?`).run(problemId);
}

export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

// --- Submissions ---

export type Submission = {
  id: number;
  problemId: number;
  problemName: string;
  source: string;
  status: string;
  acceptedCount: number;
  totalCount: number;
  maxTimeMs: number | null;
  compilerOutput: string;
  resultsJson: string;
  createdAt: string;
};

type SubmissionRow = {
  id: number;
  problem_id: number;
  problem_name: string;
  source: string;
  status: string;
  accepted_count: number;
  total_count: number;
  max_time_ms: number | null;
  compiler_output: string;
  results_json: string;
  created_at: string;
};

function mapSubmission(row: SubmissionRow): Submission {
  return {
    id: row.id,
    problemId: row.problem_id,
    problemName: row.problem_name,
    source: row.source,
    status: row.status,
    acceptedCount: row.accepted_count,
    totalCount: row.total_count,
    maxTimeMs: row.max_time_ms,
    compilerOutput: row.compiler_output,
    resultsJson: row.results_json,
    createdAt: row.created_at,
  };
}

export function insertSubmission(
  db: Db,
  data: {
    problemId: number;
    problemName: string;
    source: string;
    status: string;
    acceptedCount: number;
    totalCount: number;
    maxTimeMs: number | null;
    compilerOutput: string;
    resultsJson: string;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO submissions
        (problem_id, problem_name, source, status, accepted_count, total_count, max_time_ms, compiler_output, results_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.problemId,
      data.problemName,
      data.source,
      data.status,
      data.acceptedCount,
      data.totalCount,
      data.maxTimeMs,
      data.compilerOutput,
      data.resultsJson,
      new Date().toISOString(),
    );
  return Number(result.lastInsertRowid);
}

export function listSubmissions(
  db: Db,
  opts?: { problemId?: number; limit?: number; offset?: number },
): Submission[] {
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;
  if (opts?.problemId) {
    return (
      db
        .prepare(
          `SELECT * FROM submissions WHERE problem_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(opts.problemId, limit, offset) as SubmissionRow[]
    ).map(mapSubmission);
  }
  return (
    db
      .prepare(`SELECT * FROM submissions ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as SubmissionRow[]
  ).map(mapSubmission);
}

export function getSubmission(db: Db, id: number): Submission | null {
  const row = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id) as
    | SubmissionRow
    | undefined;
  return row ? mapSubmission(row) : null;
}

export function countSubmissions(db: Db, problemId?: number): number {
  if (problemId) {
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM submissions WHERE problem_id = ?`).get(problemId) as { cnt: number };
    return row.cnt;
  }
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM submissions`).get() as { cnt: number };
  return row.cnt;
}

export type ProblemStats = {
  problemId: number;
  submissionCount: number;
  bestStatus: string | null;
  lastSubmittedAt: string | null;
};

export function problemStats(db: Db): ProblemStats[] {
  const rows = db.prepare(
    `SELECT
       problem_id,
       COUNT(*) as submission_count,
       MAX(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END) as has_ac,
       MIN(CASE WHEN status = 'ACCEPTED' THEN status ELSE NULL END) as best_ac,
       MIN(CASE WHEN status != 'ACCEPTED' THEN status ELSE NULL END) as best_other,
       MAX(created_at) as last_submitted_at
     FROM submissions
     GROUP BY problem_id`,
  ).all() as { problem_id: number; submission_count: number; has_ac: number; best_ac: string | null; best_other: string | null; last_submitted_at: string | null }[];
  return rows.map((r) => ({
    problemId: r.problem_id,
    submissionCount: r.submission_count,
    bestStatus: r.has_ac ? "ACCEPTED" : r.best_other,
    lastSubmittedAt: r.last_submitted_at,
  }));
}

export type MonthlyActivity = {
  month: string;
  submissionCount: number;
  acceptedCount: number;
  problemCount: number;
};

export function monthlyActivity(db: Db): MonthlyActivity[] {
  const rows = db.prepare(
    `SELECT
       strftime('%Y-%m', created_at) as month,
       COUNT(*) as submission_count,
       SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted_count,
       COUNT(DISTINCT problem_id) as problem_count
     FROM submissions
     GROUP BY month
     ORDER BY month DESC
     LIMIT 60`,
  ).all() as { month: string; submission_count: number; accepted_count: number; problem_count: number }[];
  return rows.map((r) => ({
    month: r.month,
    submissionCount: r.submission_count,
    acceptedCount: r.accepted_count,
    problemCount: r.problem_count,
  }));
}

export type DailyActivity = {
  date: string;
  submissionCount: number;
  acceptedCount: number;
};

export function dailyActivity(db: Db, days = 180): DailyActivity[] {
  const rows = db.prepare(
    `SELECT
       date(created_at) as day,
       COUNT(*) as submission_count,
       SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted_count
     FROM submissions
     WHERE date(created_at) >= date('now', ?)
     GROUP BY day
     ORDER BY day ASC`,
  ).all(`-${Math.max(7, days)} days`) as {
    day: string;
    submission_count: number;
    accepted_count: number;
  }[];
  return rows.map((r) => ({
    date: r.day,
    submissionCount: r.submission_count,
    acceptedCount: r.accepted_count,
  }));
}
