// Files from a drag-and-drop or a file picker, including everything inside dropped folders, as
// lightweight records the outgoing manager's portal can review before anything is read. Adapted from the
// HFG Renewables data room (src/lib/dropFiles.ts there).

/** A file waiting to be uploaded: its path inside the dropped folder or zip, its size, and how to read it. */
export interface PickedFile {
  /** "SP87192 Handover/02 Insurance/CoC 2026.pdf", or just the file name. */
  path: string;
  size: number;
  /** Reads the bytes when the uploader gets to it (a zip entry is decompressed only then). */
  load: () => Promise<Blob>;
}

export interface DroppedFiles {
  files: PickedFile[];
  /** Zips dropped or picked as they are, to be listed with readZipFiles (zips inside folders stay files). */
  zips: File[];
}

// Minimal typings for the File and Directory Entries API used by drag-and-drop.
interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
}
interface FsFileEntry extends FsEntry {
  file: (ok: (file: File) => void, fail: (err: unknown) => void) => void;
}
interface FsDirectoryEntry extends FsEntry {
  createReader: () => { readEntries: (ok: (entries: FsEntry[]) => void, fail: (err: unknown) => void) => void };
}

const stripLeadingSlash = (path: string) => path.replace(/^\/+/, "");

export const isZipFile = (file: Pick<File, "name" | "type">) =>
  /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";

/** A picked or dropped file as a PickedFile, keeping its folder path when the browser gives one. */
export function pickedFile(file: File, path = file.webkitRelativePath || file.name): PickedFile {
  return { path, size: file.size, load: async () => file };
}

async function readAll(dir: FsDirectoryEntry): Promise<FsEntry[]> {
  const reader = dir.createReader();
  const all: FsEntry[] = [];
  // readEntries returns results in batches (100 in Chrome) until it returns none.
  for (;;) {
    const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (!batch.length) return all;
    all.push(...batch);
  }
}

const fileOf = (entry: FsEntry) => new Promise<File>((ok, fail) => (entry as FsFileEntry).file(ok, fail));

async function walk(entry: FsEntry, out: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await fileOf(entry);
    out.push(pickedFile(file, stripLeadingSlash(entry.fullPath) || file.name));
  } else if (entry.isDirectory) {
    for (const child of await readAll(entry as FsDirectoryEntry)) await walk(child, out);
  }
}

/**
 * Everything in a drop: files, the contents of dropped folders (with their paths), and dropped zips.
 * Call it straight from the drop handler, before any await: the browser empties `dataTransfer` once the
 * event returns (this function reads it synchronously before its first await).
 */
export async function filesFromDrop(dataTransfer: DataTransfer): Promise<DroppedFiles> {
  const entries = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.() ?? null);
  const plainFiles = Array.from(dataTransfer.files ?? []);

  if (entries.length && entries.every(Boolean)) {
    const files: PickedFile[] = [];
    const zips: File[] = [];
    for (const entry of entries as FsEntry[]) {
      if (entry.isFile) {
        const file = await fileOf(entry);
        if (isZipFile(file)) zips.push(file);
        else files.push(pickedFile(file, stripLeadingSlash(entry.fullPath) || file.name));
      } else {
        await walk(entry, files);
      }
    }
    return { files, zips };
  }
  // Browsers without the entries API: plain files only.
  return filesFromList(plainFiles);
}

/** Files from <input type="file"> (with or without webkitdirectory): zips are kept apart to be opened. */
export function filesFromInput(list: FileList | null): DroppedFiles {
  return filesFromList(Array.from(list ?? []));
}

function filesFromList(list: File[]): DroppedFiles {
  const files: PickedFile[] = [];
  const zips: File[] = [];
  // A zip picked inside a folder (webkitdirectory) is a document like any other; only loose zips are opened.
  for (const file of list) {
    if (isZipFile(file) && !file.webkitRelativePath) zips.push(file);
    else files.push(pickedFile(file));
  }
  return { files, zips };
}

/** Did this drag carry files (not text or a link)? */
export function dragHasFiles(event: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}
