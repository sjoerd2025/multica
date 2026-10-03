# Jev Verification Route

Use this route when leading a squad task that needs cheap-model answers verified before they are trusted. A cheap model drafts, Jev checks whether the retrieved context supports the draft, and a frontier model rewrites only when the check fails.

## Verdict labels
- `supported` — the answer addresses the question and every fact, number, and policy appears in the excerpts.
- `unsupported` — the answer asserts something the excerpts lack or contradict, or answers a different question.
- `declined` — the answer says the excerpts do not cover the question and adds no facts of its own.

## Flow
1. Draft with the cheap model: `~openai/gpt-luna-latest`
2. Verify with Jev (`typesafe/jev-1.13`) at `https://openrouter.ai/api/alpha/decisions` — one `choice` question over `{help_center_excerpts, customer_question, assistant_answer}`
3. Send when `supported` with confidence >= `0.8`; escalate to `~openai/gpt-astra-latest` when `unsupported`; hand off to a human when `declined`

## Telemetry contract
Log only model names, route (`send`/`handoff`), and usage/cost fields when returned. Never log prompts, answers, excerpts, cookies, or API keys.

## Reference
`examples/jev-cascade` in the multica repo.