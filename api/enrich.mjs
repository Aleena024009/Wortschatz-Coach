// Optional AI helper, deployed as a Vercel serverless function at /api/enrich.
// The Anthropic API key lives only in the server's environment (ANTHROPIC_API_KEY),
// never in the frontend.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY  required
//   APP_PASSCODE       recommended: callers must send it in the x-app-passcode header,
//                      so strangers who find the URL can't spend your credit
//   ALLOWED_ORIGIN     optional: e.g. https://yourname.github.io, to allow the GitHub
//                      Pages copy of the app to call this function

import Anthropic from '@anthropic-ai/sdk';
import { timingSafeEqual } from 'node:crypto';

const MODEL = 'claude-haiku-5-5'; // cheapest and fastest Claude model
const MAX_FILL = 120;
const MAX_EXTRACT = 80;
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const POS = ['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'article', 'numeral', 'interjection', 'phrase', 'other'];

let client; // created on first use, after the environment is loaded

const RESPELLING_RULES = `Respelling: an easy English-style spelling for an English speaker, syllables joined by hyphens, the stressed syllable in CAPITALS. Use: ee (ie), ay (long e), ah (a), oh (long o), oo (u), eye (ei), ow (au), oy (eu/äu), ur (ö), ew (ü), kh (ch), sh (sch, s before p/t at the start), ts (z), v (w), f (v), y (j), uh (final -e/-er). Examples: Schwester → SHVES-tuh, gehen → GAY-un, Erfahrung → air-FAH-roong, sich beschweren → zikh buh-SHVAY-run. Do not include the article in the respelling.
IPA: standard German IPA without slashes. Level: the CEFR level (A1–C2) a learner usually meets the word at.`;

const string = { type: 'string' };
const levelEnum = { type: 'string', enum: LEVELS };
const posEnum = { type: 'string', enum: POS };

const FILL_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: string, ipa: string, respelling: string, level: levelEnum, pos: posEnum },
        required: ['id', 'ipa', 'respelling', 'level', 'pos'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          german: string,
          article: { type: 'string', enum: ['der', 'die', 'das', ''] },
          english: string,
          ipa: string,
          respelling: string,
          level: levelEnum,
          pos: posEnum,
          example: string,
        },
        required: ['german', 'article', 'english', 'ipa', 'respelling', 'level', 'pos', 'example'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const FILL_SYSTEM = `You help an English-speaking learner pronounce German vocabulary. For every word you receive, return its id unchanged with IPA, respelling, CEFR level and part of speech.
${RESPELLING_RULES}`;

const EXTRACT_SYSTEM = `You help an English-speaking learner build a German vocabulary list from a text. You receive word forms found in the text and the sentences they came from. Return one item per useful vocabulary word in its dictionary form: nouns in the singular with their article (article field der/die/das, german field without the article), verbs in the infinitive (reflexive verbs with "sich"), adjectives in the base form. Merge different forms of the same word into one item. Skip proper names, numbers and words that are not German. english: a short meaning that fits the text. example: one short, simple German sentence using the word.
${RESPELLING_RULES}`;

function corsHeaders(request) {
  const allowed = process.env.ALLOWED_ORIGIN;
  const origin = request.headers.get('origin');
  if (!allowed || !origin) return {};
  const list = allowed.split(',').map((s) => s.trim());
  if (!list.includes('*') && !list.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-app-passcode',
    vary: 'origin',
  };
}

function passcodeOk(request) {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  const given = Buffer.from(request.headers.get('x-app-passcode') || '');
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

const json = (body, status, headers) => Response.json(body, { status, headers });

function buildRequest(body) {
  if (body?.mode === 'fill' && Array.isArray(body.words)) {
    const words = body.words.slice(0, MAX_FILL).map((w) => ({
      id: String(w.id ?? '').slice(0, 64),
      german: String(w.german ?? '').slice(0, 100),
      english: String(w.english ?? '').slice(0, 200),
    }));
    return { system: FILL_SYSTEM, schema: FILL_SCHEMA, content: JSON.stringify({ words }) };
  }
  if (body?.mode === 'extract' && Array.isArray(body.words)) {
    const words = body.words.slice(0, MAX_EXTRACT).map((w) => String(w).slice(0, 60));
    const context = String(body.context ?? '').slice(0, 4000);
    return { system: EXTRACT_SYSTEM, schema: EXTRACT_SCHEMA, content: JSON.stringify({ words, sentences: context }) };
  }
  return null;
}

export function OPTIONS(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request) {
  const cors = corsHeaders(request);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'The server has no ANTHROPIC_API_KEY set.' }, 500, cors);
  if (!passcodeOk(request)) return json({ error: 'Wrong or missing passcode.' }, 401, cors);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON.' }, 400, cors);
  }
  const req = buildRequest(body);
  if (!req) return json({ error: 'Expected { mode: "fill" | "extract", words: [...] }.' }, 400, cors);

  try {
    client ||= new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // A lookup task: no extended reasoning needed, keep it fast and cheap.
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: req.schema } },
      system: req.system,
      messages: [{ role: 'user', content: req.content }],
    });

    if (response.stop_reason === 'refusal') return json({ error: 'The AI declined this request.' }, 502, cors);
    if (response.stop_reason === 'max_tokens') return json({ error: 'Too many words in one batch. Try fewer.' }, 502, cors);
    const text = response.content.find((b) => b.type === 'text')?.text;
    return json(JSON.parse(text), 200, cors);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return json({ error: 'The server API key is invalid.' }, 500, cors);
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'AI is busy (rate limit). Try again in a minute.' }, 429, cors);
    if (err instanceof Anthropic.APIError) return json({ error: `AI error: ${err.message}` }, 502, cors);
    if (err instanceof SyntaxError) return json({ error: 'The AI returned an unreadable answer. Try again.' }, 502, cors);
    return json({ error: 'Could not reach the AI service.' }, 502, cors);
  }
}
