import { text } from "node:stream/consumers";
import { jevApproves, neverAutoApprove } from "./jev.js";

type PermissionRequest = {
  cwd: string;
  tool_name: string;
  tool_input: { command?: unknown; description?: unknown };
  turn_id?: unknown;
};

const input = JSON.parse(await text(process.stdin)) as PermissionRequest;
const command = input.tool_input.command;
const description = input.tool_input.description;

if (
  input.tool_name === "Bash" &&
  typeof command === "string" &&
  !neverAutoApprove(command)
) {
  const approved = await jevApproves({
    commands: [command],
    project: input.cwd,
    task:
      typeof description === "string" && input.turn_id === undefined
        ? description
        : undefined,
  });
  if (approved === true) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: { behavior: "allow" },
        },
      }),
    );
  }
}
