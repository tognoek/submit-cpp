export type Verdict =
  | "ACCEPTED"
  | "WRONG_ANSWER"
  | "TIME_LIMIT_EXCEEDED"
  | "RUNTIME_ERROR"
  | "COMPILATION_ERROR"
  | "MEMORY_LIMIT_EXCEEDED"
  | "PRESENTATION_ERROR"
  | "NOT_RUN";

export const VERDICT_LABEL: Record<Verdict, string> = {
  ACCEPTED: "Đúng",
  WRONG_ANSWER: "Sai kết quả",
  TIME_LIMIT_EXCEEDED: "Quá thời gian",
  RUNTIME_ERROR: "Lỗi khi chạy",
  COMPILATION_ERROR: "Lỗi biên dịch",
  MEMORY_LIMIT_EXCEEDED: "Quá bộ nhớ",
  PRESENTATION_ERROR: "Lỗi trình bày",
  NOT_RUN: "Chưa chạy",
};

export type Problem = {
  id: number;
  name: string;
  code: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  checkerType: "token" | "exact";
  ioMode: string;
  inputFile: string;
  outputFile: string;
  ignoreCase: boolean;
  createdAt: string;
  updatedAt: string;
  testCount: number;
  tests?: { id: number; name: string; orderIndex: number }[];
};

export type TestResult = {
  name: string;
  status: Verdict;
  time_ms: number | null;
  exit_code: number | null;
  input?: string;
  expected?: string;
  actual?: string;
  stderr?: string;
  truncated?: boolean;
};

export type JudgeResult = {
  status: Verdict;
  compiler_output: string;
  tests: TestResult[];
  message?: string;
  submissionId?: number;
};

export type ImportPreviewItem = {
  name: string;
  code: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  checkerType: string;
  ioMode: string;
  inputFile: string;
  outputFile: string;
  testCount: number;
  tests: { name: string }[];
  warnings: string[];
};

export type ImportPreview = ImportPreviewItem & {
  importId: string;
  problemCount: number;
  items: ImportPreviewItem[];
};

export type Health = {
  ok: boolean;
  compiler: { path: string; version: string } | null;
  dataDir: string;
};

export type SubmissionSummary = {
  id: number;
  problemId: number;
  problemName: string;
  status: Verdict;
  acceptedCount: number;
  totalCount: number;
  maxTimeMs: number | null;
  createdAt: string;
};

export type SubmissionDetail = SubmissionSummary & {
  source: string;
  compilerOutput: string;
  resultsJson: string;
  tests: TestResult[];
};

export type RunResult = {
  output: string;
  stderr: string;
  exitCode: number | null;
  timeMs: number;
  timedOut: boolean;
  compilerOutput: string;
  truncated: boolean;
};

export type Page = "judge" | "problems" | "history";

export type ProblemStat = {
  problemId: number;
  submissionCount: number;
  bestStatus: string | null;
  lastSubmittedAt: string | null;
};

export type MonthlyActivity = {
  month: string;
  submissionCount: number;
  acceptedCount: number;
  problemCount: number;
};

export type DailyActivity = {
  date: string;
  submissionCount: number;
  acceptedCount: number;
};
