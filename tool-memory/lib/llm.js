// Shared defensive access to dsh's llm Cordis service for one-shot text calls
// (used by the query expander and the listwise reranker). Anything unavailable
// resolves to null/undefined so callers can silently fall back.

export function llmOf(ctx) {
  return typeof ctx.get === 'function' ? ctx.get('llm') : undefined
}

export function defaultSelectionOf(ctx) {
  if (typeof ctx.get !== 'function') return undefined
  try {
    return ctx.get('agentDefaultModel')?.currentSelection?.()
  } catch {
    return undefined
  }
}

export function llmReady(ctx) {
  const llm = llmOf(ctx)
  const selection = defaultSelectionOf(ctx)
  if (!llm || typeof llm.stream !== 'function' || !selection?.provider || !selection?.model) return null
  return { llm, selection }
}

export async function streamText(llm, selection, { id, prompt, maxTokens = 512 }) {
  const message = {
    id,
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  }
  let text = ''
  const stream = llm.stream({ provider: selection.provider, model: selection.model, messages: [message], maxTokens })
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta') text += chunk.text
  }
  return text
}

export function parseJsonArray(text) {
  const match = /\[[\s\S]*?\]/.exec(text)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}
