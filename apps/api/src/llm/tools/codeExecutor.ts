import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdtemp, rmdir, realpath } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

export interface CodeExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/** Pulls the first fenced code block out of an LLM response and detects its declared
 *  language (```python vs ```javascript), defaulting to javascript when unlabeled. */
export function extractCodeBlock(content: string): { code: string; language: "javascript" | "python" } | null {
  const match = content.match(/```(javascript|python)?\n([\s\S]+?)```/);
  if (!match) return null;
  return { code: match[2], language: match[1] === "python" ? "python" : "javascript" };
}

// PROD: this is process-level hardening, not full isolation — no container/VM boundary
// (gVisor/Firecracker/E2B). It blocks the concrete gaps that existed before (secret-leak via
// process.env, filesystem writes/reads outside the run dir, spawning further processes for JS),
// but shares the host kernel and does not bound CPU/memory or guarantee network isolation.
export async function executeCode(code: string, language: "javascript" | "python" = "javascript"): Promise<CodeExecResult> {
  const rawRunDir = await mkdtemp(join(tmpdir(), "quorum-exec-"));
  const runDir = await realpath(rawRunDir); // resolve symlinks (e.g. macOS /var -> /private/var)
  const ext = language === "python" ? ".py" : ".mjs";
  const tmpFile = join(runDir, `${randomUUID()}${ext}`);

  // Minimal env: no DATABASE_URL, API keys, or other secrets inherited from the parent process.
  const minimalEnv = { PATH: process.env.PATH ?? "" };

  try {
    await writeFile(tmpFile, code, "utf-8");

    const [cmd, args] =
      language === "python"
        ? ["python3", ["-I", tmpFile]] // isolated mode: ignores PYTHONPATH/user site-packages
        : ["node", [`--permission`, `--allow-fs-read=${runDir}`, tmpFile]]; // no fs-write, no child_process, no worker threads

    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      env: minimalEnv,
    });

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0, timedOut: false };
  } catch (err: unknown) {
    if (err && typeof err === "object" && "killed" in err && (err as Record<string, unknown>)["killed"] === true) {
      return { stdout: "", stderr: "Execution timed out", exitCode: 1, timedOut: true };
    }
    const execErr = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execErr.stdout?.trim() ?? "",
      stderr: execErr.stderr?.trim() ?? "Unknown error",
      exitCode: execErr.code ?? 1,
      timedOut: false,
    };
  } finally {
    await unlink(tmpFile).catch(() => {});
    await rmdir(runDir).catch(() => {});
  }
}
