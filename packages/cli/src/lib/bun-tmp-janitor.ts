import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

// Bun-bundled binaries (opencode, etc.) extract embedded shared libraries such
// as libopentui.so to /tmp on startup and never unlink them on exit — this is a
// known upstream Bun bug that leaks ~4.3 MB per process invocation. Files look
// like `/tmp/.{16hex}-{8hex}.so` (e.g. `.fcb8efb7fbaad77d-00000000.so`).
//
// Deleting these files is safe even while a live process has them mmap'd: on
// Linux, `unlink` removes the directory entry but the kernel keeps the inode
// alive until the last mapping is torn down, at which point the space is
// reclaimed. For already-exited processes the unlink frees disk immediately.
//
// This janitor runs inside `ao start` for the lifetime of the lifecycle worker
// and sweeps matching files older than `ageMs` at every interval. It is a
// no-op on non-Linux platforms because the leak is Linux+Bun specific.

const BUN_TMP_SO_PATTERN = /^\.[0-9a-f]{8,}-[0-9a-f]{6,}\.so$/i;
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_AGE_MS = 60_000;
const TMP_DIR = "/tmp";

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
      if (!BUN_TMP_SO_PATTERN.test(name)) return;
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
  if (process.platform !== "linux") return false;
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
