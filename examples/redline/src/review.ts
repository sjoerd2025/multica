import { spawn } from "child_process";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export async function review(model?: string): Promise<void> {
  const outputFile = join(tmpdir(), `redline-review-${Date.now()}.txt`);

  const args = [
    "exec",
    "review",
    "-c",
    'model_provider="openrouter"',
    "--uncommitted",
    "-o",
    outputFile,
  ];

  if (model) {
    args.push("-c", `model="${model}"`);
  }

  // Stream output in real-time so background task shows progress
  const exitCode = await new Promise<number>((resolve) => {
    const proc = spawn("codex", args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    proc.on("close", (code) => resolve(code ?? 1));
  });

  // Read the final review from the -o output file
  let review = "";
  try {
    review = readFileSync(outputFile, "utf-8").trim();
    unlinkSync(outputFile);
  } catch {
    // No output file — output was already streamed
  }

  if (exitCode !== 0 && !review) {
    console.error(`Codex review failed (exit ${exitCode}).`);
    process.exit(1);
  }

  if (review) {
    console.log("\n--- Review Summary ---\n");
    console.log(review);
  }
}
