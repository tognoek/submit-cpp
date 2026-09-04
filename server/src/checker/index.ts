import { exactCheck, type CheckResult } from "./exact.js";
import { tokenCheck } from "./token.js";
import type { CheckerType } from "../types.js";

export function checkOutput(
  actual: string,
  expected: string,
  type: CheckerType,
  ignoreCase = false,
): CheckResult {
  if (type === "exact") return exactCheck(actual, expected);
  return tokenCheck(actual, expected, ignoreCase);
}

export { exactCheck, tokenCheck };
