// Lists a zip (a SharePoint or OneDrive "Download" of a folder) as files to upload without unpacking it.
// Only the zip's central directory is read up front; zip.js reads the File in slices, so even a
// multi-gigabyte zip never has to fit in memory. Each file is decompressed when the uploader asks for it,
// one entry at a time. Adapted from the HFG Renewables data room (src/lib/zipUpload.ts there).

import type { PickedFile } from "./dropFiles";

/** Runs one task at a time, in call order, so only one zip entry is ever being decompressed. */
function serialLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

export class ZipReadError extends Error {
  constructor(fileName: string) {
    super(`Couldn't open ${fileName}. The zip may be incomplete or damaged: try downloading it again, or upload its files on their own.`);
    this.name = "ZipReadError";
  }
}

/** The files in a zip (folders and directory entries left out), each read on demand. */
export async function readZipFiles(zip: File): Promise<PickedFile[]> {
  // Loaded on demand: only the portal ever opens a zip.
  const { ZipReader, BlobReader, BlobWriter } = await import("@zip.js/zip.js");
  // No web workers: avoids bundling a worker script; decompression still uses the browser's native streams.
  // UTF-8 names: SharePoint and macOS zips use UTF-8 even when they don't set the zip's UTF-8 flag.
  // Tolerant names: one odd entry ("../x.pdf", an absolute path) must not make the whole zip unreadable. Names are
  // only shown and matched here; the server strips any path tricks before it files anything.
  const reader = new ZipReader(new BlobReader(zip), { filenameEncoding: "utf-8", useWebWorkers: false, filenameValidation: "tolerant" });
  let entries;
  try {
    entries = await reader.getEntries();
  } catch {
    throw new ZipReadError(zip.name);
  }
  const lock = serialLock();
  const files: PickedFile[] = [];
  for (const entry of entries) {
    if (entry.directory) continue;
    files.push({
      path: entry.filename,
      size: entry.uncompressedSize,
      load: () =>
        lock(async () => {
          if (entry.encrypted) throw new Error("This file is password-protected inside the zip. Upload it on its own instead.");
          // Deflate64 (method 9, written by Windows for very large files) needs a WebAssembly module the portal
          // doesn't load (its security policy allows no WebAssembly): say so plainly.
          if ((entry as { compressionMethod?: number }).compressionMethod === 9) {
            throw new Error("This file was zipped with a method the browser can't unpack (Deflate64). Upload it on its own instead.");
          }
          try {
            return await entry.getData(new BlobWriter());
          } catch {
            throw new Error("This file couldn't be unpacked from the zip. Upload it on its own instead.");
          }
        }),
    });
  }
  return files;
}
