import { normalizeSearchText } from './utils';

export type ResearchTimeframeId = '1d' | '1w' | '1m' | '3m' | '1y';

export const researchTimeframes: Record<
  ResearchTimeframeId,
  { label: string; resolution: string; countback: number }
> = {
  '1d': { label: '1D', resolution: '5min', countback: 78 },
  '1w': { label: '1W', resolution: '1h', countback: 40 },
  '1m': { label: '1M', resolution: '1day', countback: 22 },
  '3m': { label: '3M', resolution: '1day', countback: 65 },
  '1y': { label: '1Y', resolution: '1week', countback: 52 }
};

export interface ResearchIdentity {
  symbol: string;
  instrumentName: string | null;
  exchange: string | null;
  micCode: string | null;
  exchangeTimezone: string | null;
  instrumentType: string | null;
  country: string | null;
  currency: string | null;
}

export interface ResearchSuggestion extends ResearchIdentity {
  source: 'alias' | 'search';
}

const researchAliases: Array<{ keys: string[]; suggestion: ResearchSuggestion }> = [
  {
    keys: ['facebook', 'meta', 'instagram'],
    suggestion: {
      symbol: 'META', instrumentName: 'Meta Platforms', exchange: 'NASDAQ',
      micCode: 'XNAS', exchangeTimezone: 'America/New_York',
      instrumentType: 'Common Stock', country: 'United States', currency: 'USD', source: 'alias'
    }
  },
  {
    keys: ['google', 'alphabet'],
    suggestion: {
      symbol: 'GOOGL', instrumentName: 'Alphabet', exchange: 'NASDAQ',
      micCode: 'XNAS', exchangeTimezone: 'America/New_York',
      instrumentType: 'Common Stock', country: 'United States', currency: 'USD', source: 'alias'
    }
  },
  {
    keys: ['apple', 'iphone'],
    suggestion: {
      symbol: 'AAPL', instrumentName: 'Apple', exchange: 'NASDAQ',
      micCode: 'XNAS', exchangeTimezone: 'America/New_York',
      instrumentType: 'Common Stock', country: 'United States', currency: 'USD', source: 'alias'
    }
  },
  {
    keys: ['microsoft'],
    suggestion: {
      symbol: 'MSFT', instrumentName: 'Microsoft', exchange: 'NASDAQ',
      micCode: 'XNAS', exchangeTimezone: 'America/New_York',
      instrumentType: 'Common Stock', country: 'United States', currency: 'USD', source: 'alias'
    }
  },
  {
    keys: ['amazon'],
    suggestion: {
      symbol: 'AMZN', instrumentName: 'Amazon', exchange: 'NASDAQ',
      micCode: 'XNAS', exchangeTimezone: 'America/New_York',
      instrumentType: 'Common Stock', country: 'United States', currency: 'USD', source: 'alias'
    }
  },
  {
    keys: ['nvidia'],
    suggestion: {
      symbol: 'NVDA', instrumentName: 'NVIDIA', exchange: 'NASDAQ',
      micCode: 'XNAS', exchangeTimezone: 'America/New_York',
      instrumentType: 'Common Stock', country: 'United States', currency: 'USD', source: 'alias'
    }
  },
  {
    keys: ['tesla'],
    suggestion: {
      symbol: 'TSLA', instrumentName: 'Tesla', exchange: 'NASDAQ',
      micCode: 'XNAS', exchangeTimezone: 'America/New_York',
      instrumentType: 'Common Stock', country: 'United States', currency: 'USD', source: 'alias'
    }
  },
  {
    keys: ['spy', 's&p 500', 's&p500', 's&p', 'sp500'],
    suggestion: {
      symbol: 'SPY', instrumentName: 'SPDR S&P 500 ETF Trust', exchange: 'NYSE ARCA',
      micCode: 'ARCX', exchangeTimezone: 'America/New_York',
      instrumentType: 'ETF', country: 'United States', currency: 'USD', source: 'alias'
    }
  },
  {
    keys: ['qqq', 'nasdaq'],
    suggestion: {
      symbol: 'QQQ', instrumentName: 'Invesco QQQ Trust', exchange: 'NASDAQ',
      micCode: 'XNAS', exchangeTimezone: 'America/New_York',
      instrumentType: 'ETF', country: 'United States', currency: 'USD', source: 'alias'
    }
  }
];

export function findAliasMatches(query: string): ResearchSuggestion[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];

  return researchAliases
    .filter(({ keys, suggestion }) => {
      if (suggestion.symbol.toLowerCase() === normalized.replace(/\s+/g, '')) return true;
      return keys.some((key) => key.includes(normalized) || normalized.includes(key));
    })
    .map(({ suggestion }) => suggestion);
}

export function findExactAlias(query: string): ResearchSuggestion | null {
  const normalized = normalizeSearchText(query);
  return (
    researchAliases.find(({ keys, suggestion }) => {
      const compact = normalized.replace(/\s+/g, '');
      return (
        suggestion.symbol.toLowerCase() === compact ||
        keys.some((key) => normalizeSearchText(key) === normalized)
      );
    })?.suggestion ?? null
  );
}

export function dedupeResearchSuggestions(suggestions: ResearchSuggestion[]): ResearchSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((s) => {
    const key = `${s.symbol}:${s.micCode ?? s.exchange ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
