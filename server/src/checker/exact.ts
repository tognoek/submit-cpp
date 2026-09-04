export type CheckResult = {
  ok: boolean;
  presentationError: boolean;
};

export function stripBom(s: string): string {
  if (!s) return s;
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  // UTF-8 BOM decoded as characters
  if (s.startsWith("\uFEFF")) return s.slice(1);
  return s;
}

function normalizeNewlines(s: string): string {
  return stripBom(s).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function exactCheck(actual: string, expected: string): CheckResult {
  const a = normalizeNewlines(actual);
  const e = normalizeNewlines(expected);
  if (a === e) return { ok: true, presentationError: false };
  // Same content ignoring leading/trailing whitespace ⇒ presentation error
  if (a.trim() === e.trim()) return { ok: false, presentationError: true };
  return { ok: false, presentationError: false };
}
