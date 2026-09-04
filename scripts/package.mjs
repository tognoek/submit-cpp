import { createWriteStream } from "node:fs";
import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const portable = join(root, "portable");
const cacheDir = join(root, ".cache");
const NODE_VERSION = "22.18.0";
const NODE_ZIP = `node-v${NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}`;

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: true, windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

async function download(url, dest) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function extractZip(zipPath, dest) {
  const extract = require("extract-zip");
  await extract(zipPath, { dir: dest });
}

async function main() {
  if (!(await exists(join(root, "dist", "server", "index.js")))) {
    throw new Error("Build first: npm run build");
  }
  if (!(await exists(join(root, "compiler")))) {
    console.log("Compiler missing — running setup...");
    await run(process.execPath, [join(root, "scripts", "download-compiler.mjs")]);
  }

  await mkdir(cacheDir, { recursive: true });
  const nodeZip = join(cacheDir, NODE_ZIP);
  if (!(await exists(nodeZip))) await download(NODE_URL, nodeZip);

  const nodeStage = join(cacheDir, "node-extract");
  await rm(nodeStage, { recursive: true, force: true });
  await extractZip(nodeZip, nodeStage);

  await rm(portable, { recursive: true, force: true });
  await mkdir(join(portable, "runtime", "node"), { recursive: true });
  await mkdir(join(portable, "data"), { recursive: true });
  await mkdir(join(portable, "logs"), { recursive: true });

  const nodeFolder = join(nodeStage, `node-v${NODE_VERSION}-win-x64`);
  await cp(join(nodeFolder, "node.exe"), join(portable, "runtime", "node", "node.exe"));

  await cp(join(root, "dist", "server"), join(portable, "server"), { recursive: true });
  await cp(join(root, "dist", "web"), join(portable, "web"), { recursive: true });
  await cp(join(root, "compiler"), join(portable, "compiler"), { recursive: true });

  const pkg = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, "package.json"), "utf8"));
  await writeFile(
    join(portable, "package.json"),
    JSON.stringify({ name: pkg.name, version: pkg.version, type: "module", dependencies: pkg.dependencies }, null, 2),
  );
  console.log("Installing production dependencies into portable/");
  await run("npm", ["install", "--omit=dev"], portable);

  const csc = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
  const exe = join(portable, "Judge.exe");
  if (await exists(csc)) {
    await run(csc, ["/nologo", "/optimize+", `/out:${exe}`, "/target:exe", join(root, "scripts", "launcher.cs")]);
  } else {
    console.warn("csc.exe not found — writing Judge.cmd fallback");
    await writeFile(
      join(portable, "Judge.cmd"),
      `@echo off\r\nset JUDGE_ROOT=%~dp0\r\nset JUDGE_OPEN_BROWSER=1\r\nset NODE_ENV=production\r\n"%~dp0runtime\\node\\node.exe" "%~dp0server\\index.js"\r\n`,
    );
  }

  await writeFile(
    join(portable, "README.txt"),
    `Chấm C++\r\n\r\nDouble-click Judge.exe.\r\nThe local server starts and your browser opens at http://127.0.0.1:27181\r\n\r\nNo Node.js, GCC, or SQLite install is required.\r\n`,
  );

  console.log(`\nPortable app ready:\n  ${portable}\nRun Judge.exe`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
