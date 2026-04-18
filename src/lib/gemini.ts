export interface GeminiResearchResult {
  ok: boolean;
  symbol: string;
  summary: string | null;
  error?: string;
}

export async function fetchGeminiStockResearch({
  symbol,
  instrumentName,
  apiKey
}: {
  symbol: string;
  instrumentName: string | null;
  apiKey: string;
}): Promise<GeminiResearchResult> {
  const safeSymbol = symbol.trim().toUpperCase();
  const nameHint = instrumentName ? ` (${instrumentName})` : '';
  const prompt =
    `Summarize current market sentiment, analyst views, and notable recent news for ${safeSymbol}${nameHint}. ` +
    `2–3 paragraphs. No introduction, no sign-off, no conversational framing — just the content.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey.trim()}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }]
      })
    });

    const body = (await response.json()) as unknown;
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;

    if (!response.ok) {
      const apiError = payload?.error;
      const msg =
        apiError && typeof apiError === 'object' && typeof (apiError as Record<string, unknown>).message === 'string'
          ? (apiError as Record<string, unknown>).message as string
          : response.statusText || 'Gemini request failed.';
      return { ok: false, symbol: safeSymbol, summary: null, error: msg };
    }

    const candidates = Array.isArray(payload?.candidates) ? (payload!.candidates as unknown[]) : [];
    const first =
      candidates[0] && typeof candidates[0] === 'object'
        ? (candidates[0] as Record<string, unknown>)
        : null;
    const content =
      first?.content && typeof first.content === 'object'
        ? (first.content as Record<string, unknown>)
        : null;
    const parts = Array.isArray(content?.parts) ? (content!.parts as unknown[]) : [];

    const text = parts
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim();

    if (!text) {
      return { ok: false, symbol: safeSymbol, summary: null, error: 'No content returned.' };
    }

    return { ok: true, symbol: safeSymbol, summary: text };
  } catch (error) {
    return {
      ok: false,
      symbol: safeSymbol,
      summary: null,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
