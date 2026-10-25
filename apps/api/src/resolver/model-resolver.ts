// src/resolver/model-resolver.ts — Model-second path for unresolved pairs (06 rule 12)

export interface ModelResolution {
  decision: 'ADD' | 'MERGE' | 'SUPERSEDE' | 'NOOP';
  rationale: string;
}

export async function consultModel(
  candidate: any,
  incumbent: any,
  apiKey: string,
  model: string = 'anthropic/claude-haiku-5.5'
): Promise<ModelResolution | null> {
  const prompt = `You are a memory resolution system. Given a new candidate memory and an existing incumbent memory, decide what should happen.

CANDIDATE:
${JSON.stringify(candidate, null, 2)}

INCUMBENT:
${JSON.stringify(incumbent, null, 2)}

RULES:
- ADD: The candidate is a new, distinct claim. No overlap with incumbent.
- MERGE: The candidate reinforces the incumbent (same or near-identical value, new evidence).
- SUPERSEDE: The candidate replaces the incumbent (different value, newer/better source).
- NOOP: The candidate adds nothing new. Incumbent already covers it.

CONSTRAINTS:
- If the candidate is agent_inferred or agent_reflection and the incumbent is user_stated/user_confirmed/user_edited, you CANNOT choose SUPERSEDE. Choose STAYS_CANDIDATE instead (but since STAYS_CANDIDATE is not an option here, choose NOOP).
- You must return exactly one of: ADD, MERGE, SUPERSEDE, NOOP
- Include a one-line rationale.

Return ONLY valid JSON: {"decision": "ADD|MERGE|SUPERSEDE|NOOP", "rationale": "one line"}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    const validDecisions = ['ADD', 'MERGE', 'SUPERSEDE', 'NOOP'];
    if (!validDecisions.includes(parsed.decision)) return null;

    return {
      decision: parsed.decision,
      rationale: parsed.rationale || 'no rationale',
    };
  } catch {
    return null;
  }
}

export function loadApiKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const fs = require('fs');
  const path = require('path');
  const localrc = path.join(process.env.HOME || '', '.localrc');
  if (fs.existsSync(localrc)) {
    const content = fs.readFileSync(localrc, 'utf8');
    const match = content.match(/OPENROUTER_API_KEY=(.+)/);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}