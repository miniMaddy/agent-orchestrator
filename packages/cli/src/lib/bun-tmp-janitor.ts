import { readdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Bun-bundled binaries (opencode, etc.) extract embedded shared libraries to
// the OS temp dir on startup and never unlink them on exit — this is a known
// upstream Bun bug that leaks ~4.3 MB per process invocation. Files look like
// `.{16hex}-{8hex}.{so|dylib}` (e.g. `.fcb8efb7fbaad77d-00000000.so`).
//
// Deleting these files is safe even while a live process has them mmap'd: on
// POSIX systems, `unlink` removes the directory entry but the kernel keeps the
// inode alive until the last mapping is torn down, at which point the space is
// reclaimed. For already-exited processes the unlink frees disk immediately.
// Windows does not allow unlinking mapped files, and opencode does not ship a
// Windows binary, so the janitor is a no-op there.
//
// This janitor runs inside `ao start` for the lifetime of the lifecycle worker
// and sweeps matching files older than `ageMs` at every interval.

const BUN_TMP_LIB_PATTERN = /^\.[0-9a-f]{8,}-[0-9a-f]{6,}\.(so|dylib)$/i;
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_AGE_MS = 60_000;
const TMP_DIR = tmpdir();

export interface BunTmpJanitorOptions {
  intervalMs?: number;
  ageMs?: number;
  onSweep?: (result: { removed: number; freedBytes: number; errors: number }) => void;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

async function sweepOnce(ageMs: number): Promise<{ removed: number; freedBytes: number; errors: number }> {
  let removed = 0;
  let freedBytes = 0;
  let errors = 0;

  let entries: string[];
  try {
    entries = await readdir(TMP_DIR);
  } catch {
    return { removed, freedBytes, errors: 1 };
  }

  const cutoff = Date.now() - ageMs;

  await Promise.all(
    entries.map(async (name) => {
      if (!BUN_TMP_LIB_PATTERN.test(name)) return;
      const path = join(TMP_DIR, name);
      try {
        const st = await stat(path);
        if (!st.isFile()) return;
        if (st.mtimeMs > cutoff) return;
        await unlink(path);
        removed += 1;
        freedBytes += st.size;
      } catch {
        // File may have been deleted by another sweeper, or stat raced
        // with an unlink, or we lack permission. Best-effort — don't throw.
        errors += 1;
      }
    }),
  );

  return { removed, freedBytes, errors };
}

export function startBunTmpJanitor(options: BunTmpJanitorOptions = {}): boolean {
  // Windows: opencode ships no win32 binary and unlinking mapped files is
  // disallowed by the kernel, so the janitor would be both unnecessary and
  // potentially error-prone. Skip.
  if (process.platform === "win32") return false;
  if (timer) return false;

  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const ageMs = options.ageMs ?? DEFAULT_AGE_MS;
  const { onSweep } = options;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await sweepOnce(ageMs);
      if (onSweep && (result.removed > 0 || result.errors > 0)) {
        onSweep(result);
      }
    } finally {
      running = false;
    }
  };

  // Run an immediate sweep to clear any backlog, then on an interval.
  void tick();
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return true;
}

export function stopBunTmpJanitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function isBunTmpJanitorRunning(): boolean {
  return timer !== null;
}
