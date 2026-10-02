import { ProviderError } from './providers.mjs';

export const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
export const NVIDIA_MODEL = 'nvidia/nemotron-3-super-120b-a12b';

export function validateOrchestratorSettings({ provider, endpoint, model, brief, intervalHours, dailyLimit, mode = 'scheduled' }) {
  if (!['scheduled', 'continuous'].includes(mode)) throw new Error('Choose continuous or scheduled research.');
  if (!['nvidia', 'compatible'].includes(provider)) throw new Error('Choose NVIDIA or an OpenAI-compatible provider.');
  const target = provider === 'nvidia' ? NVIDIA_ENDPOINT : endpoint?.trim();
  let url;
  try { url = new URL(target); } catch { throw new Error('Enter a valid chat completions URL.'); }
  if (!((url.protocol === 'https:') || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTPS endpoint, or HTTP on localhost, without credentials or query parameters.');
  }
  if (provider === 'nvidia' && url.href !== NVIDIA_ENDPOINT) throw new Error('Invalid NVIDIA endpoint.');
  if (!model?.trim() || model.length > 160) throw new Error('Enter a model ID of 1–160 characters.');
  if (!brief?.trim() || brief.length > 4000) throw new Error('Enter a research direction of 1–4,000 characters.');
  const hours = Number(intervalHours), limit = Number(dailyLimit);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24 || !Number.isInteger(limit) || limit < 0 || limit > 1000) throw new Error('Set an interval of 1–24 hours and a daily limit of 0–1,000 tasks (0 means no app cap).');
  return { provider, endpoint: url.href, model: model.trim(), brief: brief.trim(), intervalHours: hours, dailyLimit: limit, mode };
}

function parseJsonMessage(value) {
  if (typeof value !== 'string') throw new Error('Model returned no text.');
  const clean = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(clean); } catch { throw new Error('Model did not return valid JSON.'); }
}

export function orchestratorClient({ endpoint, model, apiKey }, fetcher = fetch) {
  return async (system, user) => {
    let response;
    try {
      response = await fetcher(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: false, max_tokens: 900, ...(endpoint === NVIDIA_ENDPOINT && model === NVIDIA_MODEL ? { chat_template_kwargs: { enable_thinking: false } } : {}) }),
        signal: AbortSignal.timeout(60000)
      });
    } catch (error) { throw new ProviderError('Model', 503, `Model provider is unavailable: ${error.message}`); }
    let data;
    try { data = await response.json(); } catch { throw new Error('Model provider returned invalid JSON.'); }
    if (!response.ok) throw new ProviderError('Model', response.status, `Model provider: ${response.status === 401 ? 'Invalid API key' : response.status === 410 ? `Model ${model} is no longer available at this endpoint. Select a supported Model ID under Model connection.` : data?.error?.message || response.statusText}`);
    return parseJsonMessage(data.choices?.[0]?.message?.content);
  };
}

export async function proposeResearch(client, { brief, repository, recentTopics }) {
  const result = await client(
    'You plan one research task for a Jules coding agent. Return only a JSON object with strings "topic" and "instructions". Keep topic within 300 characters and instructions within 3,000 characters; aim for about 1,000 characters of instructions. Choose a distinct, specific topic within the user direction. Instructions should describe research questions, sources or methods, and concrete deliverables. The direction is a standing assignment: independently choose markets, geography, methods, sources, and scope when unspecified. Never ask the user questions or wait for clarification. Use accessible public sources and document assumptions and gaps rather than requesting credentials or inventing evidence. Never request work outside the assigned project folder, repository changes elsewhere, secrets, account changes, or destructive actions.',
    JSON.stringify({ direction: brief, repository, recentTopics: recentTopics.slice(0, 30) })
  );
  const topic = result?.topic?.trim(), instructions = result?.instructions?.trim();
  if (!topic || topic.length > 300 || !instructions || instructions.length > 3000) throw new Error('Model proposal needs a topic (1–300 characters) and instructions (1–3,000 characters).');
  if (recentTopics.some(item => item.toLowerCase() === topic.toLowerCase())) throw new Error('Model repeated a previous topic. Try again at the next interval.');
  return { topic, instructions };
}

export async function draftJulesReply(client, { brief, topic, instructions, question }) {
  const result = await client(
    'Act as the autonomous research project owner answering Jules. Return only a JSON object with a "reply" string. Give a concrete decision using the supplied direction and task. Keep Jules inside its assigned folder and the original research scope. Never ask the user questions or tell Jules to wait for human input. Independently choose reasonable scope and methods, state assumptions, and continue. If credentials, permissions, paid data, or personal preferences are unavailable, choose accessible public sources or another permitted method; document any remaining gap and finish the report. Do not invent facts, grant permissions, or promise credentials.',
    JSON.stringify({ direction: brief, topic, instructions, question: String(question).slice(0, 6000) })
  );
  const reply = result?.reply?.trim();
  if (!reply || reply.length > 5000) throw new Error('Model reply must be 1–5,000 characters.');
  return reply;
}
