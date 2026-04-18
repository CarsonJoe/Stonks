export interface ApiProbeResult {
  ok: boolean;
  source: string;
  requestedAt: string;
  requestUrl: string;
  status: number | null;
  preview: unknown;
  error?: string;
}

export interface MarketQuoteResult {
  ok: boolean;
  source: string;
  symbol: string;
  exchange: string | null;
  micCode: string | null;
  exchangeTimezone: string | null;
  currency: string | null;
  instrumentType: string | null;
  requestedAt: string;
  requestUrl: string;
  status: number | null;
  last: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  updatedAt: string | null;
  volume: number | null;
  raw: unknown;
  error?: string;
}

export interface MarketSearchResult {
  symbol: string;
  instrumentName: string | null;
  exchange: string | null;
  micCode: string | null;
  exchangeTimezone: string | null;
  instrumentType: string | null;
  country: string | null;
  currency: string | null;
}

export interface MarketSearchResponse {
  ok: boolean;
  source: string;
  query: string;
  requestedAt: string;
  requestUrl: string;
  status: number | null;
  results: MarketSearchResult[];
  error?: string;
}

export interface MarketCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface MarketCandlesResult {
  ok: boolean;
  source: string;
  symbol: string;
  resolution: string;
  requestedAt: string;
  requestUrl: string;
  status: number | null;
  candles: MarketCandle[];
  raw: unknown;
  error?: string;
}

export interface MarketStatisticsResult {
  ok: boolean;
  symbol: string;
  pe: number | null;
  marketCap: number | null;
  error?: string;
}

interface MarketRequestArgs {
  symbol: string;
  token?: string;
}

interface MarketCandlesArgs extends MarketRequestArgs {
  resolution?: string;
  countback?: number;
  /** ISO date string — if provided, fetches from this date to now */
  startDate?: string;
}

