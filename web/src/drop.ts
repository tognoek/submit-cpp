async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) break;
    all.push(...batch);
  }
  return all;
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
): Promise<{ relativePath: string; file: File }[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
    return [{ relativePath: prefix + entry.name, file }];
  }
  if (!entry.isDirectory) return [];
  const dirEntry = entry as FileSystemDirectoryEntry;
  const children = await readAllEntries(dirEntry.createReader());
  const nested: { relativePath: string; file: File }[] = [];
  for (const child of children) {
    nested.push(...(await walkEntry(child, `${prefix}${entry.name}/`)));
  }
  return nested;
}

export async function collectDroppedFiles(dt: DataTransfer): Promise<{ relativePath: string; file: File }[]> {
  const items = [...dt.items];
  const out: { relativePath: string; file: File }[] = [];
  let usedEntries = false;
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.() ?? null;
    if (entry) {
      usedEntries = true;
      out.push(...(await walkEntry(entry, "")));
    }
  }
  if (usedEntries && out.length) return out;
  return [...dt.files].map((file) => ({
    relativePath: file.webkitRelativePath || file.name,
    file,
  }));
}

export function isCppFile(name: string): boolean {
  return /\.(cpp|cc|cxx|c\+\+|h|hpp)$/i.test(name);
}

export function isZipFile(name: string): boolean {
  return /\.zip$/i.test(name);
}
