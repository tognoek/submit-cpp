import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Gói PNG thành ICO (Windows Vista+) — không cần dependency. */
async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pngPath = process.argv[2] || join(root, "assets", "logo.png");
  const icoPath = process.argv[3] || join(root, "assets", "logo.ico");
  const png = await readFile(pngPath);

  // ICONDIR + 1 ICONDIRENTRY + PNG payload
  const headerSize = 6;
  const entrySize = 16;
  const offset = headerSize + entrySize;
  const buf = Buffer.alloc(offset + png.length);
  buf.writeUInt16LE(0, 0); // reserved
  buf.writeUInt16LE(1, 2); // type icon
  buf.writeUInt16LE(1, 4); // count
  buf.writeUInt8(0, 6); // width 0 = 256
  buf.writeUInt8(0, 7); // height 0 = 256
  buf.writeUInt8(0, 8); // colors
  buf.writeUInt8(0, 9); // reserved
  buf.writeUInt16LE(1, 10); // planes
  buf.writeUInt16LE(32, 12); // bitcount
  buf.writeUInt32LE(png.length, 14);
  buf.writeUInt32LE(offset, 18);
  png.copy(buf, offset);

  await writeFile(icoPath, buf);
  console.log(`Wrote ${icoPath} (${buf.length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
