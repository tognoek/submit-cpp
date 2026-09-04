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

export type CheckerType = "token" | "exact";
export type IoMode = "auto" | "file" | "stdio";

export type Problem = {
  id: number;
  name: string;
  code: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  checkerType: CheckerType;
  ioMode: IoMode;
  inputFile: string;
  outputFile: string;
  ignoreCase: boolean;
  createdAt: string;
  updatedAt: string;
  testCount: number;
};

export type TestCase = {
  id: number;
  problemId: number;
  name: string;
  inputPath: string;
  outputPath: string;
  orderIndex: number;
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

export type ImportPreview = {
  name: string;
  code: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  checkerType: CheckerType;
  ioMode: IoMode;
  inputFile: string;
  outputFile: string;
  ignoreCase: boolean;
  tests: {
    outputPath?: string;
    inputPath?: string;
    name: string;
}[];
  warnings: string[];
};

export type ParsedPackage = ImportPreview & {
  tests: { name: string; inputPath: string; outputPath: string }[];
};
