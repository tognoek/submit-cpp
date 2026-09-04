import { stripBom, type CheckResult } from "./exact.js";

export function tokenize(s: string): string[] {
  const trimmed = stripBom(s).trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/);
}

export function tokenCheck(actual: string, expected: string, ignoreCase = false): CheckResult {
  let a = tokenize(actual);
  let e = tokenize(expected);
  if (ignoreCase) {
    a = a.map((t) => t.toLowerCase());
    e = e.map((t) => t.toLowerCase());
  }
  if (a.length !== e.length) return { ok: false, presentationError: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== e[i]) return { ok: false, presentationError: false };
  }
  return { ok: true, presentationError: false };
}
