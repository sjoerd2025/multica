import { text } from "node:stream/consumers";
import { jevApproves, neverAutoApprove } from "./jev.js";

type CursorBeforeShellExecution = { command: string; cwd: string; sandbox: boolean };

function isCursorInput(value: unknown): value is CursorBeforeShellExecution {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { command?: unknown }).command === "string" &&
    typeof (value as { cwd?: unknown }).cwd === "string"
  );
}

const input: unknown = await text(process.stdin)
  .then((raw) => JSON.parse(raw) as unknown)
  .catch(() => undefined);

const approved =
  !isCursorInput(input) || neverAutoApprove(input.command)
    ? false
    : await jevApproves({ commands: [input.command], project: input.cwd });

console.log(JSON.stringify({ permission: approved === true ? "allow" : "ask" }));
