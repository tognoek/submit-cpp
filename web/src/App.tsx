import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { CppEditor, replaceEditorDoc, readEditorFontSize, EDITOR_FONT_MIN, EDITOR_FONT_MAX } from "./CppEditor";
import { api } from "./api";
import { collectDroppedFiles, isCppFile } from "./drop";
import {
  VERDICT_LABEL,
  type Health,
  type JudgeResult,
  type MonthlyActivity,
  type DailyActivity,
  type Page,
  type Problem,
  type ProblemStat,
  type SubmissionDetail,
  type SubmissionSummary,
  type TestResult,
  type RunResult,
  type Verdict,
} from "./types";

// ─── Helpers ────────────────────────────────────────────────────────────────

const SAMPLE = `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    // freopen("NAME.INP", "r", stdin);
    // freopen("NAME.OUT", "w", stdout);

    return 0;
}
`;

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      return (localStorage.getItem("judge-theme") as "dark" | "light") || "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("judge-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle };
}

function verdictColor(v: Verdict): string {
  if (v === "ACCEPTED") return "var(--color-ok)";
  if (v === "WRONG_ANSWER" || v === "PRESENTATION_ERROR") return "var(--color-bad)";
  if (v === "TIME_LIMIT_EXCEEDED") return "var(--color-tle)";
  if (v === "COMPILATION_ERROR") return "var(--color-ce)";
  if (v === "RUNTIME_ERROR" || v === "MEMORY_LIMIT_EXCEEDED") return "var(--color-bad)";
  return "var(--color-skip)";
}

function verdictClass(v: Verdict): string {
  if (v === "ACCEPTED") return "text-[var(--color-ok)]";
  if (v === "WRONG_ANSWER" || v === "PRESENTATION_ERROR") return "text-[var(--color-bad)]";
  if (v === "TIME_LIMIT_EXCEEDED") return "text-[var(--color-tle)]";
  if (v === "COMPILATION_ERROR") return "text-[var(--color-ce)]";
  if (v === "RUNTIME_ERROR" || v === "MEMORY_LIMIT_EXCEEDED") return "text-[var(--color-bad)]";
  return "text-[var(--color-skip)]";
}

function verdictMark(v: Verdict): string {
  if (v === "ACCEPTED") return "✓";
  if (v === "WRONG_ANSWER" || v === "PRESENTATION_ERROR") return "✗";
  if (v === "TIME_LIMIT_EXCEEDED") return "⏱";
  if (v === "RUNTIME_ERROR" || v === "MEMORY_LIMIT_EXCEEDED") return "⚠";
  if (v === "COMPILATION_ERROR") return "🔨";
  return "○";
}

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 45000) return "vừa xong";
  if (d < 3600000) return `${Math.floor(d / 60000)} phút trước`;
  if (d < 86400000) return `${Math.floor(d / 3600000)} giờ trước`;
  return new Date(iso).toLocaleDateString("vi-VN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function subToResult(sub: SubmissionDetail): JudgeResult {
  return {
    status: sub.status,
    compiler_output: sub.compilerOutput,
    tests: sub.tests,
    message: `${sub.acceptedCount}/${sub.totalCount} test đúng.`,
  };
}

function VerdictBadge({ v }: { v: Verdict }) {
  const bg =
    v === "ACCEPTED"
      ? "bg-[var(--color-ok)]/15 border-[var(--color-ok)]/30"
      : v === "WRONG_ANSWER" || v === "PRESENTATION_ERROR"
        ? "bg-[var(--color-bad)]/15 border-[var(--color-bad)]/30"
        : v === "TIME_LIMIT_EXCEEDED"
          ? "bg-[var(--color-tle)]/15 border-[var(--color-tle)]/30"
          : v === "COMPILATION_ERROR"
            ? "bg-[var(--color-ce)]/15 border-[var(--color-ce)]/30"
            : "bg-[var(--color-skip)]/15 border-[var(--color-skip)]/30";
  return (
    <span className={`verdict-badge border ${bg}`} style={{ color: verdictColor(v) }}>
      <span className="font-bold">{verdictMark(v)}</span> {VERDICT_LABEL[v]}
    </span>
  );
}

// ─── App ────────────────────────────────────────────────────────────────────

