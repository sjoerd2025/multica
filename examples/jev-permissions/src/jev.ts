export const RISKY = [
  /^(\S*['"\\=$]|[-0-9])/,
  /^(sudo|doas|su)\b/,
  /^(bash|sh|zsh|fish|eval|xargs)\b/,
  /^(node|bun|python3?)\s+(-\S+\s+)*(-c|-e|-p|--eval)\b/,
  /^rm\s+(-\S*[rRf]\S*\s+)+/,
  /^git\b.*\b(push|reset\s+--hard|clean\s+-\S*[fd]|branch\s+-D)\b/,
  /^(npm|pnpm|yarn|bun)\s+publish\b/,
  /^(wrangler|vercel|fly|flyctl)\s+deploy\b|^terraform\s+(apply|destroy)\b|^kubectl\s+(delete|apply)\b/,
  /\.env\b|\.ssh\b|\.aws\b|\.npmrc\b|\.netrc\b|credentials/i,
];

export function neverAutoApprove(command: string): boolean {
  if (/\$\(|[<>]\(|`|\\\r?\n/.test(command)) return true;
  return command
    .split(/\s*(?:&&|\|\||;|\||&|\n|[(){}])\s*/)
    .map(normalizeCommand)
    .some((part) => RISKY.some((pattern) => pattern.test(part)));
}

function normalizeCommand(part: string): string {
  let current = part;
  while (true) {
    const next = current
      .trim()
      .replace(/^(if|then|elif|else|fi|while|until|do|done|for|in|case|esac|!)\s+/, "")
      .replace(/^(command|builtin|exec|env|nohup|time|timeout|nice|watch|npx|bunx|pnpx)\s+/, "")
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=[^\s'"\\$]*\s+/, "")
      .replace(/^\\/, "")
      .replace(/^[^\s'"\\$]*\//, "");
    if (next === current) return current;
    current = next;
  }
}

export const JEV_MODEL = "typesafe/jev-1.13";
export const APPROVE_AT = 0.9;

export const QUESTIONS = {
  reversible: {
    type: "noul",
    instructions:
      "Every command in `commands` only reads or changes files inside `project` and can be undone with git or by rerunning it. It does not push, publish, deploy, delete files outside the project, change system settings, or send data to a network service.",
  },
  serves_task: {
    type: "noul",
    instructions: "Running `commands` is a reasonable next step toward `task`.",
  },
} as const;

export type State = {
  commands: readonly string[];
  project: string;
  task?: string;
  agent?: string;
};

export async function jevApproves(state: State): Promise<boolean | undefined> {
  const asked: ReadonlyArray<keyof typeof QUESTIONS> =
    state.task === undefined ? ["reversible"] : ["reversible", "serves_task"];
  const questions = Object.fromEntries(asked.map((key) => [key, QUESTIONS[key]]));
  const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined);
  if (res === undefined) return undefined;
  if (!res.ok) {
    await res.body?.cancel();
    return undefined;
  }
  const body = (await res.json().catch(() => undefined)) as
    | { answers?: Record<string, { type: "noul"; noul: unknown } | undefined> }
    | undefined;
  const scores = asked.map((key) => body?.answers?.[key]?.noul);
  if (!scores.every(isProbability)) return undefined;
  return scores.every((score) => score >= APPROVE_AT);
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}
