# Advisor Review Route

Use this route when leading a squad review or planning task. It offers a budget-gated `openrouter:advisor` second-model check and logs telemetry without leaking prompts or diffs.

## Budget gate
Enable the Advisor only when the task has any of these uncertainty signals:
- `billing-path`
- `large-diff`
- `missing-rollback`
- `missing-tests`
- `schema-change`
- `unknown-owner`

Routine tasks run on the cheap executor with no Advisor tool.

## Advisor tool entry (Chat Completions)
```json
{
  "type": "openrouter:advisor",
  "parameters": {
    "name": "plan-reviewer",
    "model": "~anthropic/claude-opus-latest",
    "instructions": "You are a senior engineering reviewer. Review only the compact task packet. Identify hidden assumptions, missing rollback steps, missing tests, and cheaper alternatives. Be concise.",
    "forward_transcript": false,
    "max_completion_tokens": 220,
    "temperature": 0
  }
}
```
- Executor model: `openai/gpt-4o-mini`
- Advisor model: `~anthropic/claude-opus-latest`
- Send a compact packet only: title, question, changed files, uncertainty signals, diff summary. No full diffs, logs, secrets, or transcripts.
- `forward_transcript` stays `false` unless the advisor genuinely needs the whole conversation.
- Do not use a nested advisor roster; one entry, flat `parameters`.

## Telemetry contract
Log only: `executor_model`, `advisor_model`, `did_enable_advisor`, `finish_reason`, and usage keys (`prompt_tokens`, `completion_tokens`, `total_tokens`, `cost`). Never log prompts, raw diffs, full advice, cookies, or API keys.

## Reference
`examples/advisor-review` in the multica repo.