export function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [page, setPage] = useState<Page>("judge");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [source, setSource] = useState(SAMPLE);
  const editorViewRef = useRef<EditorView | null>(null);
  const replaceSource = useCallback((next: string) => {
    setSource(next);
    const view = editorViewRef.current;
    if (view) replaceEditorDoc(view, next);
  }, []);
  const [health, setHealth] = useState<Health | null>(null);
  const [judging, setJudging] = useState(false);
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [picked, setPicked] = useState<TestResult | null>(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"detail" | "settings" | null>(null);
  const [detail, setDetail] = useState<Problem | null>(null);
  const [busy, setBusy] = useState("");
  const [historyKey, setHistoryKey] = useState(0);
  const [editorFontSize, setEditorFontSize] = useState(readEditorFontSize);
  const setEditorFontSizePersist = useCallback((next: number | ((prev: number) => number)) => {
    setEditorFontSize((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      const clamped = Math.min(EDITOR_FONT_MAX, Math.max(EDITOR_FONT_MIN, value));
      try {
        localStorage.setItem("judge-editor-font", String(clamped));
      } catch {
        /* ignore */
      }
      return clamped;
    });
  }, []);

  const selected = problems.find((p) => p.id === selectedId) || null;

  async function refresh() {
    const [list, h] = await Promise.all([api.problems(), api.health()]);
    setProblems(list);
    setHealth(h);
    setSelectedId((id) => (id && list.some((p) => p.id === id) ? id : list[0]?.id ?? null));
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function onJudge() {
    if (!selectedId || judging) return;
    setError("");
    setJudging(true);
    setPicked(null);
    try {
      const r = await api.judge(selectedId, source);
      setResult(r);
      const firstBad = r.tests.find((t) => t.status !== "ACCEPTED" && t.status !== "NOT_RUN");
      setPicked(firstBad || r.tests[0] || null);
      // Refresh problem history after submission
      setHistoryKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJudging(false);
    }
  }

  async function onCppDrop(file: File) {
    replaceSource(await file.text());
  }

  async function openDetail(id: number) {
    const p = await api.problem(id);
    setDetail(p);
    setModal("detail");
  }

  function loadSubmission(sub: { source: string; problemId: number; result?: JudgeResult }) {
    replaceSource(sub.source);
    setSelectedId(sub.problemId);
    setPage("judge");
    if (sub.result) {
      setResult(sub.result);
      const firstBad = sub.result.tests.find((t) => t.status !== "ACCEPTED" && t.status !== "NOT_RUN");
      setPicked(firstBad || sub.result.tests[0] || null);
    } else {
      setResult(null);
      setPicked(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col font-sans">
      {/* ─── Header ─── */}
      <header className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-bg2)]/40 px-6 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-copper)] text-[#1a1208] shadow-sm"
              title="Chấm C++"
              aria-hidden
            >
              {/* Biểu tượng giải thuật thi đấu: cây đồ thị */}
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden>
                <circle cx="12" cy="5" r="2.4" fill="currentColor" />
                <circle cx="5.5" cy="17.5" r="2.4" fill="currentColor" />
                <circle cx="18.5" cy="17.5" r="2.4" fill="currentColor" />
                <path
                  d="M12 7.4 L6.8 15.2 M12 7.4 L17.2 15.2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M15.2 10.2h3.4M16.9 8.5v3.4"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="flex items-baseline gap-1.5">
              <h1 className="font-display text-xl font-bold tracking-tight text-[var(--color-ink)]">
                Chấm C++
              </h1>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            {(
              [
                { key: "judge", label: "Nộp bài", sub: "Submit" },
                { key: "problems", label: "Danh sách bài", sub: "Problems" },
                { key: "history", label: "Toàn bộ lịch sử", sub: "History" },
              ] as { key: Page; label: string; sub: string }[]
            ).map((item) => (
              <button
                key={item.key}
                onClick={() => setPage(item.key)}
                className={`nav-link flex items-center gap-1.5 ${page === item.key ? "active" : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"}`}
              >
                {item.key === "judge" && <IconSubmit className="h-3.5 w-3.5" />}
                {item.key === "problems" && <IconList className="h-3.5 w-3.5" />}
                {item.key === "history" && <IconHistory className="h-3.5 w-3.5" />}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleTheme}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-sm transition hover:border-[var(--color-copper)]/50 hover:bg-[var(--color-bg3)]"
            title={theme === "dark" ? "Chuyển giao diện sáng" : "Chuyển giao diện tối"}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-sm text-[var(--color-muted)] transition hover:border-[var(--color-copper)]/50 hover:bg-[var(--color-bg3)] hover:text-[var(--color-ink)]"
            onClick={() => setModal("settings")}
            title="Cài đặt hệ thống"
          >
            ⚙
          </button>
        </div>
      </header>

      {/* ─── Pages ─── */}
      {page === "judge" && (
        <JudgePage
          problems={problems}
          selectedId={selectedId}
          selected={selected}
          source={source}
          setSource={setSource}
          replaceSource={replaceSource}
          setSelectedId={(id) => {
            setSelectedId(id);
            setResult(null);
            setPicked(null);
          }}
          onJudge={onJudge}
          judging={judging}
          result={result}
          picked={picked}
          setPicked={setPicked}
          error={error}
          onCppDrop={onCppDrop}
          openDetail={openDetail}
          editorViewRef={editorViewRef}
          editorFontSize={editorFontSize}
          setEditorFontSize={setEditorFontSizePersist}
          isDark={theme === "dark"}
          historyKey={historyKey}
          loadSubmission={loadSubmission}
        />
      )}
      {page === "problems" && (
        <ProblemsPage
          problems={problems}
          refresh={refresh}
          openDetail={openDetail}
          setPage={setPage}
          setSelectedId={setSelectedId}
        />
      )}
      {page === "history" && <HistoryPage problems={problems} loadSubmission={loadSubmission} />}

      {/* ─── Modals ─── */}
      {modal === "detail" && detail && (
        <DetailModal
          problem={detail}
          busy={busy}
          onClose={() => setModal(null)}
          onChange={async () => {
            setDetail(await api.problem(detail.id));
            await refresh();
          }}
          onDeleted={async () => {
            setModal(null);
            await refresh();
          }}
          setBusy={setBusy}
        />
      )}
      {modal === "settings" && health && (
        <SettingsModal health={health} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

// ─── Judge Page ─────────────────────────────────────────────────────────────

function JudgePage(props: {
  problems: Problem[];
  selectedId: number | null;
  selected: Problem | null;
  source: string;
  setSource: (s: string) => void;
  replaceSource: (s: string) => void;
  setSelectedId: (id: number) => void;
  onJudge: () => void;
  judging: boolean;
  result: JudgeResult | null;
  picked: TestResult | null;
  setPicked: (t: TestResult | null) => void;
  error: string;
  onCppDrop: (f: File) => Promise<void>;
  openDetail: (id: number) => void;
  editorViewRef: MutableRefObject<EditorView | null>;
  editorFontSize: number;
  setEditorFontSize: (next: number | ((prev: number) => number)) => void;
  isDark: boolean;
  historyKey: number;
  loadSubmission: (sub: { source: string; problemId: number; result?: JudgeResult }) => void;
}) {
  const {
    problems,
    selectedId,
    selected,
    source,
    setSource,
    replaceSource,
    setSelectedId,
    onJudge,
    judging,
    result,
    picked,
    setPicked,
    error,
    onCppDrop,
    openDetail,
    editorViewRef,
    editorFontSize,
    setEditorFontSize,
    isDark,
    historyKey,
    loadSubmission,
  } = props;

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [problemSubs, setProblemSubs] = useState<SubmissionSummary[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [viewingSub, setViewingSub] = useState<SubmissionDetail | null>(null);
  const [copiedSub, setCopiedSub] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [resultTab, setResultTab] = useState<"summary" | "inspect" | "compiler" | "run">("summary");
  const [runInput, setRunInput] = useState("");
  const [runOutput, setRunOutput] = useState<{ output: string; stderr: string; exitCode: number | null; timeMs: number; timedOut: boolean; compilerOutput: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [savingCode, setSavingCode] = useState(false);
  const [savedCodeHint, setSavedCodeHint] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const [resultH, setResultH] = useState(() => {
    try { return Number(localStorage.getItem("judge-result-h")) || 290; } catch { return 290; }
  });
  const splitterRef = useRef<{ startY: number; startH: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** true khi đang làm việc trên editor — Ctrl+Z/Y ưu tiên editor, không vào ô input */
  const editorSurfaceRef = useRef(true);
  const vScrollRef = useRef<HTMLDivElement>(null);
  const vThumbRef = useRef<HTMLDivElement>(null);
  const hScrollRef = useRef<HTMLDivElement>(null);
  const hThumbRef = useRef<HTMLDivElement>(null);
  const scrollMetrics = useRef({
    left: 52,
    right: 0,
    trackH: 1,
    trackW: 1,
    thumbH: 40,
    thumbW: 40,
    maxScrollY: 0,
    maxScrollX: 0,
  });
  const dragRef = useRef<{
    axis: "x" | "y";
    startPtr: number;
    startScroll: number;
  } | null>(null);
  const scrollRaf = useRef(0);

  // Focus editor khi tương tác; Ctrl+Z/Y luôn đi vào editor (không vào ô input)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const view = editorViewRef.current;
      if (!view) return;

      const active = document.activeElement;
      const inEditor = view.hasFocus || (!!active && view.dom.contains(active));
      if (!inEditor && !editorSurfaceRef.current) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      if (!view.hasFocus) view.focus();
      if (key === "y" || (key === "z" && e.shiftKey)) redo(view);
      else undo(view);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editorViewRef]);

  // Thanh cuộn custom — cập nhật DOM trực tiếp (không setState mỗi frame)
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let tries = 0;
    const timer = window.setInterval(() => {
      const view = editorViewRef.current;
      tries += 1;
      if (!view) {
        if (tries > 40) window.clearInterval(timer);
        return;
      }
      window.clearInterval(timer);

      const scroller = view.scrollDOM;

      const paint = () => {
        scrollRaf.current = 0;
        const gutters = view.dom.querySelector(".cm-gutters") as HTMLElement | null;
        const minimap = view.dom.querySelector(".cm-minimap-gutter") as HTMLElement | null;
        const left = gutters?.offsetWidth ?? 0;
        const right = minimap?.offsetWidth ?? 0;

        const sh = scroller.scrollHeight;
        const ch = scroller.clientHeight;
        const sw = scroller.scrollWidth;
        const cw = scroller.clientWidth;
        const showY = sh > ch + 1;
        const showX = sw > cw + 1;

        const trackH = Math.max(1, ch - 24);
        const thumbH = showY ? Math.max(28, (ch / sh) * trackH) : 40;
        const maxScrollY = Math.max(0, sh - ch);
        const thumbTop = maxScrollY > 0 ? (scroller.scrollTop / maxScrollY) * (trackH - thumbH) : 0;

        const trackW = Math.max(1, cw - left - right - 8);
        const thumbW = showX ? Math.max(28, (cw / sw) * trackW) : 40;
        const maxScrollX = Math.max(0, sw - cw);
        const thumbLeft = maxScrollX > 0 ? (scroller.scrollLeft / maxScrollX) * (trackW - thumbW) : 0;

        scrollMetrics.current = {
          left: left + 4,
          right: right + 4,
          trackH,
          trackW,
          thumbH,
          thumbW,
          maxScrollY,
          maxScrollX,
        };

        const vBar = vScrollRef.current;
        const vThumb = vThumbRef.current;
        const hBar = hScrollRef.current;
        const hThumb = hThumbRef.current;

        if (vBar) {
          vBar.style.right = `${right + 4}px`;
          vBar.classList.toggle("is-visible", showY);
        }
        if (vThumb) {
          vThumb.style.height = `${thumbH}px`;
          vThumb.style.transform = `translate3d(0, ${thumbTop}px, 0)`;
        }
        if (hBar) {
          hBar.style.left = `${left + 4}px`;
          hBar.style.right = `${right + 4}px`;
          hBar.classList.toggle("is-visible", showX);
        }
        if (hThumb) {
          hThumb.style.width = `${thumbW}px`;
          hThumb.style.transform = `translate3d(${thumbLeft}px, 0, 0)`;
        }
      };

      const schedulePaint = () => {
        if (scrollRaf.current) return;
        scrollRaf.current = requestAnimationFrame(paint);
      };

      scroller.addEventListener("scroll", schedulePaint, { passive: true });
      const ro = new ResizeObserver(schedulePaint);
      ro.observe(scroller);
      ro.observe(view.dom);
      ro.observe(view.contentDOM);
      const guttersEl = view.dom.querySelector(".cm-gutters");
      const minimapEl = view.dom.querySelector(".cm-minimap-gutter");
      if (guttersEl) ro.observe(guttersEl);
      if (minimapEl) ro.observe(minimapEl);
      paint();
      cleanup = () => {
        scroller.removeEventListener("scroll", schedulePaint);
        ro.disconnect();
        if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
      };
    }, 50);

    return () => {
      window.clearInterval(timer);
      cleanup?.();
    };
  }, [editorViewRef]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      const view = editorViewRef.current;
      if (!drag || !view) return;
      e.preventDefault();
      const scroller = view.scrollDOM;
      const m = scrollMetrics.current;
      if (drag.axis === "y") {
        const dy = e.clientY - drag.startPtr;
        const range = Math.max(1, m.trackH - m.thumbH);
        scroller.scrollTop = Math.max(0, Math.min(m.maxScrollY, drag.startScroll + (dy / range) * m.maxScrollY));
      } else {
        const dx = e.clientX - drag.startPtr;
        const range = Math.max(1, m.trackW - m.thumbW);
        scroller.scrollLeft = Math.max(0, Math.min(m.maxScrollX, drag.startScroll + (dx / range) * m.maxScrollX));
      }
    }
    function onUp() {
      const axis = dragRef.current?.axis;
      dragRef.current = null;
      if (axis === "y") vScrollRef.current?.classList.remove("is-active");
      if (axis === "x") hScrollRef.current?.classList.remove("is-active");
    }
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [editorViewRef]);

  // Drag-to-resize for results panel
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!splitterRef.current || !containerRef.current) return;
      e.preventDefault();
      const dy = splitterRef.current.startY - e.clientY;
      const maxH = containerRef.current.offsetHeight - 120;
      const h = Math.min(maxH, Math.max(100, splitterRef.current.startH + dy));
      setResultH(h);
    }
    function onUp() {
      if (!splitterRef.current) return;
      splitterRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem("judge-result-h", String(resultH)); } catch { /* */ }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resultH]);

  // Auto switch tab when result arrives
  useEffect(() => {
    if (result) {
      if (result.status === "COMPILATION_ERROR") {
        setResultTab("compiler");
      } else {
        setResultTab("summary");
      }
    }
  }, [result]);

  // Load problem-specific submissions
  const loadProblemHistory = useCallback(async () => {
    if (!selectedId) {
      setProblemSubs([]);
      return;
    }
    setLoadingSubs(true);
    try {
      const res = await api.submissions({ problemId: selectedId, limit: 50 });
      setProblemSubs(res.items);
    } catch {
      /* ignore */
    } finally {
      setLoadingSubs(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadProblemHistory();
  }, [loadProblemHistory, historyKey]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setSelectorOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function openSubmissionDetail(id: number) {
    try {
      const detail = await api.submission(id);
      setViewingSub(detail);
    } catch (err) {
      alert("Không thể tải chi tiết lần nộp: " + String(err));
    }
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setIsDragOver(false);
        const files = await collectDroppedFiles(e.dataTransfer);
        const cppFile = files.find((f) => isCppFile(f.relativePath));
        if (cppFile) await onCppDrop(cppFile.file);
      }}
    >
      {/* ─── Top Workspace Bar ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] bg-[var(--color-bg2)]/30 px-5 py-2.5">
        {/* Problem Selector */}
        <div className="flex items-center gap-3">
          <div className="relative" ref={selectorRef}>
            <button
              onClick={() => setSelectorOpen(!selectorOpen)}
              className="flex items-center gap-2.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg2)] px-3 py-1.5 text-left transition hover:border-[var(--color-copper)]/60 hover:bg-[var(--color-bg3)]"
            >
              {selected ? (
                <>
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-[var(--color-copper)]/15 font-mono text-xs font-bold text-[var(--color-copper)]">
                    {selected.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 max-w-[220px]">
                    <div className="truncate text-sm font-semibold text-[var(--color-ink)]">
                      {selected.name}
                    </div>
                  </div>
                  <span className="text-xs text-[var(--color-muted)]">▾</span>
                </>
              ) : (
                <span className="text-sm text-[var(--color-muted)]">Chọn bài tập…</span>
              )}
            </button>

            {selectorOpen && (
              <div className="absolute left-0 top-full z-30 mt-1.5 w-[340px] overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-bg2)] shadow-2xl backdrop-blur-xl">
                <div className="border-b border-[var(--color-line)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                  Danh sách bài tập ({problems.length})
                </div>
                <div className="scroll-thin max-h-[340px] overflow-y-auto py-1">
                  {problems.length === 0 && (
                    <div className="px-4 py-8 text-center text-sm text-[var(--color-muted)]">
                      Chưa có bài tập nào. Hãy tạo hoặc import bài trước.
                    </div>
                  )}
                  {problems.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedId(p.id);
                        setSelectorOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 px-3.5 py-2 text-left transition hover:bg-[var(--color-hover)] ${
                        selectedId === p.id ? "bg-[var(--color-bg3)] font-medium" : ""
                      }`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--color-copper)]/15 font-mono text-xs font-bold text-[var(--color-copper)]">
                        {p.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{p.name}</div>
                        <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--color-muted)]">
                          <span>{p.testCount} tests</span>
                          <span>•</span>
                          <span>{p.timeLimitMs}ms</span>
                          <span>•</span>
                          <span>{p.checkerType}</span>
                        </div>
                      </div>
                      {selectedId === p.id && (
                        <span className="text-xs text-[var(--color-copper)]">●</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {selected && (
            <div className="hidden items-center gap-2 sm:flex">
              <span className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-muted)]">
                ⏱ {selected.timeLimitMs}ms
              </span>
              <span className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-muted)]">
                📦 {selected.testCount} tests
              </span>
              {selected.inputFile && selected.inputFile !== "stdin" && (
                <span className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-muted)]">
                  📁 {selected.inputFile} → {selected.outputFile}
                </span>
              )}
              <button
                onClick={() => openDetail(selected.id)}
                className="text-xs text-[var(--color-copper)] underline-offset-2 transition hover:underline"
              >
                Chi tiết bài
              </button>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => replaceSource(SAMPLE)}
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-muted)] transition hover:bg-[var(--color-bg3)] hover:text-[var(--color-ink)]"
            title="Khôi phục code mẫu chuẩn"
          >
            Mẫu code
          </button>

          <button
            type="button"
            disabled={savingCode || !source.trim()}
            onClick={() => {
              void (async () => {
                setSavingCode(true);
                try {
                  const result = await saveTextAsFile(source);
                  if (result === "cancelled") return;
                  setSavedCodeHint(true);
                  setTimeout(() => setSavedCodeHint(false), 1800);
                } catch (e) {
                  alert("Lưu thất bại: " + (e instanceof Error ? e.message : String(e)));
                } finally {
                  setSavingCode(false);
                }
              })();
            }}
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-muted)] transition hover:bg-[var(--color-bg3)] hover:text-[var(--color-ink)] disabled:opacity-40"
            title="Lưu code — tự đặt tên và đuôi file"
          >
            {savingCode ? "Đang lưu…" : savedCodeHint ? "Đã lưu" : "Lưu"}
          </button>

          <div
            className="flex items-center overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)]"
            title="Cỡ chữ editor (Ctrl+/-)"
          >
            <button
              type="button"
              disabled={editorFontSize <= EDITOR_FONT_MIN}
              onClick={() => setEditorFontSize((s) => s - 1)}
              className="px-2 py-1.5 text-xs font-bold text-[var(--color-muted)] transition hover:bg-[var(--color-bg3)] hover:text-[var(--color-ink)] disabled:opacity-30"
              title="Giảm cỡ chữ"
            >
              −
            </button>
            <div className="min-w-[3.25rem] border-x border-[var(--color-line)] px-2 py-1.5 text-center font-mono text-[11px] font-semibold text-[var(--color-ink)]">
              {editorFontSize}px
            </div>
            <button
              type="button"
              disabled={editorFontSize >= EDITOR_FONT_MAX}
              onClick={() => setEditorFontSize((s) => s + 1)}
              className="px-2 py-1.5 text-xs font-bold text-[var(--color-muted)] transition hover:bg-[var(--color-bg3)] hover:text-[var(--color-ink)] disabled:opacity-30"
              title="Tăng cỡ chữ"
            >
              +
            </button>
          </div>

          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              showHistory
                ? "border-[var(--color-copper)]/50 bg-[var(--color-copper)]/10 text-[var(--color-copper)]"
                : "border-[var(--color-line)] bg-[var(--color-bg)] text-[var(--color-muted)] hover:bg-[var(--color-bg3)] hover:text-[var(--color-ink)]"
            }`}
            title="Ẩn/hiện lịch sử nộp bài này bên phải"
          >
            <span>📜 Lịch sử bài này</span>
            <span className="rounded-full bg-[var(--color-bg3)] px-1.5 py-0.2 text-[10px] font-bold">
              {problemSubs.length}
            </span>
          </button>

          <button
            disabled={!selectedId || judging}
            onClick={onJudge}
            className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold tracking-wide shadow-sm transition disabled:opacity-40 ${
              judging
                ? "busy"
                : "bg-[var(--color-copper)] text-[#1a1208] hover:bg-[var(--color-copper2)] active:scale-[0.98]"
            }`}
          >
            {judging ? (
              <span>Đang chấm…</span>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
                  <path d="M8 5.14v13.72a1 1 0 0 0 1.55.83l10.1-6.86a1 1 0 0 0 0-1.66L9.55 4.31A1 1 0 0 0 8 5.14z" />
                </svg>
                <span>Chấm bài</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ─── Main Content Split (Left: Editor + Bottom Results | Right: Problem History) ─── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left Area: Editor + Bottom Results Container */}
        <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Editor Area */}
          <div
            className="editor-wrap relative min-h-0 flex-1 overflow-hidden"
            onPointerDownCapture={() => {
              editorSurfaceRef.current = true;
              const view = editorViewRef.current;
              if (!view) return;
              const active = document.activeElement as HTMLElement | null;
              if (active && active !== document.body && !view.dom.contains(active) && typeof active.blur === "function") {
                active.blur();
              }
              view.focus();
            }}
          >
            {isDragOver && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[var(--color-bg)]/90 backdrop-blur-xs">
                <div className="rounded-xl border-2 border-dashed border-[var(--color-copper)] bg-[var(--color-bg2)] p-8 text-center">
                  <div className="text-3xl">📄</div>
                  <div className="mt-2 text-base font-semibold text-[var(--color-ink)]">
                    Thả file .cpp để tải mã nguồn
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-muted)]">
                    Mã nguồn trong editor sẽ được thay thế bằng file được thả.
                  </div>
                </div>
              </div>
            )}
            <CppEditor
              initialDoc={source}
              isDark={isDark}
              fontSize={editorFontSize}
              onFontSize={setEditorFontSize}
              onChange={setSource}
              viewRef={editorViewRef}
            />
            {/* Scroll Y — chỉ thumb, cạnh minimap */}
            <div ref={vScrollRef} className="editor-vscroll" onPointerDown={(e) => e.stopPropagation()}>
              <div
                ref={vThumbRef}
                className="editor-vscroll-thumb"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const view = editorViewRef.current;
                  if (!view) return;
                  dragRef.current = {
                    axis: "y",
                    startPtr: e.clientY,
                    startScroll: view.scrollDOM.scrollTop,
                  };
                  vScrollRef.current?.classList.add("is-active");
                }}
              />
            </div>
            {/* Scroll X — chỉ thumb, dưới vùng code */}
            <div ref={hScrollRef} className="editor-hscroll" onPointerDown={(e) => e.stopPropagation()}>
              <div
                ref={hThumbRef}
                className="editor-hscroll-thumb"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const view = editorViewRef.current;
                  if (!view) return;
                  dragRef.current = {
                    axis: "x",
                    startPtr: e.clientX,
                    startScroll: view.scrollDOM.scrollLeft,
                  };
                  hScrollRef.current?.classList.add("is-active");
                }}
              />
            </div>
          </div>

          {/* ─── Resize Handle ─── */}
          <div
            className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center border-t border-[var(--color-line)] bg-[var(--color-bg2)]/60 transition hover:bg-[var(--color-copper)]/15 active:bg-[var(--color-copper)]/25"
            onMouseDown={(e) => {
              e.preventDefault();
              splitterRef.current = { startY: e.clientY, startH: resultH };
              document.body.style.cursor = "row-resize";
              document.body.style.userSelect = "none";
            }}
            onDoubleClick={() => {
              setResultH(290);
              try { localStorage.setItem("judge-result-h", "290"); } catch { /* */ }
            }}
            title="Kéo để thay đổi chiều cao · Nhấp đúp để đặt lại"
          >
            <div className="h-0.5 w-10 rounded-full bg-[var(--color-muted)]/40 transition group-hover:bg-[var(--color-copper)]/70 group-hover:w-14" />
          </div>

          {/* Bottom Results Panel */}
          <div
            style={{ height: resultH }}
            className="flex min-h-[100px] shrink-0 flex-col bg-[var(--color-card)]/70"
            onFocusCapture={() => {
              editorSurfaceRef.current = false;
            }}
          >
            {/* Results Panel Header */}
            <div className="flex items-center justify-between border-b border-[var(--color-line)]/80 bg-[var(--color-bg2)]/60 px-4 py-2 text-xs">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[var(--color-ink)]">
                  <span>📊 Kết quả chấm</span>
                </div>

                {judging && (
                  <span className="pulse-soft flex items-center gap-1.5 rounded-md bg-[var(--color-copper)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--color-copper)]">
                    <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-copper)] animate-ping" />
                    Đang biên dịch & chấm {selected?.testCount ?? 0} test…
                  </span>
                )}

                {!judging && result && (
                  <div className="flex items-center gap-2">
                    <VerdictBadge v={result.status} />
                    <span className="font-mono text-xs text-[var(--color-muted)]">
                      {result.tests.filter((t) => t.status === "ACCEPTED").length}/
                      {result.tests.length} test đúng
                    </span>
                    {result.tests.length > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-bg3)] px-2 py-0.5 text-xs text-[var(--color-muted)]">
                        Thời gian tối đa
                        <span className="font-mono font-semibold text-[var(--color-ink)]">
                          {Math.max(...result.tests.map((t) => t.time_ms ?? 0))} ms
                        </span>
                      </span>
                    )}
                  </div>
                )}

                {!judging && !result && !error && (
                  <span className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
                    <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-ok)] opacity-70" />
                    Sẵn sàng chấm bài
                  </span>
                )}
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setResultTab((t) => (t === "run" ? "summary" : "run"))}
                  className={`rounded px-2.5 py-1 text-xs transition ${
                    resultTab === "run"
                      ? "bg-[var(--color-copper)]/15 font-semibold text-[var(--color-copper)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  }`}
                  title={resultTab === "run" ? "Tắt chế độ chạy thử" : "Bật chế độ chạy thử"}
                >
                  {resultTab === "run" ? "✕ Tắt chạy thử" : "▶ Chạy thử"}
                </button>
                {result && resultTab !== "run" && (
                  <>
                    <button
                      onClick={() => setResultTab("summary")}
                      className={`rounded px-2.5 py-1 text-xs transition ${
                        resultTab === "summary"
                          ? "bg-[var(--color-bg3)] font-semibold text-[var(--color-ink)]"
                          : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                      }`}
                    >
                      Danh sách test ({result.tests.length})
                    </button>
                    <button
                      onClick={() => setResultTab("inspect")}
                      className={`rounded px-2.5 py-1 text-xs transition ${
                        resultTab === "inspect"
                          ? "bg-[var(--color-bg3)] font-semibold text-[var(--color-ink)]"
                          : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                      }`}
                    >
                      Chi tiết test {picked ? `(${picked.name})` : ""}
                    </button>
                    {result.compiler_output && (
                      <button
                        onClick={() => setResultTab("compiler")}
                        className={`rounded px-2.5 py-1 text-xs transition ${
                          resultTab === "compiler"
                            ? "bg-[var(--color-bg3)] font-semibold text-[var(--color-ce)]"
                            : "text-[var(--color-ce)]/80 hover:text-[var(--color-ce)]"
                        }`}
                      >
                        Log biên dịch
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Results Panel Body */}
            <div className="min-h-0 flex-1 overflow-hidden p-4">
              {error && resultTab !== "run" && (
                <div className="rounded-lg border border-[var(--color-bad)]/30 bg-[var(--color-bad)]/10 p-3.5 text-sm text-[var(--color-bad)]">
                  <div className="font-semibold">⚠️ Có lỗi xảy ra trong quá trình chấm:</div>
                  <div className="mt-1 font-mono text-xs">{error}</div>
                </div>
              )}

              {/* ── Run tab ── */}
              {resultTab === "run" && (
                <div className="flex h-full min-h-0 gap-4">
                  {/* Input */}
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="mb-2 flex h-8 items-center justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                        Dữ liệu vào
                      </div>
                      <button
                        onClick={() => setRunInput("")}
                        className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg2)] px-2.5 py-1.5 text-[10px] font-medium text-[var(--color-muted)] transition hover:border-[var(--color-copper)]/40 hover:text-[var(--color-ink)]"
                      >
                        Xóa input
                      </button>
                    </div>
                    <textarea
                      value={runInput}
                      onChange={(e) => setRunInput(e.target.value)}
                      placeholder="Nhập dữ liệu input tại đây…"
                      spellCheck={false}
                      className="scroll-thin min-h-0 flex-1 resize-none rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-3 font-mono text-xs text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)]/50 focus:border-[var(--color-copper)]/60"
                    />
                  </div>
                  {/* Output */}
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="mb-2 flex h-8 items-center justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                        Kết quả chạy thử
                      </div>
                      <button
                        disabled={running || !source.trim()}
                        onClick={async () => {
                          setRunning(true);
                          setRunOutput(null);
                          try {
                            const r = await api.run(source, runInput);
                            setRunOutput(r);
                          } catch (e) {
                            setRunOutput({ output: "", stderr: e instanceof Error ? e.message : String(e), exitCode: null, timeMs: 0, timedOut: false, compilerOutput: "" });
                          } finally {
                            setRunning(false);
                          }
                        }}
                        className={`flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[10px] font-semibold shadow-sm transition disabled:opacity-40 ${
                          running
                            ? "busy"
                            : "bg-[var(--color-copper)] text-[#1a1208] hover:bg-[var(--color-copper2)] active:scale-[0.98]"
                        }`}
                      >
                        {running ? "Đang chạy…" : "▶ Chạy thử"}
                      </button>
                    </div>
                    <div className="scroll-thin min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
                      {runOutput?.compilerOutput ? (
                        <div className="rounded-lg border border-[var(--color-ce)]/25 bg-[var(--color-ce)]/8 p-3">
                          <div className="mb-2 flex items-center gap-2">
                            <span className="rounded-md bg-[var(--color-ce)]/14 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-ce)]">
                              Lỗi biên dịch
                            </span>
                          </div>
                          <pre className="font-mono text-xs text-[var(--color-ce)] whitespace-pre-wrap">{runOutput.compilerOutput}</pre>
                        </div>
                      ) : runOutput ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            {(() => {
                              const ok = !runOutput.timedOut && runOutput.exitCode === 0;
                              const tle = runOutput.timedOut;
                              const label = tle ? "Quá thời gian" : ok ? "Thành công" : "Lỗi khi chạy";
                              const color = tle
                                ? "text-[var(--color-tle)]"
                                : ok
                                  ? "text-[var(--color-ok)]"
                                  : "text-[var(--color-bad)]";
                              const bg = tle
                                ? "bg-[var(--color-tle)]/15"
                                : ok
                                  ? "bg-[var(--color-ok)]/15"
                                  : "bg-[var(--color-bad)]/15";
                              return (
                                <span className={`inline-flex items-center gap-1.5 font-semibold ${color}`}>
                                  <span className={`flex h-6 w-6 items-center justify-center rounded-md text-sm font-bold leading-none ${bg}`}>
                                    {tle ? "⏱" : ok ? "✓" : "✕"}
                                  </span>
                                  {label}
                                </span>
                              );
                            })()}
                            <span className="text-[var(--color-muted)]">
                              Thời gian{" "}
                              <span className="font-mono font-semibold text-[var(--color-ink)]">
                                {runOutput.timeMs} ms
                              </span>
                            </span>
                          </div>

                          <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg2)]/35">
                            <div className="border-b border-[var(--color-line)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                              Kết quả chương trình
                            </div>
                            <div className="p-3">
                              {runOutput.output ? (
                                <pre className="font-mono text-xs text-[var(--color-ink)] whitespace-pre-wrap">{runOutput.output}</pre>
                              ) : (
                                <span className="text-xs italic text-[var(--color-muted)]">Không có kết quả.</span>
                              )}
                            </div>
                          </div>

                          {!!runOutput.stderr && (
                            <div className="rounded-lg border border-[var(--color-bad)]/25 bg-[var(--color-bad)]/6">
                              <div className="border-b border-[var(--color-bad)]/18 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-bad)]">
                                Thông báo lỗi
                              </div>
                              <div className="p-3">
                                <pre className="font-mono text-xs text-[var(--color-bad)] whitespace-pre-wrap">{runOutput.stderr}</pre>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : running ? (
                        <div className="flex h-full items-center justify-center text-xs text-[var(--color-muted)]">
                          <span className="pulse-soft">Đang biên dịch & chạy…</span>
                        </div>
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <div className="max-w-xs rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-bg2)]/30 px-5 py-6 text-center">
                            <div className="text-base font-semibold text-[var(--color-ink)]">Chưa có kết quả</div>
                            <div className="mt-2 text-xs leading-5 text-[var(--color-muted)]">
                              Nhập input bên trái rồi bấm <span className="font-semibold text-[var(--color-copper)]">Chạy thử</span> để xem kết quả.
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── State 1: Chưa chấm (Sẵn sàng) ── */}
              {resultTab !== "run" && !result && !judging && !error && (
                <div className="flex h-full flex-col justify-center">
                  <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg2)]/60 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                        Số Test Case
                      </div>
                      <div className="mt-1 font-mono text-lg font-bold text-[var(--color-ink)]">
                        {selected?.testCount ?? 0}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg2)]/60 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                        Giới Hạn Thời Gian
                      </div>
                      <div className="mt-1 font-mono text-lg font-bold text-[var(--color-ink)]">
                        {selected?.timeLimitMs ?? 1000} ms
                      </div>
                    </div>
                    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg2)]/60 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                        Kiểu So Sánh
                      </div>
                      <div className="mt-1 truncate font-mono text-sm font-semibold text-[var(--color-ink)]">
                        {selected?.checkerType === "exact" ? "Khớp chính xác" : "So khớp từ"}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg2)]/60 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                        Chế Độ I/O
                      </div>
                      <div className="mt-1 truncate font-mono text-sm font-semibold text-[var(--color-ink)]">
                        {selected?.ioMode === "file"
                          ? "Qua file"
                          : selected?.ioMode === "stdio"
                            ? "Bàn phím"
                            : "Tự động"}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 text-center text-xs text-[var(--color-muted)]">
                    Bấm nút <strong className="text-[var(--color-copper)]">▶ Chấm bài</strong> để bắt đầu kiểm thử.
                  </div>
                </div>
              )}

              {/* ── State 2: Đang chấm ── */}
              {resultTab !== "run" && judging && (
                <div className="flex h-full flex-col items-center justify-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-copper)]/15 text-[var(--color-copper)]">
                    <IconSubmit className="h-6 w-6 animate-pulse" />
                  </div>
                  <div className="text-sm font-semibold text-[var(--color-ink)]">
                    Đang biên dịch và thực thi bài nộp…
                  </div>
                  <div className="max-w-md text-center text-xs text-[var(--color-muted)]">
                    Chương trình đang được chấm lần lượt trên {selected?.testCount ?? 0} test cases theo giới hạn {selected?.timeLimitMs ?? 1000}ms.
                  </div>
                </div>
              )}

              {/* ── State 3: Có kết quả ── */}
              {resultTab !== "run" && result && !judging && (
                <div className="flex h-full min-h-0 flex-col">
                  {resultTab === "compiler" && (
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ce)]">
                          Nhật ký biên dịch
                        </div>
                      </div>
                      <pre className="scroll-thin max-h-[200px] overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-3 font-mono text-xs text-[var(--color-ce)] whitespace-pre-wrap">{result.compiler_output || "Biên dịch thành công không có cảnh báo nào."}</pre>
                    </div>
                  )}

                  {resultTab === "summary" && (
                    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                      <div className="flex min-h-0 flex-col">
                        {result.status === "COMPILATION_ERROR" && (
                          <div className="mb-3 shrink-0 rounded-lg border border-[var(--color-ce)]/30 bg-[var(--color-ce)]/10 p-3">
                            <div className="text-xs font-semibold text-[var(--color-ce)]">
                              ⚠️ Lỗi biên dịch (Compilation Error)
                            </div>
                            <pre className="scroll-thin mt-2 max-h-32 overflow-auto font-mono text-xs text-[var(--color-ce)]">{result.compiler_output}</pre>
                          </div>
                        )}

                        <div className="scroll-thin min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-bg2)]/40">
                          {result.tests.map((t, i) => (
                            <button
                              key={`${t.name}-${i}`}
                              onClick={() => {
                                setPicked(t);
                              }}
                              className={`test-row flex w-full items-center justify-between border-b border-[var(--color-line)]/50 px-3 py-2 text-left text-xs transition hover:bg-[var(--color-hover)] ${
                                picked?.name === t.name ? "bg-[var(--color-bg3)] font-semibold" : ""
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                <span className={`w-4 text-center font-bold ${verdictClass(t.status)}`}>
                                  {verdictMark(t.status)}
                                </span>
                                <span className="font-mono text-[var(--color-ink)]">{t.name}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-[var(--color-muted)]">
                                  {t.time_ms == null ? "—" : `${t.time_ms} ms`}
                                </span>
                                <span className={`w-28 text-right font-medium ${verdictClass(t.status)}`}>
                                  {VERDICT_LABEL[t.status]}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="scroll-thin min-h-0 overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-bg2)]/40 p-3">
                        <TestInspect test={picked} />
                      </div>
                    </div>
                  )}

                  {resultTab === "inspect" && (
                    <div className="scroll-thin h-full overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-bg2)]/40 p-4">
                      <TestInspect test={picked} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── Right Sidebar: Submission History for Selected Problem ─── */}
        {showHistory && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-[var(--color-line)] bg-[var(--color-bg2)]/40 xl:w-96">
            {/* Sidebar Header */}
            <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-[var(--color-ink)]">
                  📜 Lịch sử nộp bài này
                </span>
                <span className="rounded-full bg-[var(--color-bg3)] px-2 py-0.5 font-mono text-[11px] font-bold text-[var(--color-copper)]">
                  {problemSubs.length}
                </span>
              </div>
              <button
                onClick={() => void loadProblemHistory()}
                disabled={loadingSubs}
                className="rounded p-1 text-xs text-[var(--color-muted)] transition hover:bg-[var(--color-bg3)] hover:text-[var(--color-ink)]"
                title="Tải lại lịch sử"
              >
                {loadingSubs ? "⏳" : "🔄"}
              </button>
            </div>

            {/* Sidebar Submissions List */}
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
              {loadingSubs && problemSubs.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--color-muted)]">
                  Đang tải lịch sử…
                </div>
              ) : problemSubs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-[var(--color-muted)]">
                  <span className="text-2xl opacity-40">📥</span>
                  <div className="mt-2 font-medium">Chưa có lượt nộp nào cho bài này</div>
                  <div className="mt-1 max-w-[200px] text-[11px] text-[var(--color-muted)]/70">
                    Mã nguồn và kết quả sau khi bạn bấm Chấm bài sẽ tự động hiển thị tại đây.
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {problemSubs.map((sub, i) => (
                    <div
                      key={sub.id}
                      style={{ animationDelay: `${i * 20}ms` }}
                      className="rise rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] p-3 transition hover:border-[var(--color-copper)]/40"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-[var(--color-muted)]">
                            #{sub.id}
                          </span>
                          <VerdictBadge v={sub.status} />
                        </div>
                        <span className="text-[11px] text-[var(--color-muted)]">
                          {timeAgo(sub.createdAt)}
                        </span>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-xs text-[var(--color-muted)]">
                        <span className="font-mono">
                          {sub.acceptedCount}/{sub.totalCount} test đúng
                        </span>
                        {sub.maxTimeMs != null && (
                          <span className="font-mono">⏱ {sub.maxTimeMs} ms</span>
                        )}
                      </div>

                      {/* Quick actions on card */}
                      <div className="mt-2.5 flex items-center justify-end gap-1.5 border-t border-[var(--color-line)]/50 pt-2">
                        <button
                          onClick={() => void openSubmissionDetail(sub.id)}
                          className="rounded bg-[var(--color-bg3)] px-2 py-1 text-[11px] font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
                        >
                          Chi tiết
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const d = await api.submission(sub.id);
                              loadSubmission({ source: d.source, problemId: d.problemId, result: subToResult(d) });
                            } catch (e) {
                              alert("Không thể nạp code: " + String(e));
                            }
                          }}
                          className="rounded bg-[var(--color-copper)]/15 px-2 py-1 text-[11px] font-medium text-[var(--color-copper)] transition hover:bg-[var(--color-copper)] hover:text-[#1a1208]"
                        >
                          👁 Xem ở Editor
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sidebar Footer */}
            <div className="border-t border-[var(--color-line)] bg-[var(--color-bg2)]/30 px-3 py-2 text-center text-[10px] text-[var(--color-muted)]">
              Tự động lưu & đồng bộ sau mỗi lần nộp
            </div>
          </aside>
        )}
      </div>

      {/* ─── Submission Detail Modal ─── */}
      {viewingSub && (
        <Modal onClose={() => setViewingSub(null)} title={`Chi tiết Lần nộp #${viewingSub.id}`}>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
              <div>
                <div className="text-sm font-semibold text-[var(--color-ink)]">
                  {viewingSub.problemName}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <VerdictBadge v={viewingSub.status} />
                  <span className="font-mono text-xs text-[var(--color-muted)]">
                    {viewingSub.acceptedCount}/{viewingSub.totalCount} test đúng • {timeAgo(viewingSub.createdAt)}
                  </span>
                </div>
              </div>
            </div>

            {/* Test results */}
            {viewingSub.tests && viewingSub.tests.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                  Kết quả từng Test case
                </div>
                <div className="scroll-thin max-h-[160px] overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)]">
                  {viewingSub.tests.map((t, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-b border-[var(--color-line)]/40 px-3 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`font-bold ${verdictClass(t.status)}`}>
                          {verdictMark(t.status)}
                        </span>
                        <span className="font-mono">{t.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[var(--color-muted)]">
                          {t.time_ms == null ? "—" : `${t.time_ms}ms`}
                        </span>
                        <span className={verdictClass(t.status)}>{VERDICT_LABEL[t.status]}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {viewingSub.compilerOutput && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ce)]">
                  Nhật ký biên dịch
                </div>
                <pre className="scroll-thin max-h-24 overflow-auto rounded-lg bg-[var(--color-bg)] p-2.5 font-mono text-xs text-[var(--color-ce)]">{viewingSub.compilerOutput}</pre>
              </div>
            )}

            {/* Source code */}
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                Mã nguồn C++
              </div>
              <pre className="scroll-thin max-h-[220px] overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-3 font-mono text-xs whitespace-pre-wrap">{viewingSub.source}</pre>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(viewingSub.source);
                  setCopiedSub(true);
                  setTimeout(() => setCopiedSub(false), 2000);
                }}
                className="rounded-lg bg-[var(--color-bg3)] px-4 py-2 text-xs font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
              >
                {copiedSub ? "✓ Đã sao chép" : "📋 Sao chép code"}
              </button>
              <button
                onClick={() => {
                  loadSubmission({ source: viewingSub.source, problemId: viewingSub.problemId, result: subToResult(viewingSub) });
                  setViewingSub(null);
                }}
                className="rounded-lg bg-[var(--color-copper)] px-4 py-2 text-xs font-semibold text-[#1a1208] transition hover:bg-[var(--color-copper2)]"
              >
                👁 Xem ở Editor
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Problems Page ──────────────────────────────────────────────────────────

function ProblemsPage(props: {
  problems: Problem[];
  refresh: () => Promise<void>;
  openDetail: (id: number) => void;
  setPage: (p: Page) => void;
  setSelectedId: (id: number) => void;
}) {
  const { problems, openDetail, refresh, setPage, setSelectedId } = props;
  const [stats, setStats] = useState<ProblemStat[]>([]);
  const [over, setOver] = useState(false);
  const [importing, setImporting] = useState("");
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<null | { ids: number[]; names: string[] }>(null);

  useEffect(() => {
    api.problemStats().then(setStats).catch(() => {});
  }, [problems]);

  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(problems.map((p) => p.id));
      const next = new Set<number>();
      for (const id of prev) if (ids.has(id)) next.add(id);
      return next;
    });
  }, [problems]);

  function statFor(pid: number) {
    return stats.find((s) => s.problemId === pid);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return problems;
    return problems.filter((p) => p.name.toLowerCase().includes(q));
  }, [problems, query]);

  const allSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const someSelected = selected.size > 0;

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of filtered) next.add(p.id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function handleFiles(files: { relativePath: string; file: File }[]) {
    if (!files.length) return;
    setImporting("Đang đọc gói test…");
    try {
      const form = new FormData();
      for (const f of files) {
        form.append("files", f.file, f.file.name);
        form.append("relativePaths", f.relativePath);
      }
      const preview = await api.importPackage(form);
      const items = preview.items?.length ? preview.items : [preview];
      const totalTests = items.reduce((s, p) => s + p.testCount, 0);
      if (items.length > 1) {
        setImporting(
          `Đã nhận diện ${items.length} bài (${items.map((p) => p.name).join(", ")}) · ${totalTests} test. Đang lưu…`,
        );
      } else {
        setImporting(`Đã nhận diện ${preview.testCount} test cases. Đang lưu…`);
      }
      await api.createProblem({
        importId: preview.importId,
        name: items.length === 1 ? preview.name : undefined,
        timeLimitMs: preview.timeLimitMs || 1000,
      });
      await refresh();
      setImporting("");
    } catch (e) {
      setImporting("");
      alert("Import thất bại: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  function askDeleteSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    const names = problems.filter((p) => selected.has(p.id)).map((p) => p.name);
    setDeleteConfirm({ ids, names });
  }

  function askDeleteOne(p: Problem) {
    setDeleteConfirm({ ids: [p.id], names: [p.name] });
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    const { ids } = deleteConfirm;
    setBusy("Đang xóa…");
    try {
      if (ids.length === 1) await api.deleteProblem(ids[0]);
      else await api.deleteProblems(ids);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      setDeleteConfirm(null);
      await refresh();
    } catch (e) {
      alert("Xóa thất bại: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy("");
    }
  }

  async function exportSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy("Đang nén…");
    try {
      const { blob, filename } = await api.exportProblemsZip(ids);
      const result = await saveBlobToFolder(blob, filename);
      if (result === "cancelled") return;
    } catch (e) {
      alert("Nén thất bại: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ─── Left: Import Zone ─── */}
      <div className="flex w-80 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-bg2)]/40 xl:w-96">
        <div className="border-b border-[var(--color-line)] px-5 py-3">
          <h2 className="font-display text-lg font-bold text-[var(--color-ink)]">Tạo bài tập</h2>
        </div>

        <div className="flex flex-1 flex-col gap-4 p-5">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void collectDroppedFiles(e.dataTransfer).then(handleFiles);
            }}
            className={`flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 text-center transition ${
              over
                ? "border-[var(--color-copper)] bg-[var(--color-copper)]/10"
                : "border-[var(--color-line)] hover:border-[var(--color-muted)]"
            }`}
          >
            <div className="text-4xl opacity-60">📁</div>
            <div className="mt-3 font-display text-base font-bold text-[var(--color-ink)]">
              Thả gói test tại đây
            </div>
            <p className="mt-1.5 max-w-[260px] text-xs leading-5 text-[var(--color-muted)]">
              ZIP/thư mục Themis — một bài hoặc nhiều bài (<code className="text-[var(--color-copper)]">GOM/BAI1</code>, <code className="text-[var(--color-copper)]">BAI2</code>…)
            </p>

            {importing && (
              <div className="pulse-soft mt-4 rounded-lg bg-[var(--color-copper)]/15 px-3 py-2 text-xs font-semibold text-[var(--color-copper)]">
                {importing}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2">
              <label className="cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-bg3)] px-4 py-2 text-center text-xs font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]">
                📦 Chọn file ZIP
                <input type="file" accept=".zip" className="hidden" onChange={(e) => {
                  void handleFiles([...(e.target.files || [])].map((f) => ({ relativePath: f.name, file: f })));
                }} />
              </label>
              <label className="cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-bg3)] px-4 py-2 text-center text-xs font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]">
                📂 Chọn thư mục
                {/* @ts-expect-error webkitdirectory non-standard */}
                <input type="file" className="hidden" multiple webkitdirectory="" onChange={(e) => {
                  void handleFiles([...(e.target.files || [])].map((f) => ({ relativePath: f.webkitRelativePath || f.name, file: f })));
                }} />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Right: Problem List ─── */}
      <div className="scroll-thin min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <h2 className="font-display text-xl font-bold text-[var(--color-ink)]">
                Danh sách bài tập
              </h2>
              <p className="text-sm text-[var(--color-muted)]">
                {query.trim()
                  ? `${filtered.length}/${problems.length} bài khớp`
                  : `${problems.length} bài tập`}
                {someSelected ? ` · đã chọn ${selected.size}` : ""}
              </p>
            </div>
            {problems.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={allSelected ? clearSelection : selectAll}
                  className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg2)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-bg3)]"
                >
                  {allSelected ? "Bỏ chọn hết" : "Chọn hết"}
                </button>
                <button
                  type="button"
                  disabled={!someSelected || Boolean(busy)}
                  onClick={() => void exportSelected()}
                  className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg2)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] transition hover:border-[var(--color-copper)]/50 hover:bg-[var(--color-bg3)] disabled:pointer-events-none disabled:opacity-40"
                >
                  {busy === "Đang nén…" ? "Đang nén…" : "Nén ZIP"}
                </button>
                <button
                  type="button"
                  disabled={!someSelected || Boolean(busy)}
                  onClick={askDeleteSelected}
                  className="rounded-lg border border-[var(--color-bad)]/40 bg-[var(--color-bad)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-bad)] transition hover:bg-[var(--color-bad)]/20 disabled:pointer-events-none disabled:opacity-40"
                >
                  {busy === "Đang xóa…" ? "Đang xóa…" : "Xóa đã chọn"}
                </button>
              </div>
            )}
          </div>

          {problems.length > 0 && (
            <div className="relative mb-4">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3-3" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm theo tên bài…"
                className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-bg2)] py-2.5 pl-9 pr-3 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-copper)]/60"
              />
            </div>
          )}

          {busy && busy !== "Đang nén…" && busy !== "Đang xóa…" && (
            <div className="mb-3 text-xs text-[var(--color-muted)]">{busy}</div>
          )}

          {problems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--color-line)] px-6 py-16 text-center">
              <div className="text-3xl">📦</div>
              <div className="mt-3 font-display text-lg font-bold text-[var(--color-ink)]">
                Chưa có bài tập nào
              </div>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Kéo thả gói test vào bên trái để tạo bài tập đầu tiên.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--color-line)] px-6 py-12 text-center">
              <div className="font-display text-base font-bold text-[var(--color-ink)]">
                Không tìm thấy bài nào
              </div>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Thử từ khóa khác hoặc xóa ô tìm kiếm.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map((p, i) => {
                const s = statFor(p.id);
                const checked = selected.has(p.id);
                return (
                  <div
                    key={p.id}
                    style={{ animationDelay: `${i * 30}ms` }}
                    className={`rise flex items-center justify-between gap-3 rounded-xl border px-4 py-4 transition sm:px-5 ${
                      checked
                        ? "border-[var(--color-copper)]/50 bg-[var(--color-copper)]/5"
                        : "border-[var(--color-line)] bg-[var(--color-card)] hover:border-[var(--color-copper)]/40"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                      <label className="flex shrink-0 cursor-pointer items-center self-stretch py-1">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(p.id)}
                          className="h-4 w-4 cursor-pointer accent-[var(--color-copper)]"
                          aria-label={`Chọn ${p.name}`}
                        />
                      </label>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-copper)]/15 font-mono text-base font-bold text-[var(--color-copper)]">
                        {p.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                          <span className="truncate font-semibold text-[var(--color-ink)]">{p.name}</span>
                          {s?.bestStatus === "ACCEPTED" && (
                            <span className="rounded bg-[var(--color-ok)]/15 px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-ok)]">
                              ✓ Đúng
                            </span>
                          )}
                          {s && s.bestStatus && s.bestStatus !== "ACCEPTED" && (
                            <span className="rounded bg-[var(--color-bad)]/15 px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-bad)]">
                              ✗ Chưa đúng
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-[var(--color-muted)]">
                          <span className="rounded bg-[var(--color-bg3)] px-1.5 py-0.5">
                            {p.testCount} tests
                          </span>
                          <span className="rounded bg-[var(--color-bg3)] px-1.5 py-0.5">
                            {p.timeLimitMs} ms
                          </span>
                          <span className="rounded bg-[var(--color-bg3)] px-1.5 py-0.5">
                            {p.checkerType}
                          </span>
                          {s ? (
                            <span className="rounded bg-[var(--color-bg3)] px-1.5 py-0.5">
                              📊 {s.submissionCount} lượt nộp
                            </span>
                          ) : (
                            <span className="rounded bg-[var(--color-bg3)] px-1.5 py-0.5 italic">
                              Chưa nộp
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { setSelectedId(p.id); setPage("judge"); }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-copper)] px-3.5 py-1.5 text-xs font-semibold text-[#1a1208] transition hover:bg-[var(--color-copper2)]"
                      >
                        <IconSubmit className="h-3.5 w-3.5" />
                        Nộp bài
                      </button>
                      <button
                        type="button"
                        onClick={() => openDetail(p.id)}
                        className="rounded-lg bg-[var(--color-bg3)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
                      >
                        Cài đặt
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => askDeleteOne(p)}
                        className="rounded-lg border border-[var(--color-bad)]/35 bg-[var(--color-bad)]/10 px-3.5 py-1.5 text-xs font-semibold text-[var(--color-bad)] transition hover:bg-[var(--color-bad)]/20 disabled:opacity-40"
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {deleteConfirm && (
        <ConfirmDialog
          title={deleteConfirm.ids.length === 1 ? "Xóa bài tập?" : `Xóa ${deleteConfirm.ids.length} bài tập?`}
          confirmLabel="Xóa"
          busy={busy === "Đang xóa…"}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => void confirmDelete()}
        >
          <p className="text-sm leading-6 text-[var(--color-muted)]">
            {deleteConfirm.ids.length === 1 ? (
              <>
                Bạn sắp xóa bài{" "}
                <span className="font-semibold text-[var(--color-ink)]">{deleteConfirm.names[0]}</span>.
                Toàn bộ test và lịch sử nộp sẽ bị xóa và không hoàn tác được.
              </>
            ) : (
              <>
                Bạn sắp xóa{" "}
                <span className="font-semibold text-[var(--color-ink)]">{deleteConfirm.ids.length} bài</span>{" "}
                đã chọn. Dữ liệu liên quan sẽ mất vĩnh viễn và không hoàn tác được.
              </>
            )}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

async function saveTextAsFile(content: string): Promise<"saved" | "download" | "cancelled"> {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const w = window as Window & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      excludeAcceptAllOption?: boolean;
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob | string) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };

  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        excludeAcceptAllOption: false,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // fall through
    }
  }

  const name = window.prompt("Đặt tên file (kèm đuôi nếu cần):", "");
  if (name == null || !name.trim()) return "cancelled";

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.trim();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return "download";
}

async function saveBlobToFolder(blob: Blob, filename: string): Promise<"folder" | "download" | "cancelled"> {
  const w = window as Window & {
    showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<{
      getFileHandle: (
        name: string,
        opts?: { create?: boolean },
      ) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }>;
  };

  if (typeof w.showDirectoryPicker === "function") {
    try {
      const dir = await w.showDirectoryPicker({ mode: "readwrite" });
      const fileHandle = await dir.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "folder";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // fall through — e.g. permission denied
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return "download";
}

// ─── History Page ───────────────────────────────────────────────────────────

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatMonthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleDateString("vi-VN", {
    month: "long",
    year: "numeric",
  });
}

/** Calendar grid for one month: rows = weeks (Mon→Sun). */
function buildMonthContribution(daily: DailyActivity[], year: number, month: number) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const today = startOfDay(new Date());
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startOffset = (first.getDay() + 6) % 7; // Mon=0
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startOffset);

  const weeks: {
    key: string;
    days: ({ date: string; count: number; ac: number } | null)[];
  }[] = [];

  let totalCount = 0;
  let maxCount = 0;
  let cursor = new Date(gridStart);

  for (;;) {
    const monday = new Date(cursor);
    const days: ({ date: string; count: number; ac: number } | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      const inMonth = day.getMonth() === month && day.getFullYear() === year;
      if (!inMonth) {
        days.push(null);
        continue;
      }
      // All days in the month get a cell (including future days → empty)
      const key = toDateKey(day);
      const hit = day > today ? undefined : byDate.get(key);
      const count = hit?.submissionCount ?? 0;
      const ac = hit?.acceptedCount ?? 0;
      if (day <= today) {
        totalCount += count;
        if (count > maxCount) maxCount = count;
      }
      days.push({ date: key, count, ac });
    }
    weeks.push({ key: toDateKey(monday), days });
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    if (sunday >= last) break;
    cursor.setDate(cursor.getDate() + 7);
  }

  function levelOf(count: number) {
    if (count <= 0) return 0;
    if (maxCount <= 1) return count > 0 ? 4 : 0;
    const ratio = count / maxCount;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
    return 4;
  }

  return { weeks, totalCount, maxCount, levelOf };
}

function isFutureMonth(year: number, month: number, now = new Date()): boolean {
  return year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth());
}

function shiftMonth(year: number, month: number, delta: number) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function HistoryPage(props: {
  problems: Problem[];
  loadSubmission: (sub: { source: string; problemId: number; result?: JudgeResult }) => void;
}) {
  const { problems, loadSubmission } = props;
  const [subs, setSubs] = useState<SubmissionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<number | null>(null);
  const [viewSub, setViewSub] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [monthly, setMonthly] = useState<MonthlyActivity[]>([]);
  const [daily, setDaily] = useState<DailyActivity[]>([]);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [hoverDay, setHoverDay] = useState<{ date: string; count: number; ac: number } | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  async function load(problemId: number | null) {
    setLoading(true);
    try {
      const r = await api.submissions({ problemId: problemId ?? undefined, limit: 100 });
      setSubs(r.items);
      setTotal(r.total);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { void load(filter); }, [filter]);
  useEffect(() => {
    api.monthlyActivity().then(setMonthly).catch(() => {});
    api.dailyActivity(2000).then(setDaily).catch(() => {});
  }, []);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function viewCode(id: number) {
    const sub = await api.submission(id);
    setViewSub(sub);
  }

  async function copyCode() {
    if (!viewSub) return;
    await navigator.clipboard.writeText(viewSub.source);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function resubmit() {
    if (!viewSub) return;
    loadSubmission({ source: viewSub.source, problemId: viewSub.problemId, result: subToResult(viewSub) });
    setViewSub(null);
  }

  const totalSubs = monthly.reduce((s, m) => s + m.submissionCount, 0);
  const totalAc = monthly.reduce((s, m) => s + m.acceptedCount, 0);
  const uniqueProblems = new Set(subs.map((s) => s.problemId)).size;

  // Never stay on a future month
  useEffect(() => {
    if (isFutureMonth(viewYear, viewMonth)) {
      const now = new Date();
      setViewYear(now.getFullYear());
      setViewMonth(now.getMonth());
    }
  }, [viewYear, viewMonth]);

  const nextMonth = shiftMonth(viewYear, viewMonth, 1);
  const canGoNext = !isFutureMonth(nextMonth.year, nextMonth.month);

  const contrib = useMemo(
    () => buildMonthContribution(daily, viewYear, viewMonth),
    [daily, viewYear, viewMonth],
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ─── Left: Monthly Activity Stats ─── */}
      <div className="flex w-80 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-bg2)]/40 xl:w-96">
        <div className="border-b border-[var(--color-line)] px-5 py-3">
          <h2 className="font-display text-lg font-bold text-[var(--color-ink)]">Thống kê</h2>
        </div>

        <div className="scroll-thin flex-1 overflow-auto p-5">
          {/* Summary cards */}
          <div className="mb-5 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-3 text-center">
              <div className="font-mono text-2xl font-bold text-[var(--color-copper)]">{total}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">Tổng lượt nộp</div>
            </div>
            <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-3 text-center">
              <div className="font-mono text-2xl font-bold text-[var(--color-ok)]">{totalAc}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">Đúng</div>
            </div>
            <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-3 text-center">
              <div className="font-mono text-2xl font-bold text-[var(--color-ink)]">{uniqueProblems}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">Bài đã nộp</div>
            </div>
            <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-3 text-center">
              <div className="font-mono text-2xl font-bold text-[var(--color-ink)]">
                {totalSubs > 0 ? `${Math.round((totalAc / totalSubs) * 100)}%` : "—"}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">Tỷ lệ đúng</div>
            </div>
          </div>

          {/* Monthly contribution grid */}
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                Hoạt động
              </div>
              <div className="font-mono text-[10px] text-[var(--color-muted)]">
                {contrib.totalCount} nộp
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)]/70 p-3">
              {/* Month / year navigator */}
              <div className="mb-3 flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Tháng trước"
                  onClick={() => {
                    const prev = shiftMonth(viewYear, viewMonth, -1);
                    setViewYear(prev.year);
                    setViewMonth(prev.month);
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-muted)] transition hover:bg-[var(--color-bg3)] hover:text-[var(--color-ink)]"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1 truncate px-2 text-center font-display text-sm font-semibold capitalize text-[var(--color-ink)]">
                  {formatMonthLabel(viewYear, viewMonth)}
                </div>
                <button
                  type="button"
                  disabled={!canGoNext}
                  aria-label="Tháng sau"
                  onClick={() => {
                    if (!canGoNext) return;
                    setViewYear(nextMonth.year);
                    setViewMonth(nextMonth.month);
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-muted)] transition hover:bg-[var(--color-bg3)] hover:text-[var(--color-ink)] disabled:pointer-events-none disabled:opacity-30"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </div>

              {/* Day headers: T2 → CN */}
              <div className="mb-1.5 grid grid-cols-7 gap-1">
                {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => (
                  <div key={d} className="text-center font-mono text-[9px] text-[var(--color-muted)]">
                    {d}
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                {contrib.weeks.map((week) => (
                  <div key={week.key} className="grid grid-cols-7 gap-1">
                    {week.days.map((day, i) => {
                      const level = day ? contrib.levelOf(day.count) : -1;
                      const title = day
                        ? `${day.date}: ${day.count} nộp · ${day.ac} đúng`
                        : "";
                      return (
                        <button
                          key={day?.date ?? `${week.key}-pad-${i}`}
                          type="button"
                          disabled={!day}
                          title={title}
                          onMouseEnter={() => day && setHoverDay({ date: day.date, count: day.count, ac: day.ac })}
                          onMouseLeave={() => setHoverDay(null)}
                          className={`aspect-square w-full rounded-[3px] transition ${
                            !day
                              ? "pointer-events-none bg-transparent"
                              : level === 0
                                ? "bg-[var(--color-bg3)] hover:ring-1 hover:ring-[var(--color-muted)]/40"
                                : level === 1
                                  ? "bg-[var(--color-ok)]/25 hover:ring-1 hover:ring-[var(--color-ok)]/50"
                                  : level === 2
                                    ? "bg-[var(--color-ok)]/45 hover:ring-1 hover:ring-[var(--color-ok)]/60"
                                    : level === 3
                                      ? "bg-[var(--color-ok)]/70 hover:ring-1 hover:ring-[var(--color-ok)]/70"
                                      : "bg-[var(--color-ok)] hover:ring-1 hover:ring-[var(--color-ok)]"
                          }`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="min-h-[28px] text-[11px] text-[var(--color-muted)]">
                  {hoverDay ? (
                    <span className="font-mono text-[var(--color-ink)]">
                      {hoverDay.date} · {hoverDay.count} nộp · {hoverDay.ac} đúng
                    </span>
                  ) : (
                    <span>Di chuột để xem chi tiết ngày</span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-[var(--color-muted)]">
                  <span>Ít</span>
                  {[0, 1, 2, 3, 4].map((lv) => (
                    <span
                      key={lv}
                      className={`inline-block h-2.5 w-2.5 rounded-[2px] ${
                        lv === 0
                          ? "bg-[var(--color-bg3)]"
                          : lv === 1
                            ? "bg-[var(--color-ok)]/25"
                            : lv === 2
                              ? "bg-[var(--color-ok)]/45"
                              : lv === 3
                                ? "bg-[var(--color-ok)]/70"
                                : "bg-[var(--color-ok)]"
                      }`}
                    />
                  ))}
                  <span>Nhiều</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Right: Submission List ─── */}
      <div className="scroll-thin min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-bold text-[var(--color-ink)]">
                Lịch sử Nộp bài
              </h2>
              <p className="mt-0.5 text-sm text-[var(--color-muted)]">
                {total} lượt nộp
              </p>
            </div>
            {(() => {
              const filtered = problems.filter((p) =>
                p.name.toLowerCase().includes(filterQuery.trim().toLowerCase()),
              );
              const current = filter != null ? problems.find((p) => p.id === filter) : null;
              return (
                <div className="relative" ref={filterRef}>
                  <button
                    type="button"
                    onClick={() => setFilterOpen((o) => !o)}
                    className="flex min-w-[220px] items-center gap-2.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-bg2)] px-3 py-2 text-left shadow-sm transition hover:border-[var(--color-copper)]/50 hover:bg-[var(--color-bg3)]"
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold ${
                      current
                        ? "bg-[var(--color-copper)]/15 text-[var(--color-copper)]"
                        : "bg-[var(--color-bg3)] text-[var(--color-muted)]"
                    }`}>
                      {current ? current.name.charAt(0).toUpperCase() : "∞"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                        Lọc theo bài
                      </div>
                      <div className="truncate text-sm font-semibold text-[var(--color-ink)]">
                        {current ? current.name : "Tất cả bài nộp"}
                      </div>
                    </div>
                    <span className={`text-xs text-[var(--color-muted)] transition ${filterOpen ? "rotate-180" : ""}`}>▾</span>
                  </button>

                  {filterOpen && (
                    <div className="absolute right-0 top-full z-30 mt-1.5 w-[320px] overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-bg2)] shadow-2xl">
                      <div className="border-b border-[var(--color-line)] p-2.5">
                        <input
                          autoFocus
                          value={filterQuery}
                          onChange={(e) => setFilterQuery(e.target.value)}
                          placeholder="Tìm bài tập…"
                          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-copper)]/50"
                        />
                      </div>
                      <div className="scroll-thin max-h-[320px] overflow-y-auto py-1">
                        <button
                          type="button"
                          onClick={() => {
                            setFilter(null);
                            setFilterOpen(false);
                            setFilterQuery("");
                          }}
                          className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-[var(--color-hover)] ${
                            filter == null ? "bg-[var(--color-bg3)]" : ""
                          }`}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-bg3)] font-mono text-xs font-bold text-[var(--color-muted)]">
                            ∞
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-[var(--color-ink)]">Tất cả bài nộp</div>
                            <div className="font-mono text-[11px] text-[var(--color-muted)]">{problems.length} bài trên hệ thống</div>
                          </div>
                          {filter == null && <span className="text-xs text-[var(--color-copper)]">●</span>}
                        </button>
                        {filtered.length === 0 ? (
                          <div className="px-4 py-8 text-center text-sm text-[var(--color-muted)]">
                            Không tìm thấy bài nào.
                          </div>
                        ) : (
                          filtered.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setFilter(p.id);
                                setFilterOpen(false);
                                setFilterQuery("");
                              }}
                              className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-[var(--color-hover)] ${
                                filter === p.id ? "bg-[var(--color-bg3)]" : ""
                              }`}
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-copper)]/15 font-mono text-xs font-bold text-[var(--color-copper)]">
                                {p.name.charAt(0).toUpperCase()}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-[var(--color-ink)]">{p.name}</div>
                                <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--color-muted)]">
                                  <span>{p.testCount} tests</span>
                                  <span>•</span>
                                  <span>{p.timeLimitMs}ms</span>
                                </div>
                              </div>
                              {filter === p.id && <span className="text-xs text-[var(--color-copper)]">●</span>}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {loading ? (
            <p className="py-12 text-center text-sm text-[var(--color-muted)]">Đang tải lịch sử…</p>
          ) : subs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--color-line)] px-6 py-16 text-center">
              <div className="text-3xl">📜</div>
              <div className="mt-3 font-display text-lg font-bold text-[var(--color-ink)]">
                Chưa có lượt nộp nào
              </div>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Sau khi nộp bài ở tab Nộp bài, các lượt nộp sẽ hiển thị tại đây.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {subs.map((s, i) => (
                <div
                  key={s.id}
                  style={{ animationDelay: `${i * 20}ms` }}
                  className="rise flex items-center justify-between rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] px-5 py-3.5 transition hover:border-[var(--color-copper)]/30"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="w-10 shrink-0 text-center font-mono text-xs font-semibold text-[var(--color-muted)]">
                      #{s.id}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className="truncate font-semibold text-[var(--color-ink)]">{s.problemName}</span>
                        <VerdictBadge v={s.status} />
                      </div>
                      <div className="mt-1 flex items-center gap-3 font-mono text-xs text-[var(--color-muted)]">
                        <span>{s.acceptedCount}/{s.totalCount} đúng</span>
                        {s.maxTimeMs != null && <span>⏱ {s.maxTimeMs} ms</span>}
                        <span>•</span>
                        <span>{timeAgo(s.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void viewCode(s.id)}
                      className="rounded-lg bg-[var(--color-bg3)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
                    >
                      Chi tiết
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Submission detail modal */}
      {viewSub && (
        <Modal onClose={() => setViewSub(null)} title={`Lần nộp #${viewSub.id}`}>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
              <div>
                <div className="text-sm font-semibold text-[var(--color-ink)]">{viewSub.problemName}</div>
                <div className="mt-1 flex items-center gap-2">
                  <VerdictBadge v={viewSub.status} />
                  <span className="font-mono text-xs text-[var(--color-muted)]">
                    {viewSub.acceptedCount}/{viewSub.totalCount} đúng • {timeAgo(viewSub.createdAt)}
                  </span>
                </div>
              </div>
            </div>

            {viewSub.tests && viewSub.tests.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                  Kết quả từng Test case
                </div>
                <div className="scroll-thin max-h-[160px] overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)]">
                  {viewSub.tests.map((t, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-[var(--color-line)]/50 px-3 py-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold ${verdictClass(t.status)}`}>{verdictMark(t.status)}</span>
                        <span className="font-mono">{t.name}</span>
                      </div>
                      <div className="flex items-center gap-3 font-mono">
                        <span className="text-[var(--color-muted)]">{t.time_ms == null ? "—" : `${t.time_ms}ms`}</span>
                        <span className={verdictClass(t.status)}>{VERDICT_LABEL[t.status]}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {viewSub.compilerOutput && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ce)]">Nhật ký biên dịch</div>
                <pre className="scroll-thin max-h-24 overflow-auto rounded-lg bg-[var(--color-bg)] p-2.5 font-mono text-xs text-[var(--color-ce)]">{viewSub.compilerOutput}</pre>
              </div>
            )}

            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">Mã nguồn C++</div>
              <pre className="scroll-thin max-h-[220px] overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-3 font-mono text-xs whitespace-pre-wrap">{viewSub.source}</pre>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={copyCode} className="rounded-lg bg-[var(--color-bg3)] px-4 py-2 text-xs font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]">
                {copied ? "✓ Đã sao chép" : "📋 Sao chép code"}
              </button>
              <button onClick={resubmit} className="rounded-lg bg-[var(--color-copper)] px-4 py-2 text-xs font-semibold text-[#1a1208] transition hover:bg-[var(--color-copper2)]">
                👁 Xem ở Editor
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Test Inspect ───────────────────────────────────────────────────────────

function TestInspect({ test }: { test: TestResult | null }) {
  if (!test) {
    return (
      <div className="py-6 text-center text-xs text-[var(--color-muted)]">
        Chọn một test case bên danh sách để xem chi tiết kết quả.
      </div>
    );
  }
  return (
    <div className="rise text-xs">
      <div className="mb-3 flex items-center justify-between border-b border-[var(--color-line)]/60 pb-2">
        <span className="font-mono text-sm font-bold text-[var(--color-ink)]">{test.name}</span>
        <VerdictBadge v={test.status} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-xs text-[var(--color-muted)]">
        <dt>Thời gian thực thi:</dt>
        <dd className="font-bold text-[var(--color-ink)]">
          {test.time_ms == null ? "—" : `${test.time_ms} ms`}
        </dd>
      </dl>
      {test.input != null && <Block title="Dữ liệu vào" text={test.input} />}
      {test.stderr && <Block title="Thông báo lỗi" text={test.stderr} isError />}
      {test.expected != null && <Block title="Kết quả mong đợi" text={test.expected} />}
      {test.actual != null && <Block title="Kết quả thực tế" text={test.actual} />}
      {test.truncated && (
        <p className="mt-2 font-mono text-[10px] text-[var(--color-muted)]">
          * Dữ liệu đã được cắt ngắn để hiển thị nhanh hơn.
        </p>
      )}
    </div>
  );
}

function Block({ title, text, isError }: { title: string; text: string; isError?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div
          className={`text-[10px] font-semibold uppercase tracking-wider ${
            isError ? "text-[var(--color-bad)]" : "text-[var(--color-muted)]"
          }`}
        >
          {title}
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg2)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-muted)] transition hover:border-[var(--color-copper)]/40 hover:text-[var(--color-ink)]"
        >
          {copied ? "Đã sao chép" : "Sao chép"}
        </button>
      </div>
      <pre className="scroll-thin max-h-28 overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-2.5 font-mono text-xs text-[var(--color-ink)] whitespace-pre-wrap">{text || "∅"}</pre>
    </div>
  );
}

// ─── Detail Modal ───────────────────────────────────────────────────────────

function DetailModal(props: {
  problem: Problem;
  onClose: () => void;
  onChange: () => Promise<void>;
  onDeleted: () => Promise<void>;
  busy: string;
  setBusy: (s: string) => void;
}) {
  const { problem, onClose, onChange, onDeleted, busy, setBusy } = props;
  const [name, setName] = useState(problem.name);
  const [timeLimit, setTimeLimit] = useState(problem.timeLimitMs);
  const [error, setError] = useState("");
  const [askDelete, setAskDelete] = useState(false);

  async function save() {
    setBusy("Đang lưu…");
    try {
      await api.updateProblem(problem.id, { name, timeLimitMs: timeLimit });
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    setBusy("Đang xóa…");
    try {
      await api.deleteProblem(problem.id);
      setAskDelete(false);
      await onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAskDelete(false);
      setBusy("");
    }
  }

  async function reimport(files: { relativePath: string; file: File }[]) {
    setBusy("Đang nạp lại…");
    setError("");
    try {
      const form = new FormData();
      for (const f of files) {
        form.append("files", f.file, f.file.name);
        form.append("relativePaths", f.relativePath);
      }
      const preview = await api.importPackage(form);
      const res = await fetch(`/api/problems/${problem.id}/reimport`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId: preview.importId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Reimport thất bại");
      }
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <>
    <Modal onClose={onClose} title={problem.name}>
      <div className="space-y-4">
        <label className="block">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Tên bài
          </div>
          <input
            className="mt-1.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] px-3.5 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-copper)]"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Giới hạn thời gian (ms)
          </div>
          <input
            type="number"
            className="mt-1.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] px-3.5 py-2 font-mono text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-copper)]"
            value={timeLimit}
            onChange={(e) => setTimeLimit(Number(e.target.value))}
          />
        </label>
        <div className="rounded-lg bg-[var(--color-bg)] p-3 font-mono text-xs text-[var(--color-muted)]">
          {problem.testCount} tests • {problem.inputFile} / {problem.outputFile} • {problem.ioMode} I/O
        </div>
        <div className="scroll-thin max-h-28 overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-2 text-xs">
          {(problem.tests || []).map((t) => (
            <div
              key={t.id}
              className="border-b border-[var(--color-line)]/40 py-1 font-mono text-[var(--color-muted)]"
            >
              {t.name}
            </div>
          ))}
        </div>
        <div
          className="rounded-xl border-2 border-dashed border-[var(--color-line)] px-4 py-4 text-center text-xs text-[var(--color-muted)]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void collectDroppedFiles(e.dataTransfer).then(reimport);
          }}
        >
          Thả file ZIP hoặc thư mục mới để nạp lại test case
        </div>
        {error && <p className="text-xs text-[var(--color-bad)]">{error}</p>}
        <div className="flex items-center justify-between pt-2">
          <button
            className="rounded-lg border border-[var(--color-bad)]/35 bg-[var(--color-bad)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-bad)] transition hover:bg-[var(--color-bad)]/20"
            onClick={() => setAskDelete(true)}
            disabled={Boolean(busy)}
          >
            Xóa bài tập này
          </button>
          <button
            className="rounded-lg bg-[var(--color-copper)] px-5 py-2 text-xs font-semibold text-[#1a1208] transition hover:bg-[var(--color-copper2)]"
            onClick={() => void save()}
            disabled={Boolean(busy)}
          >
            {busy || "Lưu thay đổi"}
          </button>
        </div>
      </div>
    </Modal>
    {askDelete && (
      <ConfirmDialog
        title="Xóa bài tập?"
        confirmLabel="Xóa"
        busy={busy === "Đang xóa…"}
        onCancel={() => setAskDelete(false)}
        onConfirm={() => void remove()}
      >
        <p className="text-sm leading-6 text-[var(--color-muted)]">
          Bạn sắp xóa bài{" "}
          <span className="font-semibold text-[var(--color-ink)]">{problem.name}</span>.
          Toàn bộ test và lịch sử nộp sẽ bị xóa vĩnh viễn.
        </p>
      </ConfirmDialog>
    )}
    </>
  );
}

// ─── Settings Modal ─────────────────────────────────────────────────────────

function SettingsModal({ health, onClose }: { health: Health; onClose: () => void }) {
  return (
    <Modal onClose={onClose} title="Môi trường hệ thống">
      <dl className="space-y-4 text-sm">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Trình biên dịch C++
          </dt>
          <dd className="mt-1 font-semibold text-[var(--color-ink)]">
            {health.compiler ? health.compiler.version : "Không tìm thấy g++ / clang"}
          </dd>
          {health.compiler && (
            <dd className="mt-1 break-all font-mono text-xs text-[var(--color-muted)]">
              {health.compiler.path}
            </dd>
          )}
        </div>
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Thư mục dữ liệu
          </dt>
          <dd className="mt-1 break-all font-mono text-xs text-[var(--color-ink)]">
            {health.dataDir}
          </dd>
        </div>
      </dl>
    </Modal>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────────────

function IconSubmit({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 16V5" />
      <path d="M8 8.5 12 4.5 16 8.5" />
      <path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" />
    </svg>
  );
}

function IconList({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

function IconHistory({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

// ─── Modal Shell ────────────────────────────────────────────────────────────

function ConfirmDialog(props: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const {
    title,
    children,
    confirmLabel = "Xác nhận",
    cancelLabel = "Hủy",
    busy = false,
    onConfirm,
    onCancel,
  } = props;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--shadow-modal)" }}
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div
        className="rise w-full max-w-md overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-bg2)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className="border-b border-[var(--color-line)] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-bad)]/15 text-[var(--color-bad)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
            </div>
            <div className="min-w-0 pt-0.5">
              <h2 id="confirm-title" className="font-display text-lg font-bold text-[var(--color-ink)]">
                {title}
              </h2>
              <div className="mt-2">{children}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 bg-[var(--color-bg)]/50 px-5 py-3.5">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg2)] px-4 py-2 text-xs font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-bg3)] disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-lg bg-[var(--color-bad)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Đang xóa…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-xs"
      style={{ backgroundColor: "var(--shadow-modal)" }}
      onClick={onClose}
    >
      <div
        className="rise w-full max-w-lg rounded-2xl border border-[var(--color-line)] bg-[var(--color-bg2)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-[var(--color-ink)]">{title}</h2>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sm text-[var(--color-muted)] transition hover:bg-[var(--color-bg3)] hover:text-[var(--color-ink)]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
