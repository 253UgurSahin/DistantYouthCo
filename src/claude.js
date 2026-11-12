import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL } from './config.js';

export function claudeConfigured(settings) {
  return Boolean(settings.anthropic_api_key || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** A user-facing error: its message is safe to show in the app. */
export class ClaudeError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/**
 * One request that must come back as JSON matching `schema`. Uses structured outputs and the
 * server-side refusal fallback; returns { data, model }.
 */
export async function claudeJson(settings, { system, user, schema, effort = 'medium' }) {
  if (!claudeConfigured(settings)) throw new ClaudeError('Claude is niet ingesteld. Voeg een API key toe bij Instellingen.', 409);
  const client = new Anthropic(settings.anthropic_api_key ? { apiKey: settings.anthropic_api_key } : {});
  let response;
  try {
    response = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new ClaudeError('De Claude API key is ongeldig. Controleer Instellingen.');
    if (err instanceof Anthropic.PermissionDeniedError) throw new ClaudeError('Deze Claude API key heeft geen toegang tot dit model.');
    if (err instanceof Anthropic.RateLimitError) throw new ClaudeError('Claude heeft even te veel verzoeken gehad. Probeer het zo opnieuw.');
    if (err instanceof Anthropic.APIConnectionError) throw new ClaudeError('Kan de Claude API niet bereiken (netwerk).');
    if (err instanceof Anthropic.APIError) throw new ClaudeError(`Claude API gaf een fout (${err.status ?? 'onbekend'}).`);
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new ClaudeError('Claude wilde dit niet schrijven. Pas de tekst aan of gebruik het template.');
  if (response.stop_reason === 'max_tokens') throw new ClaudeError('Het antwoord werd te lang en is afgebroken. Probeer opnieuw.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return { data: JSON.parse(text), model: response.model };
  } catch {
    throw new ClaudeError('Kon het antwoord van Claude niet lezen. Probeer opnieuw.');
  }
}
