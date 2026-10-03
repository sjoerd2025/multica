import {
  buildReviewRequest,
  createAdvisorTool,
  formatTaskPacket,
  shouldEnableAdvisor,
  type ReviewTask,
} from "./index.js";

const ROUTINE: ReviewTask = {
  title: "Add a retry wrapper to the metrics client",
  userQuestion: "Is this plan ready to implement?",
  changedFiles: ["services/analytics/src/metrics-client.ts"],
  diffSummary: "Adds an exponential-backoff retry with jitter around the send() call.",
  uncertaintySignals: [],
};

const UNCERTAIN: ReviewTask = {
  title: "Move usage-event writes to a monthly partitioned table",
  userQuestion: "Should we ship this migration plan, or ask for another design pass?",
  changedFiles: [
    "packages/db/migrations/2026-06-10-usage-partitions.sql",
    "services/cfw-api/src/usage/write-usage-event.ts",
  ],
  diffSummary:
    "Adds monthly partitions for usage_events and routes new writes by workspace_id and created_at.",
  uncertaintySignals: ["schema-change", "missing-rollback", "billing-path"],
};

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

// 1. Budget gate: routine tasks never enable the advisor
check("routine task does not enable advisor", !shouldEnableAdvisor(ROUTINE));
check(
  "uncertain task enables advisor",
  shouldEnableAdvisor(UNCERTAIN) === true,
  `signals=${UNCERTAIN.uncertaintySignals.join(",")}`,
);
for (const s of ["billing-path", "large-diff", "missing-rollback", "missing-tests", "schema-change", "unknown-owner"]) {
  check(`gate recognizes ${s}`, shouldEnableAdvisor({ ...ROUTINE, uncertaintySignals: [s] }));
}
check(
  "unknown signal does not enable advisor",
  !shouldEnableAdvisor({ ...ROUTINE, uncertaintySignals: ["feels-risky"] }),
);

// 2. Request shape
const routineReq = buildReviewRequest({ task: ROUTINE });
const uncertainReq = buildReviewRequest({ task: UNCERTAIN });

check("routine request has no tools", !routineReq.requestBody.tools);
check("uncertain request has one advisor tool", uncertainReq.requestBody.tools?.length === 1);
const tool = uncertainReq.requestBody.tools?.[0] as { type: string; parameters: { name?: string } };
check("tool type is openrouter:advisor", tool?.type === "openrouter:advisor");
check("advisor named plan-reviewer", tool?.parameters?.name === "plan-reviewer");
check(
  "flat parameters, no nested advisors roster",
  !("advisors" in (tool?.parameters ?? {})),
);
check("forward_transcript is false", (uncertainReq.requestBody.tools?.[0] as any).parameters.forward_transcript === false);
check("advisor output tokens capped", (uncertainReq.requestBody.tools?.[0] as any).parameters.max_completion_tokens === 220);
check("executor model is the cheap model", routineReq.requestBody.model === "openai/gpt-4o-mini");

// 3. Compact packet — no full diffs or transcripts
const packet = formatTaskPacket(UNCERTAIN);
check("packet contains decision question", packet.includes(UNCERTAIN.userQuestion));
check("packet contains changed files", packet.includes("write-usage-event.ts"));
check("packet contains uncertainty signals", packet.includes("billing-path"));
check("packet contains diff summary (compact)", packet.includes("monthly partitions"));
check("packet is compact (<600 chars)", packet.length < 600, `${packet.length} chars`);

// 4. Telemetry / redaction boundary
const telemetry = uncertainReq.telemetryContext;
check("telemetry has executor_model", telemetry.executor_model === "openai/gpt-4o-mini");
check("telemetry has advisor_model", telemetry.advisor_model === "~anthropic/claude-opus-latest");
check("telemetry has did_enable_advisor", telemetry.did_enable_advisor === true);
const telemetryJson = JSON.stringify(telemetry);
check(
  "telemetry does not leak prompts/diffs/secrets",
  !/OPENROUTER_API_KEY|sk-or-|migration|write-usage-event|diffSummary|userQuestion/.test(telemetryJson),
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);