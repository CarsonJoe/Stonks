export interface ApiProbeResult {
  ok: boolean;
  source: string;
  requestedAt: string;
  requestUrl: string;
  status: number | null;
  preview: unknown;
  error?: string;
}

interface MarketDataArgs {
  symbol: string;
  token?: string;
}

interface FredArgs {
  seriesId: string;
  apiKey: string;
}

function sanitizeUrl(url: string, redactedParams: string[]) {
  const parsed = new URL(url);

  for (const param of redactedParams) {
    if (parsed.searchParams.has(param)) {
      parsed.searchParams.set(param, 'REDACTED');
    }
  }

  return parsed.toString();
}

function shortenPreview(value: unknown) {
  const serialized =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);

  if (!serialized) {
    return value;
  }

  if (serialized.length <= 3200) {
    return typeof value === 'string' ? serialized : JSON.parse(serialized);
  }

  const clipped = `${serialized.slice(0, 3200)}\n...`;
  return clipped;
}

async function probeJson(
  source: string,
  url: string,
  init?: RequestInit,
  redactedParams: string[] = []
): Promise<ApiProbeResult> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      ...init
    });
    const contentType = response.headers.get('content-type') ?? '';

    let body: unknown;
    if (contentType.includes('application/json')) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    return {
      ok: response.ok,
      source,
      requestedAt: new Date().toISOString(),
      requestUrl: sanitizeUrl(url, redactedParams),
      status: response.status,
      preview: shortenPreview(body)
    };
  } catch (error) {
    return {
      ok: false,
      source,
      requestedAt: new Date().toISOString(),
      requestUrl: sanitizeUrl(url, redactedParams),
      status: null,
      preview: null,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function fetchMarketDataQuote({
  symbol,
  token
}: MarketDataArgs): Promise<ApiProbeResult> {
  const safeSymbol = symbol.trim().toUpperCase();
  const url = `https://api.marketdata.app/v1/stocks/quotes/${encodeURIComponent(
    safeSymbol
  )}/`;

  const headers: HeadersInit = {
    Accept: 'application/json'
  };

  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  return probeJson('MarketData.app', url, { headers });
}

export async function fetchFredObservations({
  seriesId,
  apiKey
}: FredArgs): Promise<ApiProbeResult> {
  const params = new URLSearchParams({
    series_id: seriesId.trim().toUpperCase(),
    api_key: apiKey.trim(),
    file_type: 'json',
    sort_order: 'desc',
    limit: '12'
  });

  const url = `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
  return probeJson('FRED', url, undefined, ['api_key']);
}
