import { createWriteStream } from "node:fs";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(root, "release");
const stageDir = join(root, ".cache", "package-stage");
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

async function zipStage(stage, zipPath) {
  if (await exists(zipPath)) await rm(zipPath, { force: true });
  const ps = [
    "Compress-Archive",
    "-Path",
    `"${stage}\\*"`,
    "-DestinationPath",
    `"${zipPath}"`,
    "-Force",
    "-CompressionLevel",
    "Optimal",
  ].join(" ");
  console.log("Compressing payload (có thể mất vài phút)...");
  await run("powershell", ["-NoProfile", "-Command", ps]);
}

async function main() {
  if (!(await exists(join(root, "dist", "server", "index.js")))) {
    throw new Error("Build first: npm run build");
  }
  if (!(await exists(join(root, "dist", "web", "index.html")))) {
    throw new Error("Build web first: npm run build:web");
  }
  if (!(await exists(join(root, "compiler")))) {
    console.log("Compiler missing — running setup...");
    await run(process.execPath, [join(root, "scripts", "download-compiler.mjs")]);
  }

  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const version = String(pkg.version || "1.0.0");
  const [maj, min, patch] = version.split(".").map((x) => Number(x) || 0);

  await mkdir(cacheDir, { recursive: true });
  const nodeZip = join(cacheDir, NODE_ZIP);
  if (!(await exists(nodeZip))) await download(NODE_URL, nodeZip);

  const nodeStage = join(cacheDir, "node-extract");
  await rm(nodeStage, { recursive: true, force: true });
  await extractZip(nodeZip, nodeStage);

  await rm(stageDir, { recursive: true, force: true });
  await mkdir(join(stageDir, "runtime", "node"), { recursive: true });

  const nodeFolder = join(nodeStage, `node-v${NODE_VERSION}-win-x64`);
  await cp(join(nodeFolder, "node.exe"), join(stageDir, "runtime", "node", "node.exe"));
  await cp(join(root, "dist", "server"), join(stageDir, "server"), { recursive: true });
  await cp(join(root, "dist", "web"), join(stageDir, "web"), { recursive: true });
  await cp(join(root, "compiler"), join(stageDir, "compiler"), { recursive: true });

  await writeFile(
    join(stageDir, "package.json"),
    JSON.stringify({ name: pkg.name, version, type: "module", dependencies: pkg.dependencies }, null, 2),
  );
  console.log("Installing production dependencies into staging...");
  await run("npm", ["install", "--omit=dev"], stageDir);

  const payloadZip = join(cacheDir, "chamcpp-payload.zip");
  await zipStage(stageDir, payloadZip);

  await mkdir(releaseDir, { recursive: true });
  const exe = join(releaseDir, "tognoek.exe");
  if (await exists(exe)) await rm(exe, { force: true });

  const csc = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
  if (!(await exists(csc))) {
    throw new Error("Không tìm thấy csc.exe (.NET Framework). Cần để build tognoek.exe.");
  }

  const infoPath = join(cacheDir, "AssemblyInfo.cs");
  await writeFile(
    infoPath,
    [
      "using System.Reflection;",
      '[assembly: AssemblyTitle("Chấm C++")]',
      '[assembly: AssemblyProduct("Chấm C++")]',
      '[assembly: AssemblyCompany("Chấm C++")]',
      `[assembly: AssemblyVersion("${maj}.${min}.${patch}.0")]`,
      `[assembly: AssemblyFileVersion("${maj}.${min}.${patch}.0")]`,
      "",
    ].join("\n"),
  );

  console.log("Building single-file tognoek.exe (WinExe, no console)...");

  const logoPng = join(root, "assets", "logo.png");
  const logoIco = join(root, "assets", "logo.ico");
  if (!(await exists(logoPng))) {
    throw new Error("Thiếu assets/logo.png");
  }
  await run(process.execPath, [join(root, "scripts", "png-to-ico.mjs"), logoPng, logoIco]);

  const cscArgs = [
    "/nologo",
    "/optimize+",
    "/target:winexe",
    `/out:${exe}`,
    `/win32icon:${logoIco}`,
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    "/r:System.IO.Compression.dll",
    "/r:System.IO.Compression.FileSystem.dll",
    `/resource:${payloadZip},Payload.zip`,
    `/resource:${logoPng},Logo.png`,
    infoPath,
    join(root, "scripts", "launcher.cs"),
  ];
  await run(csc, cscArgs);

  await writeFile(
    join(releaseDir, "README.txt"),
    [
      "Chấm C++",
      "",
      "Chỉ cần file tognoek.exe — double-click để mở trình duyệt.",
      "Không hiện cửa sổ console.",
      "",
      "Dữ liệu (DB, bài tập, lịch sử) lưu tại:",
      "  C:\\ChamCpp\\data\\",
      "Log:",
      "  C:\\ChamCpp\\logs\\",
      "",
      "Runtime giải nén lần đầu vào %LOCALAPPDATA%\\ChamCpp\\app\\",
      "Cập nhật EXE mới vẫn giữ nguyên bài & lịch sử trên ổ C.",
      "",
    ].join("\r\n"),
  );

  await rm(stageDir, { recursive: true, force: true });

  console.log(`\nXong — chỉ một file:\n  ${exe}\nDB dùng chung: C:\\ChamCpp\\data\\`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
