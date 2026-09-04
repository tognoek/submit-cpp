import { createWriteStream } from "node:fs";
import { mkdir, rm, rename, access, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const compilerDir = join(root, "compiler");
const cacheDir = join(root, ".cache");

const W64_URL =
  "https://github.com/skeeto/w64devkit/releases/download/v2.9.1/w64devkit-x64-2.9.1.7z.exe";
const W64_NAME = "w64devkit-x64-2.9.1.7z.exe";

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function findGxx(dir, depth = 0) {
  if (depth > 4) return null;
  const direct = join(dir, process.platform === "win32" ? "g++.exe" : "g++");
  if (await exists(direct)) return direct;
  const bin = join(dir, "bin", process.platform === "win32" ? "g++.exe" : "g++");
  if (await exists(bin)) return bin;
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const found = await findGxx(join(dir, e.name), depth + 1);
    if (found) return found;
  }
  return null;
}

async function download(url, dest) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const total = Number(res.headers.get("content-length") || 0);
  let received = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    received += chunk.length;
    if (!total) return;
    const pct = Math.floor((received / total) * 100);
    if (pct >= last + 5) {
      last = pct;
      console.log(`  ${pct}% (${(received / 1048576).toFixed(1)} MB)`);
    }
  });
  await pipeline(body, createWriteStream(dest));
  console.log("Download complete.");
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

async function extractSfx(sfx, outDir) {
  await mkdir(outDir, { recursive: true });
  console.log("Extracting compiler...");
  try {
    await run(sfx, ["-y", `-o${outDir}`], outDir);
  } catch {
    await run(sfx, ["-y"], outDir);
  }
}

async function main() {
  const existing = await findGxx(compilerDir);
  if (existing) {
    console.log(`Compiler already present:\n  ${existing}`);
    return;
  }

  await mkdir(cacheDir, { recursive: true });
  const sfx = join(cacheDir, W64_NAME);
  if (!(await exists(sfx))) {
    await download(W64_URL, sfx);
  } else {
    console.log("Using cached compiler archive.");
  }

  const staging = join(cacheDir, "compiler-staging");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await extractSfx(sfx, staging);

  const gxx = await findGxx(staging);
  if (!gxx) {
    throw new Error("Extracted archive but could not find g++.exe");
  }

  await rm(compilerDir, { recursive: true, force: true });
  await mkdir(dirname(compilerDir), { recursive: true });

  const extractedRoot = join(staging, "w64devkit");
  if (await exists(extractedRoot)) {
    await rename(extractedRoot, compilerDir);
  } else {
    await rename(staging, compilerDir);
  }

  const finalGxx = await findGxx(compilerDir);
  if (!finalGxx) {
    throw new Error("Compiler layout unexpected after move");
  }
  console.log(`Compiler ready:\n  ${finalGxx}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
