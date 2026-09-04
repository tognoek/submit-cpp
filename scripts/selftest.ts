import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parseTestPackage } from "../server/src/import/parseTests.js";
import { findCompiler } from "../server/src/compiler/index.js";
import { judgeSubmission } from "../server/src/judge/engine.js";
import type { Problem, TestCase } from "../server/src/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const toi = join(root, "TOIUU");

const AC = `#include <bits/stdc++.h>
using namespace std;
int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    freopen("TOIUU.INP", "r", stdin);
    freopen("TOIUU.OUT", "w", stdout);
    int n; long long s;
    if (!(cin >> n >> s)) return 0;
    vector<long long> a(n);
    for (int i = 0; i < n; i++) cin >> a[i];
    sort(a.begin(), a.end());
    int cnt = 0;
    for (long long x : a) {
        if (s < x) break;
        s -= x;
        cnt++;
    }
    cout << cnt << '\\n';
    return 0;
}
`;

const WA = `#include <bits/stdc++.h>
using namespace std;
int main() {
    freopen("TOIUU.INP", "r", stdin);
    freopen("TOIUU.OUT", "w", stdout);
    cout << 0 << '\\n';
    return 0;
}
`;

const TLE = `#include <bits/stdc++.h>
using namespace std;
int main() {
    while (true) {}
    return 0;
}
`;

const RE = `#include <bits/stdc++.h>
using namespace std;
int main() {
    int *p = nullptr;
    *p = 1;
    return 0;
}
`;

const CE = `int main() { this is not valid C++`;

function problemFromParsed(parsed: Awaited<ReturnType<typeof parseTestPackage>>, timeLimitMs?: number): Problem {
  return {
    id: 1,
    name: parsed.name,
    code: parsed.code,
    timeLimitMs: timeLimitMs ?? parsed.timeLimitMs,
    memoryLimitMb: parsed.memoryLimitMb,
    checkerType: parsed.checkerType,
    ioMode: parsed.ioMode,
    inputFile: parsed.inputFile,
    outputFile: parsed.outputFile,
    ignoreCase: parsed.ignoreCase,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    testCount: parsed.tests.length,
  };
}

function testsFromParsed(parsed: Awaited<ReturnType<typeof parseTestPackage>>, limit?: number): TestCase[] {
  return parsed.tests.slice(0, limit).map((t, i) => ({
    id: i + 1,
    problemId: 1,
    name: t.name,
    inputPath: t.inputPath,
    outputPath: t.outputPath,
    orderIndex: i,
  }));
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Parsing TOIUU…");
  const parsed = await parseTestPackage(toi, "TOIUU");
  console.log(`  name=${parsed.name} tests=${parsed.tests.length} tl=${parsed.timeLimitMs}ms io=${parsed.ioMode}`);
  console.log(`  files ${parsed.inputFile} / ${parsed.outputFile}`);
  assert(parsed.tests.length === 25, `expected 25 tests, got ${parsed.tests.length}`);
  assert(parsed.name === "TOIUU", `expected name TOIUU, got ${parsed.name}`);
  assert(parsed.timeLimitMs === 1000, `expected 1000ms from Settings.cfg, got ${parsed.timeLimitMs}`);
  assert(parsed.inputFile.toUpperCase() === "TOIUU.INP", "expected TOIUU.INP");
  assert(parsed.ioMode === "file", `expected file I/O, got ${parsed.ioMode}`);

  const compiler = await findCompiler();
  if (!compiler) {
    console.log("Compiler not installed. Run npm run setup, then re-run selftest.");
    return;
  }
  console.log(`Compiler: ${compiler.version}`);

  const tempRoot = await mkdtemp(join(tmpdir(), "judge-selftest-"));
  try {
    const allTests = testsFromParsed(parsed);
    const small = testsFromParsed(parsed, 3);
    const problem = problemFromParsed(parsed);

    console.log("\n[CE] Compilation Error");
    let r = await judgeSubmission({ source: CE, problem, tests: small, tempRoot });
    assert(r.status === "COMPILATION_ERROR", `CE: got ${r.status}`);
    assert(r.tests.length === 0, "CE must not run tests");
    assert(r.compiler_output.length > 0, "CE must show compiler output");
    console.log("  ok");

    console.log("\n[WA] Wrong Answer (stop after first failure)");
    r = await judgeSubmission({ source: WA, problem, tests: small, tempRoot });
    assert(r.status === "WRONG_ANSWER", `WA: got ${r.status}`);
    const failed = r.tests.find((t) => t.status === "WRONG_ANSWER");
    assert(failed, "expected a WA test");
    const skipped = r.tests.filter((t) => t.status === "NOT_RUN").length;
    assert(skipped > 0, "expected remaining tests not run");
    console.log(`  failed ${failed?.name}, skipped ${skipped}`);

    console.log("\n[RE] Runtime Error");
    r = await judgeSubmission({ source: RE, problem, tests: small, tempRoot });
    assert(r.status === "RUNTIME_ERROR", `RE: got ${r.status}`);
    console.log("  ok");

    console.log("\n[TLE] Time Limit Exceeded + process killed");
    const tleProblem = { ...problem, timeLimitMs: 400 };
    const t0 = Date.now();
    r = await judgeSubmission({ source: TLE, problem: tleProblem, tests: testsFromParsed(parsed, 1), tempRoot });
    const elapsed = Date.now() - t0;
    assert(r.status === "TIME_LIMIT_EXCEEDED", `TLE: got ${r.status}`);
    assert(elapsed < 4000, `TLE hung (${elapsed}ms)`);
    console.log(`  ok in ${elapsed}ms`);

    console.log("\n[AC] Accepted on all TOIUU tests");
    r = await judgeSubmission({ source: AC, problem, tests: allTests, tempRoot });
    const wa = r.tests.filter((t) => t.status !== "ACCEPTED");
    if (r.status !== "ACCEPTED") {
      console.log("  first failures:", wa.slice(0, 3));
    }
    assert(r.status === "ACCEPTED", `AC: got ${r.status}`);
    assert(r.tests.every((t) => t.status === "ACCEPTED"), "all tests must be Accepted");
    console.log(`  ${r.tests.length} accepted`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  console.log("\nAll selftests passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
