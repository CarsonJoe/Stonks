import { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart } from '../components/LineChart';
import { SymbolSearch } from '../components/SymbolSearch';
import type { ThesisSnapshot } from '../db';
import {
  fetchMarketDataCandles,
  fetchMarketDataQuote,
  fetchMarketStatistics,
  type MarketCandlesResult,
  type MarketQuoteResult,
  type MarketStatisticsResult
} from '../lib/market';
import { getCached, invalidatePrefix, setCached } from '../lib/marketCache';
import { researchTimeframes, type ResearchIdentity, type ResearchTimeframeId } from '../lib/research';
import {
  formatCompactNumber,
  formatCurrency,
  formatPercent,
  formatSignedCurrency,
  normalizeSymbol
} from '../lib/utils';

interface ResearchTabProps {
  marketApiKey: string;
  selectedSnapshot: ThesisSnapshot | null;
}

interface MarketPane {
  symbol: string;
  quote: MarketQuoteResult | null;
  candles: MarketCandlesResult | null;
  statistics: MarketStatisticsResult | null;
  busy: boolean;
  status: string;
}

function emptyPane(symbol = ''): MarketPane {
  return { symbol, quote: null, candles: null, statistics: null, busy: false, status: '' };
}

function buildSyntheticCandles(base: number, points = 42) {
  const safeBase = base > 0 ? base : 100;
  let lastClose = safeBase;
  return Array.from({ length: points }, (_, i) => {
    const drift = Math.sin(i / 2.4) * safeBase * 0.018 + Math.cos(i / 5.3) * safeBase * 0.007;
    const open = lastClose;
    const close = Math.max(0.01, safeBase + drift + (i - points / 2) * safeBase * 0.0008);
    const high = Math.max(open, close) + Math.abs(safeBase * 0.008 * Math.cos(i));
    const low = Math.max(0.01, Math.min(open, close) - Math.abs(safeBase * 0.008 * Math.sin(i + 0.6)));
    lastClose = close;
    return { time: Math.floor(Date.now() / 1000) - (points - i) * 86_400, open, high, low, close, volume: null };
  });
}

// ── Pull-to-refresh hook ─────────────────────────────────────────────────────

function usePullToRefresh(onRefresh: () => void) {
  const containerRef = useRef<HTMLElement | null>(null);
  const startYRef = useRef<number | null>(null);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function handleTouchStart(e: TouchEvent) {
      // Only activate if scrolled to top
      if (el!.scrollTop <= 0) {
        startYRef.current = e.touches[0].clientY;
      }
    }

    function handleTouchMove(e: TouchEvent) {
      if (startYRef.current === null) return;
      const delta = e.touches[0].clientY - startYRef.current;
      if (delta > 20) setPulling(true);
    }

    function handleTouchEnd(e: TouchEvent) {
      if (startYRef.current === null) return;
      const delta = e.changedTouches[0].clientY - startYRef.current;
      startYRef.current = null;
      setPulling(false);
      if (delta > 80) onRefresh();
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onRefresh]);

  return { containerRef, pulling };
}

// ── Component ────────────────────────────────────────────────────────────────

