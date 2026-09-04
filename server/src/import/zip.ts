import { mkdir, writeFile } from "node:fs/promises";
import { dirname, posix } from "node:path";
import extractZip from "extract-zip";
import { safeResolve } from "../paths.js";

function isUnsafeEntry(name: string): boolean {
  const n = name.replace(/\\/g, "/");
  if (n.includes("..")) return true;
  if (n.startsWith("/") || /^[a-zA-Z]:/.test(n)) return true;
  return false;
}

export async function extractZipSafe(zipPath: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  await extractZip(zipPath, {
    dir: dest,
    onEntry: (entry: { fileName: string }) => {
      const name = String(entry.fileName || "");
      if (isUnsafeEntry(name)) {
        throw new Error(`Unsafe path in ZIP: ${name}`);
      }
    },
  });
}

export async function saveUploadedFile(destDir: string, relativePath: string, buffer: Buffer): Promise<string> {
  const rel = posix.normalize(relativePath.replace(/\\/g, "/")).replace(/^(\.\.(\/|$))+/, "");
  if (rel.includes("..")) throw new Error("Unsafe relative path");
  const full = safeResolve(destDir, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, buffer);
  return full;
}

export function looksLikeZip(filename: string, mime?: string): boolean {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".zip")) return true;
  return mime === "application/zip" || mime === "application/x-zip-compressed";
}