interface MarketSearchArgs {
  query: string;
  token?: string;
  outputsize?: number;
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

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function parseTimestamp(value: unknown) {
  const numeric = readNumber(value);
  if (numeric !== null) {
    return new Date(numeric * 1000).toISOString();
  }

  const text = readString(value);
  if (!text) {
    return null;
  }

  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function getPayloadError(payload: Record<string, unknown> | null) {
  if (!payload) {
    return null;
  }

  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }

  if (typeof payload.code === 'number' && typeof payload.status === 'string') {
    return `${payload.status} (${payload.code})`;
  }

  if (payload.status === 'error') {
    return 'Request failed.';
  }

  return null;
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

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? ((await response.json()) as unknown)
    : await response.text();

  return {
    response,
    body
  };
}

function buildTwelveDataHeaders(token?: string) {
  const headers: HeadersInit = {
    Accept: 'application/json'
  };

  if (token?.trim()) {
    headers.Authorization = `apikey ${token.trim()}`;
  }

  return headers;
}

function mapResolution(resolution?: string) {
  const normalized = resolution?.trim().toLowerCase() ?? '1day';

  if (normalized === 'd' || normalized === '1d' || normalized === 'daily') {
    return '1day';
  }

  if (normalized === 'w' || normalized === '1w' || normalized === 'weekly') {
    return '1week';
  }

  if (normalized === 'm' || normalized === '1m' || normalized === 'monthly') {
    return '1month';
  }

  return normalized;
}

export async function fetchMarketDataQuote({
  symbol,
  token
}: MarketRequestArgs): Promise<MarketQuoteResult> {
  const safeSymbol = symbol.trim().toUpperCase();
  const params = new URLSearchParams({
    symbol: safeSymbol
  });
  const url = `https://api.twelvedata.com/quote?${params.toString()}`;

  try {
    const { response, body } = await requestJson(url, {
      headers: buildTwelveDataHeaders(token)
    });

    const payload =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const errorMessage =
      getPayloadError(payload) ??
      (!response.ok ? response.statusText || 'Quote request failed.' : null);
    const last = readNumber(payload?.close ?? payload?.price);

    return {
      ok: response.ok && !errorMessage && last !== null,
      source: 'Twelve Data',
      symbol: readString(payload?.symbol) ?? safeSymbol,
      exchange: readString(payload?.exchange),
      micCode: readString(payload?.mic_code),
      exchangeTimezone: readString(payload?.exchange_timezone),
      currency: readString(payload?.currency),
      instrumentType: readString(payload?.type),
      requestedAt: new Date().toISOString(),
      requestUrl: url,
      status: response.status,
      last,
      open: readNumber(payload?.open),
      high: readNumber(payload?.high),
      low: readNumber(payload?.low),
      previousClose: readNumber(payload?.previous_close),
      change: readNumber(payload?.change),
      changePercent:
        readNumber(payload?.percent_change) !== null
          ? readNumber(payload?.percent_change)! / 100
          : readNumber(payload?.percent_change_1d),
      updatedAt: parseTimestamp(payload?.timestamp ?? payload?.datetime),
      volume: readNumber(payload?.volume),
      raw: body,
      ...(errorMessage ? { error: errorMessage } : {})
    };
  } catch (error) {
    return {
      ok: false,
      source: 'Twelve Data',
      symbol: safeSymbol,
      exchange: null,
      micCode: null,
      exchangeTimezone: null,
      currency: null,
      instrumentType: null,
      requestedAt: new Date().toISOString(),
      requestUrl: url,
      status: null,
      last: null,
      open: null,
      high: null,
      low: null,
      previousClose: null,
      change: null,
      changePercent: null,
      updatedAt: null,
      volume: null,
      raw: null,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function fetchMarketSymbolSearch({
  query,
  token,
  outputsize = 6
}: MarketSearchArgs): Promise<MarketSearchResponse> {
  const trimmed = query.trim();
  const params = new URLSearchParams({
    symbol: trimmed,
    outputsize: String(outputsize)
  });
  const url = `https://api.twelvedata.com/symbol_search?${params.toString()}`;

  try {
    const { response, body } = await requestJson(url, {
      headers: buildTwelveDataHeaders(token)
    });

    const payload =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const errorMessage =
      getPayloadError(payload) ??
      (!response.ok ? response.statusText || 'Search request failed.' : null);

    const results = Array.isArray(payload?.data)
      ? (payload.data as Array<Record<string, unknown>>)
          .map((entry) => {
            const symbol = readString(entry.symbol);

            if (!symbol) {
              return null;
            }

            return {
              symbol,
              instrumentName: readString(entry.instrument_name),
              exchange: readString(entry.exchange),
              micCode: readString(entry.mic_code),
              exchangeTimezone: readString(entry.exchange_timezone),
              instrumentType: readString(entry.instrument_type),
              country: readString(entry.country),
              currency: readString(entry.currency)
            } satisfies MarketSearchResult;
          })
          .filter((entry): entry is MarketSearchResult => entry !== null)
      : [];

    return {
      ok: response.ok && !errorMessage,
      source: 'Twelve Data',
      query: trimmed,
      requestedAt: new Date().toISOString(),
      requestUrl: url,
      status: response.status,
      results,
      ...(errorMessage ? { error: errorMessage } : {})
    };
  } catch (error) {
    return {
      ok: false,
      source: 'Twelve Data',
      query: trimmed,
      requestedAt: new Date().toISOString(),
      requestUrl: url,
      status: null,
      results: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function fetchMarketDataCandles({
  symbol,
  token,
  resolution = '1day',
  countback = 32,
  startDate
}: MarketCandlesArgs): Promise<MarketCandlesResult> {
  const safeSymbol = symbol.trim().toUpperCase();
  const interval = mapResolution(resolution);
  const params = new URLSearchParams({
    symbol: safeSymbol,
    interval,
    outputsize: String(countback),
    order: 'asc',
    timezone: 'UTC'
  });
  if (startDate) {
    // Twelve Data accepts YYYY-MM-DD
    params.set('start_date', startDate.slice(0, 10));
    params.delete('outputsize'); // let the API return all candles from start_date
  }
  const url = `https://api.twelvedata.com/time_series?${params.toString()}`;

  try {
    const { response, body } = await requestJson(url, {
      headers: buildTwelveDataHeaders(token)
    });

    const payload =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const errorMessage =
      getPayloadError(payload) ??
      (!response.ok ? response.statusText || 'Chart request failed.' : null);

    const values = Array.isArray(payload?.values)
      ? (payload.values as Array<Record<string, unknown>>)
      : [];

    const candles = values
      .map((entry) => {
        const time = parseTimestamp(entry.datetime);
        const open = readNumber(entry.open);
        const high = readNumber(entry.high);
        const low = readNumber(entry.low);
        const close = readNumber(entry.close);

        if (!time || open === null || high === null || low === null || close === null) {
          return null;
        }

        return {
          time: Math.floor(new Date(time).valueOf() / 1000),
          open,
          high,
          low,
          close,
          volume: readNumber(entry.volume)
        } satisfies MarketCandle;
      })
      .filter((entry): entry is MarketCandle => entry !== null);

    return {
      ok: response.ok && !errorMessage && candles.length > 0,
      source: 'Twelve Data',
      symbol: readString(payload?.meta && typeof payload.meta === 'object'
        ? (payload.meta as Record<string, unknown>).symbol
        : null) ?? safeSymbol,
      resolution: interval,
      requestedAt: new Date().toISOString(),
      requestUrl: url,
      status: response.status,
      candles,
      raw: body,
      ...(errorMessage || candles.length === 0
        ? { error: errorMessage ?? 'No chart data returned.' }
        : {})
    };
  } catch (error) {
    return {
      ok: false,
      source: 'Twelve Data',
      symbol: safeSymbol,
      resolution: interval,
      requestedAt: new Date().toISOString(),
      requestUrl: url,
      status: null,
      candles: [],
      raw: null,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function fetchMarketStatistics({
  symbol,
  token
}: MarketRequestArgs): Promise<MarketStatisticsResult> {
  const safeSymbol = symbol.trim().toUpperCase();
  const params = new URLSearchParams({ symbol: safeSymbol });
  const url = `https://api.twelvedata.com/statistics?${params.toString()}`;

  try {
    const { response, body } = await requestJson(url, {
      headers: buildTwelveDataHeaders(token)
    });

    const payload =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const errorMessage =
      getPayloadError(payload) ??
      (!response.ok ? response.statusText || 'Statistics request failed.' : null);

    const valuations =
      payload?.statistics &&
      typeof payload.statistics === 'object' &&
      (payload.statistics as Record<string, unknown>).valuations_metrics &&
      typeof (payload.statistics as Record<string, unknown>).valuations_metrics === 'object'
        ? ((payload.statistics as Record<string, unknown>).valuations_metrics as Record<string, unknown>)
        : null;

    return {
      ok: response.ok && !errorMessage,
      symbol: safeSymbol,
      pe: readNumber(valuations?.trailing_pe),
      marketCap: readNumber(valuations?.market_capitalization),
      ...(errorMessage ? { error: errorMessage } : {})
    };
  } catch (error) {
    return {
      ok: false,
      symbol: safeSymbol,
      pe: null,
      marketCap: null,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
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
