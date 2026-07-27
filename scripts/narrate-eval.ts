/**
 * Prompt development bench for the generated narration.
 *
 * Runs the same situationOf → buildPrompt → generate → validate path
 * api/narration.ts uses, against the three fixtures that actually have
 * something to narrate (curtailing, calm, degraded — `waiting` and `offline`
 * carry no data and are not narration test cases). Without ANTHROPIC_API_KEY
 * set this prints the facts and the prompt for each fixture and stops there,
 * so the prompt can be read and edited without spending a call. With a key,
 * it calls the model and prints the validator's verdict alongside the text —
 * this transcript is the phase 2 prompt-iteration log.
 *
 * Run with `npm run narrate:eval`.
 */

try {
  process.loadEnvFile();
} catch {
  // No local .env — fine if ANTHROPIC_API_KEY is already in the shell.
}

import { scenarioByName } from '../src/lib/scenarios';
import { situationOf } from '../src/lib/situation';
import { buildPrompt, factsOf, validate, MIN_WORDS, MAX_WORDS } from '../api/_lib/narration-prompt';

const FIXTURES = ['curtailing', 'calm', 'degraded'];
const MODEL = 'claude-sonnet-5';

async function callModel(system: string, user: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 220,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  const data = (await response.json()) as { content: { type: string; text?: string }[] };
  const text = data.content.find((b) => b.type === 'text')?.text?.trim();
  if (!text) throw new Error('no text block in response');
  return text;
}

async function main() {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!hasKey) {
    console.log('No ANTHROPIC_API_KEY set — printing facts and prompts only (dry run).\n');
  }

  for (const name of FIXTURES) {
    const scenario = scenarioByName(name);
    const { grid, curtailment } = scenario.build!(new Date());
    const situation = situationOf(grid, curtailment);
    const facts = factsOf(situation);
    const prompt = buildPrompt(situation);

    console.log(`\n=== ${name} ===`);
    console.log('facts:');
    for (const fact of facts) console.log(`  - ${fact}`);

    if (!hasKey) {
      console.log('\nsystem prompt:\n' + prompt.system);
      console.log('\nuser message:\n' + prompt.user);
      continue;
    }

    const text = await callModel(prompt.system, prompt.user);
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const ok = validate(text, situation);

    console.log(`\ngenerated (${words} words, band ${MIN_WORDS}-${MAX_WORDS}):`);
    console.log(text);
    console.log(`validator: ${ok ? 'PASS' : 'FAIL'}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
