import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Writes a file so that a crash, a kill or a full disk never leaves it empty or half written:
 * the data goes to `<file>.tmp`, is flushed to disk, and only then renamed over the old file.
 * With `backup`, the previous version is kept as `<file>.bak` first.
 */
export function writeAtomic(file: string, data: string, opts: { mode?: number; backup?: boolean } = {}): void {
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, "w", opts.mode ?? 0o644);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (opts.backup && existsSync(file)) copyFileSync(file, `${file}.bak`);
  renameSync(tmp, file);
  // the rename itself is durable once the directory is flushed (not possible on Windows)
  try { const d = openSync(dirname(file), "r"); try { fsyncSync(d); } finally { closeSync(d); } } catch { /* best effort */ }
}
