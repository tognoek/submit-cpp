import type { DailyActivity, Health, ImportPreview, JudgeResult, MonthlyActivity, Problem, ProblemStat, RunResult, SubmissionDetail, SubmissionSummary } from "./types";

async function parseError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data.error) return data.error;
  } catch {
    /* ignore */
  }
  return `Request failed (${res.status})`;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetch("/api/health").then((r) => json<Health>(r)),
  problems: () => fetch("/api/problems").then((r) => json<Problem[]>(r)),
  problem: (id: number) => fetch(`/api/problems/${id}`).then((r) => json<Problem>(r)),
  updateProblem: (id: number, body: Partial<Pick<Problem, "name" | "timeLimitMs" | "checkerType">>) =>
    fetch(`/api/problems/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<Problem>(r)),
  deleteProblem: (id: number) =>
    fetch(`/api/problems/${id}`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),
  deleteProblems: (ids: number[]) =>
    fetch("/api/problems/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).then((r) => json<{ ok: boolean; deleted: number }>(r)),
  exportProblemsZip: async (ids: number[]) => {
    const res = await fetch("/api/problems/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error(await parseError(res));
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const m = /filename="?([^";]+)"?/i.exec(cd);
    return { blob, filename: m?.[1] || "problems.zip" };
  },
  importPackage: (form: FormData) =>
    fetch("/api/problems/import", { method: "POST", body: form }).then((r) => json<ImportPreview>(r)),
  importLocal: (path: string) =>
    fetch("/api/problems/import-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }).then((r) => json<ImportPreview>(r)),
  createProblem: (body: { importId: string; name?: string; timeLimitMs?: number }) =>
    fetch("/api/problems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<Problem | { problems: Problem[]; count: number }>(r)),
  judge: (problemId: number, source: string) =>
    fetch("/api/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problemId, source }),
    }).then((r) => json<JudgeResult>(r)),
  testIo: (problemId: number, testId: number) =>
    fetch(`/api/problems/${problemId}/tests/${testId}`).then((r) =>
      json<{
        id: number;
        name: string;
        input?: { text: string; truncated: boolean };
        expected?: { text: string; truncated: boolean };
      }>(r),
    ),
  submissions: (opts?: { problemId?: number; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.problemId) params.set("problemId", String(opts.problemId));
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    return fetch(`/api/submissions?${params}`).then((r) =>
      json<{ items: SubmissionSummary[]; total: number }>(r),
    );
  },
  submission: (id: number) =>
    fetch(`/api/submissions/${id}`).then((r) => json<SubmissionDetail>(r)),
  run: (source: string, input: string) =>
    fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, input }),
    }).then((r) => json<RunResult>(r)),
  problemStats: () =>
    fetch("/api/stats/problems").then((r) => json<ProblemStat[]>(r)),
  monthlyActivity: () =>
    fetch("/api/stats/monthly").then((r) => json<MonthlyActivity[]>(r)),
  dailyActivity: (days = 180) =>
    fetch(`/api/stats/daily?days=${days}`).then((r) => json<DailyActivity[]>(r)),
};
