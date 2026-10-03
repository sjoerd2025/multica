const ADVISOR_WORTHY_SIGNALS = new Set([
  "billing-path",
  "large-diff",
  "missing-rollback",
  "missing-tests",
  "schema-change",
  "unknown-owner",
]);

export const EXECUTOR_MODEL = process.env.EXECUTOR_MODEL ?? "openai/gpt-4o-mini";
export const ADVISOR_MODEL =
  process.env.ADVISOR_MODEL ?? "~anthropic/claude-opus-latest";

export type ReviewTask = {
  title: string;
  userQuestion: string;
  changedFiles: string[];
  diffSummary: string;
  uncertaintySignals: string[];
};

export type AdvisorTool = {
  type: "openrouter:advisor";
  parameters: {
    name?: string;
    model?: string;
    instructions?: string;
    forward_transcript?: boolean;
    max_completion_tokens?: number;
    temperature?: number;
  };
};

export type ReviewRequestBody = {
  model: string;
  messages: { role: string; content: string }[];
  tools?: AdvisorTool[];
  tool_choice?: "auto" | "none" | "required";
  max_tokens: number;
  temperature: number;
};

export type ReviewRequest = {
  requestBody: ReviewRequestBody;
  telemetryContext: {
    executor_model: string;
    advisor_model: string | null;
    did_enable_advisor: boolean;
  };
};

export function shouldEnableAdvisor(task: ReviewTask): boolean {
  return task.uncertaintySignals.some((signal) => ADVISOR_WORTHY_SIGNALS.has(signal));
}

export function createAdvisorTool(
  advisorModel: string,
  parameters: Partial<AdvisorTool["parameters"]> = {},
): AdvisorTool {
  return {
    type: "openrouter:advisor",
    parameters: {
      name: "plan-reviewer",
      model: advisorModel,
      instructions:
        "You are a senior engineering reviewer. Review only the compact task packet. Identify hidden assumptions, missing rollback steps, missing tests, and cheaper alternatives. Be concise.",
      forward_transcript: false,
      max_completion_tokens: 220,
      temperature: 0,
      ...parameters,
    },
  };
}

export function formatTaskPacket(task: ReviewTask): string {
  return [
    `Title: ${task.title}`,
    `Question: ${task.userQuestion}`,
    `Changed files: ${task.changedFiles.join(", ")}`,
    `Uncertainty signals: ${task.uncertaintySignals.join(", ")}`,
    `Diff summary: ${task.diffSummary}`,
  ].join("\n");
}

export function buildReviewRequest({
  task,
  executorModel = EXECUTOR_MODEL,
  advisorModel = ADVISOR_MODEL,
}: {
  task: ReviewTask;
  executorModel?: string;
  advisorModel?: string;
}): ReviewRequest {
  const isAdvisorEnabled = shouldEnableAdvisor(task);

  return {
    requestBody: {
      model: executorModel,
      messages: [
        {
          role: "system",
          content:
            "You are a token-efficient implementation-plan reviewer. Use the cheap executor model for routine reasoning. If the plan-reviewer tool is available, call it at most once when a compact second-model check can change the answer. Send the advisor a compact prompt only. Do not paste full diffs, logs, secrets, or chat transcripts into the advisor prompt.",
        },
        {
          role: "user",
          content: formatTaskPacket(task),
        },
      ],
      ...(isAdvisorEnabled
        ? { tools: [createAdvisorTool(advisorModel)], tool_choice: "auto" }
        : {}),
      max_tokens: 500,
      temperature: 0.2,
    },
    telemetryContext: {
      executor_model: executorModel,
      advisor_model: isAdvisorEnabled ? advisorModel : null,
      did_enable_advisor: isAdvisorEnabled,
    },
  };
}

export type ReviewLogEntry = {
  route: string;
  executor_model: string;
  advisor_model: string | null;
  did_enable_advisor: boolean;
  finish_reason: string;
  usage_keys: string[];
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
};

export function logReviewTelemetry(
  ctx: ReviewRequest["telemetryContext"],
  finishReason: string,
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  },
): ReviewLogEntry {
  const entry: ReviewLogEntry = {
    route: "budgeted_plan_review",
    executor_model: ctx.executor_model,
    advisor_model: ctx.advisor_model,
    did_enable_advisor: ctx.did_enable_advisor,
    finish_reason: finishReason,
    usage_keys: ["prompt_tokens", "completion_tokens", "total_tokens", "cost"],
  };
  if (usage) {
    entry.prompt_tokens = usage.prompt_tokens;
    entry.completion_tokens = usage.completion_tokens;
    entry.total_tokens = usage.total_tokens;
    entry.cost = usage.cost;
  }
  console.log(JSON.stringify({ telemetry: entry }));
  return entry;
}

export async function runReview({
  task,
  executorModel = EXECUTOR_MODEL,
  advisorModel = ADVISOR_MODEL,
}: {
  task: ReviewTask;
  executorModel?: string;
  advisorModel?: string;
}): Promise<{ content: string; telemetry: ReviewLogEntry }> {
  const { requestBody, telemetryContext } = buildReviewRequest({
    task,
    executorModel,
    advisorModel,
  });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Chat Completions ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: {
      message?: { content?: unknown };
      finish_reason?: unknown;
    }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
  };

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Expected text content");
  }

  const telemetry = logReviewTelemetry(
    telemetryContext,
    typeof data.choices?.[0]?.finish_reason === "string"
      ? (data.choices[0].finish_reason as string)
      : "unknown",
    data.usage,
  );

  return { content, telemetry };
}