export function ResearchTab({ marketApiKey, selectedSnapshot }: ResearchTabProps) {
  const defaultSymbol = selectedSnapshot?.thesis.symbol ?? 'AAPL';

  const [searchInput, setSearchInput] = useState(defaultSymbol);
  const [identity, setIdentity] = useState<ResearchIdentity | null>(null);
  const [activeSymbol, setActiveSymbol] = useState(defaultSymbol);
  const [timeframe, setTimeframe] = useState<ResearchTimeframeId>('1m');
  const [market, setMarket] = useState<MarketPane>(emptyPane(defaultSymbol));
  const [refreshSeed, setRefreshSeed] = useState(0);

  // Update default when selected position changes (only if user hasn't searched yet)
  useEffect(() => {
    if (selectedSnapshot?.thesis.symbol && searchInput === 'AAPL') {
      setSearchInput(selectedSnapshot.thesis.symbol);
      setActiveSymbol(selectedSnapshot.thesis.symbol);
    }
  }, [selectedSnapshot?.thesis.symbol]);

  function handleRefresh() {
    const sym = normalizeSymbol(activeSymbol);
    const tf = researchTimeframes[timeframe];
    invalidatePrefix(`quote:${sym}`);
    invalidatePrefix(`candles:${sym}:${tf.resolution}:research:${timeframe}`);
    invalidatePrefix(`statistics:${sym}`);
    setRefreshSeed((s) => s + 1);
  }

  useEffect(() => {
    async function load() {
      const normalized = normalizeSymbol(activeSymbol);
      if (!normalized) return;

      if (!marketApiKey.trim()) {
        setMarket({
          symbol: normalized,
          quote: null,
          candles: null,
          statistics: null,
          busy: false,
          status: 'Add a Twelve Data key in Settings to load market data.'
        });
        return;
      }

      const tf = researchTimeframes[timeframe];
      const quoteKey = `quote:${normalized}`;
      const candleKey = `candles:${normalized}:${tf.resolution}:research:${timeframe}`;
      const statsKey = `statistics:${normalized}`;

      const cachedQuote = getCached<MarketQuoteResult>(quoteKey);
      const cachedCandles = getCached<MarketCandlesResult>(candleKey);
      const cachedStatistics = getCached<MarketStatisticsResult>(statsKey);

      if (cachedQuote && cachedCandles && cachedStatistics) {
        const status =
          cachedQuote.ok && cachedCandles.ok ? ''
            : cachedCandles.ok ? 'Trend loaded. Quote unavailable.'
              : cachedQuote.ok ? 'Latest price loaded. Trend unavailable.'
                : cachedQuote.error ?? cachedCandles.error ?? 'Market data unavailable.';
        setMarket({ symbol: normalized, quote: cachedQuote, candles: cachedCandles, statistics: cachedStatistics, busy: false, status });
        return;
      }

      setMarket((prev) => ({ ...prev, symbol: normalized, busy: true, status: '' }));

      const [quote, candles, statistics] = await Promise.all([
        fetchMarketDataQuote({ symbol: normalized, token: marketApiKey }),
        fetchMarketDataCandles({
          symbol: normalized,
          token: marketApiKey,
          resolution: tf.resolution,
          countback: tf.countback
        }),
        fetchMarketStatistics({ symbol: normalized, token: marketApiKey })
      ]);

      setCached(quoteKey, quote);
      setCached(candleKey, candles);
      setCached(statsKey, statistics);

      const status =
        quote.ok && candles.ok ? ''
          : candles.ok ? 'Trend loaded. Quote unavailable.'
            : quote.ok ? 'Latest price loaded. Trend unavailable.'
              : quote.error ?? candles.error ?? 'Market data unavailable.';

      setMarket({ symbol: normalized, quote, candles, statistics, busy: false, status });
    }

    void load();
  }, [activeSymbol, timeframe, marketApiKey, refreshSeed]);

  function handleSelect(id: ResearchIdentity) {
    setIdentity(id);
    setActiveSymbol(id.symbol);
    setSearchInput(id.instrumentName || id.symbol);
  }

  const researchCandles = useMemo(() => {
    if (market.candles?.candles.length) return market.candles.candles;
    const base = market.quote?.last ?? selectedSnapshot?.metrics.averageBuyPrice ?? 100;
    return buildSyntheticCandles(base, 42);
  }, [market.candles, market.quote?.last, selectedSnapshot]);

  const researchValues = useMemo(() => researchCandles.map((c) => c.close), [researchCandles]);
  const researchTimestamps = useMemo(() => researchCandles.map((c) => c.time), [researchCandles]);

  const lastPrice = market.quote?.last ?? researchValues[researchValues.length - 1] ?? null;
  const researchChange =
    market.quote?.changePercent ??
    (researchValues.length > 1
      ? (researchValues[researchValues.length - 1] - researchValues[0]) / researchValues[0]
      : null);

  const baseline = selectedSnapshot?.thesis.symbol === normalizeSymbol(activeSymbol)
    ? (selectedSnapshot?.metrics.averageBuyPrice ?? null)
    : null;

  const displaySymbol = identity?.symbol ?? normalizeSymbol(activeSymbol);
  const displayName = identity?.instrumentName ?? null;
  const displayExchange = market.quote?.exchange ?? identity?.exchange ?? null;

  const pe = market.statistics?.pe;
  const marketCap = market.statistics?.marketCap;
  const compactStats = [
    { label: 'Open', value: formatCurrency(market.quote?.open) },
    { label: 'High', value: formatCurrency(market.quote?.high ?? (researchValues.length ? Math.max(...researchValues) : null)) },
    { label: 'Low', value: formatCurrency(market.quote?.low ?? (researchValues.length ? Math.min(...researchValues) : null)) },
    { label: 'Vol', value: formatCompactNumber(market.quote?.volume) },
    { label: 'P/E', value: pe != null ? `${pe.toFixed(1)}×` : 'n/a' },
    { label: 'Mkt Cap', value: marketCap != null ? `$${formatCompactNumber(marketCap)}` : 'n/a' },
  ];

  const { containerRef, pulling } = usePullToRefresh(handleRefresh);

  return (
    <section
      className={`screen screen--research${pulling ? ' screen--pulling' : ''}`}
      ref={containerRef}
    >
      {pulling ? <div className="pull-indicator">Release to refresh</div> : null}

      <div className="research-toolbar">
        <SymbolSearch
          value={searchInput}
          onChange={setSearchInput}
          onSelect={handleSelect}
          marketApiKey={marketApiKey}
          submitLabel="Go"
          placeholder="Search company or ticker"
        />
      </div>

      <article className="hero-card hero-card--compact">
        <div className="research-header">
          <div className="hero-card__copy">
            <span className="eyebrow">
              {displaySymbol}
              {displayExchange ? ` · ${displayExchange}` : ''}
            </span>
            {displayName ? <p className="research-name">{displayName}</p> : null}
            <strong>{formatCurrency(lastPrice)}</strong>
            <span className="subtle">
              {formatSignedCurrency(market.quote?.change)} / {formatPercent(researchChange)}
            </span>
          </div>

          <div className="research-pills">
            {baseline ? (
              <div className="baseline-pill">Entry {formatCurrency(baseline)}</div>
            ) : null}
            {market.quote?.currency ? (
              <div className="baseline-pill baseline-pill--muted">{market.quote.currency}</div>
            ) : identity?.currency ? (
              <div className="baseline-pill baseline-pill--muted">{identity.currency}</div>
            ) : null}
          </div>
        </div>

        <div className="timeframe-strip" aria-label="Research timeframe">
          {(Object.keys(researchTimeframes) as ResearchTimeframeId[]).map((tf) => (
            <button
              key={tf}
              className={`timeframe-chip${timeframe === tf ? ' timeframe-chip--active' : ''}`}
              type="button"
              onClick={() => setTimeframe(tf)}
            >
              {researchTimeframes[tf].label}
            </button>
          ))}
        </div>

        <LineChart
          values={researchValues}
          timestamps={researchTimestamps.length >= 2 ? researchTimestamps : undefined}
          baseline={baseline ?? undefined}
        />

        <div className="compact-grid">
          {compactStats.map((stat) => (
            <div key={stat.label} className="compact-stat">
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div>
      </article>

      {market.status ? <p className="status-line">{market.status}</p> : null}
    </section>
  );
}
