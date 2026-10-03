import { OpenRouter } from '@openrouter/sdk';

const DRAFT_MODEL = '~openai/gpt-luna-latest';
const ESCALATION_MODEL = '~openai/gpt-astra-latest';
const JEVER_MODEL = 'typesafe/jev-1.13';

const SYSTEM_PROMPT =
  'You are the support assistant for Northwind. Answer only from the help center excerpts provided. If they do not cover the question, say so and offer to connect the customer with support.';

const ACCEPT_CONFIDENCE = 0.8;

const openrouter = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

export type Verdict = {
  choice: 'supported' | 'unsupported' | 'declined';
  confidence: number;
  probabilities: Record<string, number>;
};

export type CascadeResult = {
  route: 'send' | 'handoff';
  model: string;
  answer: string;
  verdicts: Verdict[];
};

function isLabel(choice: string): choice is Verdict['choice'] {
  return choice === 'supported' || choice === 'unsupported' || choice === 'declined';
}

export async function draftAnswer(
  model: string,
  question: string,
  excerpts: string[],
): Promise<string> {
  const result = await openrouter.chat.send({
    chatGenerationParams: {
      model,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Help center excerpts:\n${excerpts
            .map((text, i) => `[${i + 1}] ${text}`)
            .join('\n')}\n\nCustomer question: ${question}`,
        },
      ],
    },
  });

  if (result instanceof ReadableStream) {
    throw new Error('Expected a non-streaming response');
  }

  const content = result.choices[0]?.message.content;
  if (typeof content !== 'string') {
    throw new Error('Expected text content');
  }
  return content;
}

export async function verifyAnswer(
  question: string,
  excerpts: string[],
  answer: string,
): Promise<Verdict> {
  const response = await fetch('https://openrouter.ai/api/alpha/decisions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: JEVER_MODEL,
      state: {
        help_center_excerpts: excerpts,
        customer_question: question,
        assistant_answer: answer,
      },
      questions: {
        support: {
          type: 'choice',
          instructions:
            'Compare assistant_answer against help_center_excerpts. Which one describes it?',
          criteria: {
            supported:
              'The answer addresses customer_question, and every fact, number, and policy in it is stated in the excerpts.',
            unsupported:
              'The answer states at least one fact, number, or policy that the excerpts do not contain or that contradicts them, or it answers a different question than customer_question.',
            declined:
              'The answer says the excerpts do not cover the question and does not assert facts of its own.',
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Decisions API ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    answers?: { support?: { type?: string; choice?: string; confidence?: number; probabilities?: Record<string, number> } };
  };
  const verdict = data.answers?.support;
  const choice = verdict?.choice;
  if (verdict?.type !== 'choice' || !choice || !isLabel(choice)) {
    throw new Error('Expected a choice answer with a known label');
  }

  return {
    choice,
    confidence: verdict.confidence ?? 0,
    probabilities: verdict.probabilities ?? {},
  };
}

export async function answerWithCascade(
  question: string,
  excerpts: string[],
): Promise<CascadeResult> {
  const verdicts: Verdict[] = [];
  let answer = '';

  for (const model of [DRAFT_MODEL, ESCALATION_MODEL]) {
    answer = await draftAnswer(model, question, excerpts);
    const verdict = await verifyAnswer(question, excerpts, answer);
    verdicts.push(verdict);

    if (verdict.choice === 'supported' && verdict.confidence >= ACCEPT_CONFIDENCE) {
      return { route: 'send', model, answer, verdicts };
    }

    if (verdict.choice === 'declined') {
      return { route: 'handoff', model, answer, verdicts };
    }
  }

  return { route: 'handoff', model: ESCALATION_MODEL, answer, verdicts };
}

const EXCERPTS = [
  'Plan limits: Free workspaces have up to 5 members and 3 projects. Team workspaces ($8 per member per month, billed annually) have unlimited projects and up to 250 members.',
  'Billing: Team plans are billed annually. Downgrading to Free takes effect at the end of the current billing period. We do not issue prorated refunds for unused time.',
  'Data export: Workspace owners can export all projects as CSV or JSON from Settings > Data. Exports include tasks, comments, and attachment metadata but not attachment files.',
];

async function main() {
  const questions = [
    'How many people can I add on the free plan?',
    'Do you integrate with Jira?',
    'Can I get a refund if I downgrade mid-year?',
  ];

  for (const q of questions) {
    const result = await answerWithCascade(q, EXCERPTS);
    console.log(JSON.stringify({ question: q, ...result }, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
