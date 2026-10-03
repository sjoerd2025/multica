import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export function getDiffStat(): string {
  // Prefer diff --stat for a concise summary
  const diff = execSync("git diff --stat HEAD", { encoding: "utf-8" }).trim();
  if (diff) return diff;

  // Fall back to status for untracked files
  return execSync("git status --porcelain", { encoding: "utf-8" }).trim();
}

export function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

export function check(model?: string): void {
  const diffStat = getDiffStat();
  if (!diffStat) {
    process.exit(0);
  }

  // Deduplicate: skip if diff unchanged since last check
  const gitDir = execSync("git rev-parse --git-dir", { encoding: "utf-8" }).trim();
  const hashFile = join(gitDir, "redline-last-diff");
  const currentHash = hash(diffStat);

  if (existsSync(hashFile)) {
    const lastHash = readFileSync(hashFile, "utf-8").trim();
    if (lastHash === currentHash) {
      process.exit(0);
    }
  }

  writeFileSync(hashFile, currentHash);

  const cmd = model ? `redline review --model ${model}` : "redline review";

  const hookOutput = {
    decision: "block",
    reason: [
      "Redline: Here is a summary of uncommitted",
      "changes since the last review:",
      "",
      diffStat,
      "",
      "If these changes are substantial enough to",
      "warrant a code review (e.g., new logic, bug",
      "fixes, refactors — not just formatting or",
      "comments), run the following command as a",
      "background task:",
      "",
      `  ${cmd}`,
      "",
      "If the changes are trivial, or a review is",
      "already running, skip it. When a review",
      "completes, assess the findings and inform",
      "the user of any issues.",
    ].join("\n"),
  };

  console.log(JSON.stringify(hookOutput));
}
