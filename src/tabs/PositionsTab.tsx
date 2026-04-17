import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BellCurveChart } from '../components/BellCurveChart';
import { EmptyState } from '../components/EmptyState';
import { PerformanceChart, type ChartSeries } from '../components/PerformanceChart';
import type { ChartProjection } from '../components/PerformanceChart';
import {
  addAssumptionToThesis,
  addTradeToThesis,
  type AssumptionStatus,
  type ThesisSnapshot,
  type ThesisTimelineEvent,
  type TradeSide
} from '../db';
import {
  fetchMarketDataCandles,
  fetchMarketDataQuote,
  type MarketCandlesResult,
  type MarketQuoteResult
} from '../lib/market';
import { getCached, setCached, invalidatePrefix } from '../lib/marketCache';
import {
  formatCurrency,
  formatPercent,
  formatQuantity,
  normalPercentile,
  normalizeSymbol,
  thesisDistributionAtTime
} from '../lib/utils';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch candles from ~30 days before entry through today for context. */
function candleParamsFromEntry(createdAt: string) {
  const elapsed = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  const context = 30; // days of history before the entry date
  if (elapsed <= 90) {
    return { resolution: '1day', countback: Math.ceil(elapsed) + context };
  }
  return { resolution: '1week', countback: Math.ceil((elapsed + context) / 7) + 2 };
}

/** Index of the candle closest to a given unix-second timestamp. */
function closestCandleIndex(candles: { time: number }[], targetTime: number): number {
  let best = 0;
  let bestDiff = Infinity;
  candles.forEach((c, i) => {
    const d = Math.abs(c.time - targetTime);
    if (d < bestDiff) { bestDiff = d; best = i; }
  });
  return best;
}

function ordinalSuffix(n: number) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

// ── Timeline helpers ──────────────────────────────────────────────────────────

function summarizeTimeline(event: ThesisTimelineEvent) {
  if (event.kind === 'thesis') {
    return {
      tag: 'thesis',
      text: event.thesis.summary,
      meta: event.thesis.invalidation ? `breaks if ${event.thesis.invalidation}` : `${event.thesis.symbol} started`
    };
  }
  if (event.kind === 'trade') {
    return {
      tag: event.trade.side,
      text: `${event.trade.side} ${formatQuantity(event.trade.quantity)} @ ${formatCurrency(event.trade.price)}`,
      meta: event.trade.notes?.trim() || `${event.trade.symbol} fill`
    };
  }
  if (event.kind === 'assumption') {
    return { tag: event.assumption.status, text: event.assumption.statement, meta: 'assumption' };
  }
  return { tag: event.review.kind, text: event.review.summary, meta: 'review' };
}

function RelativeTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>;
}

// ── Distribution section (time-evolving bell curve) ──────────────────────────

function DistributionSection({
  destination, durationDays, errorBand, elapsedDays, currentReturn
}: {
  destination: number; durationDays: number; errorBand: number;
  elapsedDays: number; currentReturn: number | null;
}) {
  const { mean, std } = thesisDistributionAtTime(
    destination, durationDays, errorBand, elapsedDays
  );
  const percentile = currentReturn !== null ? normalPercentile(currentReturn, mean, std) : null;

  return (
    <div className="distribution-section">
      <div className="distribution-section__header">
        <span className="subtle">Distribution now</span>
        {percentile !== null ? (
          <span className="distribution-section__pct">
            {percentile}{ordinalSuffix(percentile)} percentile
          </span>
        ) : null}
      </div>
      <BellCurveChart
        mean={mean}
        std={std}
        destination={destination}
        current={currentReturn ?? undefined}
      />
    </div>
  );
}

// ── Individual position card ──────────────────────────────────────────────────

interface PositionCardProps {
  snapshot: ThesisSnapshot;
  isExpanded: boolean;
  onToggle: () => void;
  marketApiKey: string;
  benchmarkCurrentPrice: number | null;
  onRefresh: (nextId?: string | null) => Promise<void>;
}

interface MarketPane {
  quote: MarketQuoteResult | null;
  candles: MarketCandlesResult | null;
  benchmarkCandles: MarketCandlesResult | null;
  busy: boolean;
  benchmarkBusy: boolean;
  status: string;
}

interface TradeFormState { side: TradeSide; quantity: string; price: string; note: string; }
interface NoteFormState { statement: string; status: AssumptionStatus; }

function defaultTrade(): TradeFormState { return { side: 'buy', quantity: '', price: '', note: '' }; }
function defaultNote(): NoteFormState { return { statement: '', status: 'holding' }; }

function PositionCard({
  snapshot,
  isExpanded,
  onToggle,
  marketApiKey,
  benchmarkCurrentPrice,
  onRefresh
}: PositionCardProps) {
  const { thesis, assumptions, timeline, metrics } = snapshot;

  const [market, setMarket] = useState<MarketPane>({
    quote: null, candles: null, benchmarkCandles: null,
    busy: false, benchmarkBusy: false, status: ''
  });
  const [composerMode, setComposerMode] = useState<'trade' | 'note' | null>(null);
  const [tradeForm, setTradeForm] = useState<TradeFormState>(defaultTrade());
  const [noteForm, setNoteForm] = useState<NoteFormState>(defaultNote());
  const [formBusy, setFormBusy] = useState(false);
  const [formStatus, setFormStatus] = useState('');

  const loadedFor = useRef<string | null>(null);
  const benchmarkLoadedFor = useRef<string | null>(null);

  // ── Load stock market data when expanded ──────────────────────────────────

  useEffect(() => {
    if (!isExpanded) return;
    const symbol = normalizeSymbol(thesis.symbol);
    if (loadedFor.current === symbol) return;
    loadedFor.current = symbol;

    if (!marketApiKey.trim()) {
      setMarket((p) => ({
        ...p, quote: null, candles: null, busy: false,
        status: 'Add a Twelve Data key in Settings for live prices.'
      }));
      return;
    }

    const { resolution, countback } = candleParamsFromEntry(thesis.createdAt);
    const quoteKey = `quote:${symbol}`;
    const candleKey = `candles:${symbol}:${resolution}:entry`;

    const cachedQuote = getCached<MarketQuoteResult>(quoteKey);
    const cachedCandles = getCached<MarketCandlesResult>(candleKey);

    if (cachedQuote && cachedCandles) {
      const status =
        cachedQuote.ok && cachedCandles.ok ? ''
          : cachedCandles.ok ? 'Chart loaded. Quote unavailable.'
            : cachedQuote.ok ? 'Price loaded. Candles unavailable.'
              : cachedQuote.error ?? cachedCandles.error ?? 'Market data unavailable.';
      setMarket((p) => ({ ...p, quote: cachedQuote, candles: cachedCandles, busy: false, status }));
      return;
    }

    setMarket((p) => ({ ...p, busy: true, status: '' }));

    Promise.all([
      fetchMarketDataQuote({ symbol, token: marketApiKey }),
      fetchMarketDataCandles({ symbol, token: marketApiKey, resolution, countback })
    ]).then(([quote, candles]) => {
      setCached(quoteKey, quote);
      setCached(candleKey, candles);
      const status =
        quote.ok && candles.ok ? ''
          : candles.ok ? 'Chart loaded. Quote unavailable.'
            : quote.ok ? 'Price loaded. Candles unavailable.'
              : quote.error ?? candles.error ?? 'Market data unavailable.';
      setMarket((p) => ({ ...p, quote, candles, busy: false, status }));
    });
  }, [isExpanded, thesis.symbol, thesis.createdAt, marketApiKey]);

  // ── Load benchmark when expanded ─────────────────────────────────────────

  useEffect(() => {
    if (!isExpanded) return;
    const bmSymbol = normalizeSymbol(thesis.benchmarkSymbol) || 'QQQ';
    const loadKey = `${thesis.symbol}-${thesis.createdAt}-${bmSymbol}`;
    if (benchmarkLoadedFor.current === loadKey) return;
    if (!marketApiKey.trim()) return;
    benchmarkLoadedFor.current = loadKey;

    const { resolution, countback } = candleParamsFromEntry(thesis.createdAt);
    const cacheKey = `candles:${bmSymbol}:${resolution}:entry`;

    const cached = getCached<MarketCandlesResult>(cacheKey);
    if (cached) {
      setMarket((p) => ({ ...p, benchmarkCandles: cached, benchmarkBusy: false }));
      return;
    }

    setMarket((p) => ({ ...p, benchmarkBusy: true }));

    fetchMarketDataCandles({ symbol: bmSymbol, token: marketApiKey, resolution, countback })
      .then((candles) => {
        setCached(cacheKey, candles);
        setMarket((p) => ({ ...p, benchmarkCandles: candles, benchmarkBusy: false }));
      });
  }, [isExpanded, thesis.symbol, thesis.createdAt, thesis.benchmarkSymbol, marketApiKey]);

  // ── Derived values ────────────────────────────────────────────────────────

  const stockCandles = market.candles?.candles ?? [];

  const stockValues = useMemo(
    () => stockCandles.map((c) => c.close),
    [market.candles]
  );

  const stockTimestamps = useMemo(
    () => stockCandles.map((c) => c.time),
    [market.candles]
  );

  const benchmarkValues = useMemo(
    () => market.benchmarkCandles?.candles.map((c) => c.close) ?? [],
    [market.benchmarkCandles]
  );

  // Candle closest to thesis creation date — this is the true entry price
  const entryUnixSec = useMemo(
    () => Math.floor(new Date(thesis.createdAt).getTime() / 1000),
    [thesis.createdAt]
  );

  const entryIndex = useMemo(
    () => stockCandles.length ? closestCandleIndex(stockCandles, entryUnixSec) : 0,
    [stockCandles, entryUnixSec]
  );

  const qqqEntryIndex = useMemo(
    () => market.benchmarkCandles?.candles.length
      ? closestCandleIndex(market.benchmarkCandles.candles, entryUnixSec)
      : 0,
    [market.benchmarkCandles, entryUnixSec]
  );

  const entryPrice = stockValues[entryIndex] ?? null;
  const entryTimestamp = stockCandles[entryIndex]?.time ?? null;
  const lastPrice = market.quote?.last ?? stockValues[stockValues.length - 1] ?? null;

  // Since-entry return — anchored to entry candle, not first candle
  const sinceEntryReturn =
    entryPrice && lastPrice ? (lastPrice - entryPrice) / entryPrice : null;

  // QQQ since-entry return anchored to same date
  const qqqEntryPrice = benchmarkValues[qqqEntryIndex] ?? null;
  const qqqLastPrice = benchmarkValues[benchmarkValues.length - 1] ?? null;
  const qqqReturn =
    qqqEntryPrice && qqqLastPrice ? (qqqLastPrice - qqqEntryPrice) / qqqEntryPrice : null;

  // Alpha vs QQQ when in indexed mode (preferred), else vs stored benchmark entry
  const alpha = useMemo(() => {
    if (sinceEntryReturn !== null && qqqReturn !== null) {
      return sinceEntryReturn - qqqReturn;
    }
    if (sinceEntryReturn !== null && thesis.benchmarkEntryPrice && benchmarkCurrentPrice !== null) {
      const storedBenchReturn =
        (benchmarkCurrentPrice - thesis.benchmarkEntryPrice) / thesis.benchmarkEntryPrice;
      return sinceEntryReturn - storedBenchReturn;
    }
    return null;
  }, [sinceEntryReturn, qqqReturn, thesis.benchmarkEntryPrice, benchmarkCurrentPrice]);

  const hasDistribution =
    typeof thesis.destination === 'number' &&
    typeof thesis.durationDays === 'number' &&
    typeof thesis.errorBand === 'number';

  // ── Collapsed view stats (trade-based, no live data needed) ──────────────
  // Use oldest buy trade as the entry reference so avg daily is since first fill

  const firstBuyTrade = useMemo(
    () =>
      [...snapshot.trades]
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
        .find((t) => t.side === 'buy') ?? null,
    [snapshot.trades]
  );

  const lastLoggedPrice = snapshot.trades[0]?.price ?? null;
  const daysElapsed = Math.max(1, (Date.now() - new Date(thesis.createdAt).getTime()) / 86_400_000);

  // Return since first fill (trade data only, no live price)
  const tradeBasedReturn =
    firstBuyTrade && lastLoggedPrice !== null
      ? (lastLoggedPrice - firstBuyTrade.price) / firstBuyTrade.price
      : null;

  const avgDailyReturn = tradeBasedReturn !== null ? tradeBasedReturn / daysElapsed : null;

  const collapsedPercentile = useMemo(() => {
    if (!hasDistribution || tradeBasedReturn === null) return null;
    const { mean, std } = thesisDistributionAtTime(
      thesis.destination!, thesis.durationDays!, thesis.errorBand!, daysElapsed
    );
    return normalPercentile(tradeBasedReturn, mean, std);
  }, [hasDistribution, tradeBasedReturn, thesis, daysElapsed]);

  // ── Forms ─────────────────────────────────────────────────────────────────

  async function handleLogTrade(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormBusy(true);
    setFormStatus('');
    try {
      const qty = Number(tradeForm.quantity);
      const price = Number(tradeForm.price);
      if (!(qty > 0) || !(price > 0)) throw new Error('Quantity and price are required.');
      await addTradeToThesis({
        thesisId: thesis.id, side: tradeForm.side,
        quantity: qty, price, fees: 0,
        occurredAt: new Date().toISOString(), notes: tradeForm.note
      });
      loadedFor.current = null;
      benchmarkLoadedFor.current = null;
      invalidatePrefix(`quote:${normalizeSymbol(thesis.symbol)}`);
      invalidatePrefix(`candles:${normalizeSymbol(thesis.symbol)}`);
      await onRefresh(thesis.id);
      setTradeForm(defaultTrade());
      setComposerMode(null);
      setFormStatus('Trade logged.');
    } catch (err) {
      setFormStatus(err instanceof Error ? err.message : 'Could not log trade.');
    } finally {
      setFormBusy(false);
    }
  }

  async function handleLogNote(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormBusy(true);
    setFormStatus('');
    try {
      if (!noteForm.statement.trim()) throw new Error('Note is required.');
      await addAssumptionToThesis({
        thesisId: thesis.id, statement: noteForm.statement,
        status: noteForm.status, weight: 7
      });
      await onRefresh(thesis.id);
      setNoteForm(defaultNote());
      setComposerMode(null);
      setFormStatus('Note saved.');
    } catch (err) {
      setFormStatus(err instanceof Error ? err.message : 'Could not save note.');
    } finally {
      setFormBusy(false);
    }
  }

  // ── Chart series — both in % return from entry (0 = entry point) ─────────

  const chartSeries = useMemo(() => {
    if (stockValues.length < 2 || !entryPrice) return [];
    const stockPct = stockValues.map((v) => (v / entryPrice - 1) * 100);
    const series: ChartSeries[] = [
      { label: thesis.symbol, values: stockPct, colorClass: 'teal', baseIndex: entryIndex }
    ];
    if (benchmarkValues.length >= 2 && qqqEntryPrice) {
      const bmPct = benchmarkValues.map((v) => (v / qqqEntryPrice - 1) * 100);
      const bmSymbol = normalizeSymbol(thesis.benchmarkSymbol) || 'QQQ';
      series.push({ label: bmSymbol, values: bmPct, colorClass: 'blue', baseIndex: qqqEntryIndex });
    }
    return series;
  }, [stockValues, benchmarkValues, entryPrice, qqqEntryPrice, entryIndex, qqqEntryIndex, thesis.symbol, thesis.benchmarkSymbol]);

  // ── Forward projection in % return from entry ─────────────────────────────
  // First point anchors to the stock's actual current %, then fans to maturity distribution.

  const projectionData = useMemo(() => {
    if (!hasDistribution || !entryPrice || stockCandles.length < 2) return undefined;
    const entryTs = Math.floor(new Date(thesis.createdAt).getTime() / 1000);
    const endTs = entryTs + thesis.durationDays! * 86_400;
    const nowTs = stockCandles[stockCandles.length - 1].time;
    if (endTs <= nowTs) return undefined;

    const currentPct = sinceEntryReturn !== null ? sinceEntryReturn * 100 : 0;

    // At maturity: thesis distribution in % from entry
    const matureMean = thesis.destination! * 100;
    const matureStd = thesis.errorBand! * 100;
    const matureQ1 = matureMean - 0.6745 * matureStd;
    const matureQ3 = matureMean + 0.6745 * matureStd;

    // At today: time-evolved distribution std for fan width
    const elapsedNow = (nowTs - entryTs) / 86_400;
    const { std: stdNow } = thesisDistributionAtTime(
      thesis.destination!, thesis.durationDays!, thesis.errorBand!, elapsedNow
    );
    const stdNowPct = stdNow * 100;

    const STEPS = 20;
    const timestamps: number[] = [];
    const median: number[] = [];
    const q1: number[] = [];
    const q3: number[] = [];

    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const ts = nowTs + t * (endTs - nowTs);
      // Linearly interpolate median from currentPct → matureMean
      const med = currentPct + t * (matureMean - currentPct);
      // Linearly interpolate std width from stdNowPct → matureStd
      const halfWidth = 0.6745 * (stdNowPct + t * (matureStd - stdNowPct));
      timestamps.push(ts);
      median.push(med);
      q1.push(med - halfWidth + t * (matureQ1 - matureMean));
      q3.push(med + halfWidth + t * (matureQ3 - matureMean));
    }
    return { timestamps, median, q1, q3 };
  }, [hasDistribution, entryPrice, sinceEntryReturn, stockCandles, thesis]);

  const returnPositive = typeof avgDailyReturn === 'number' && avgDailyReturn >= 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <article className={`position-card${isExpanded ? ' position-card--expanded' : ''}`}>
      {/* Collapsed header — always visible */}
      <button className="position-card__header" type="button" onClick={onToggle}>
        {/* Row 1: symbol + direction | metric */}
        <div className="position-card__title-row">
          <div className="position-card__name">
            <span className="position-card__symbol">{thesis.symbol}</span>
            <span className={`direction-badge direction-badge--${thesis.direction}`}>
              {thesis.direction === 'long' ? '↑' : '↓'}
            </span>
          </div>
          <div className="position-card__header-right">
            {avgDailyReturn !== null ? (
              <span className={`position-card__return${returnPositive ? ' color-up' : ' color-down'}`}>
                {avgDailyReturn >= 0 ? '+' : ''}{(avgDailyReturn * 100).toFixed(2)}%/d
              </span>
            ) : null}
            <span className="position-card__chevron">{isExpanded ? '▴' : '▾'}</span>
          </div>
        </div>

        {/* Row 2: date + percentile badge */}
        <div className="position-card__date-row">
          <span className="position-card__date">{formatShortDate(thesis.createdAt)}</span>
          {collapsedPercentile !== null ? (
            <span className="position-card__pct-badge">
              {collapsedPercentile}{ordinalSuffix(collapsedPercentile)} pct
            </span>
          ) : null}
          {alpha !== null ? (
            <span className={`position-card__alpha${alpha >= 0 ? ' color-up' : ' color-down'}`}>
              {alpha >= 0 ? '+' : ''}{formatPercent(alpha)} vs {thesis.benchmarkSymbol}
            </span>
          ) : null}
        </div>

        {/* Row 3: thesis snippet */}
        <p className="position-card__snippet">{thesis.summary}</p>

        {/* Row 4: conviction bar */}
        <div className="position-card__meta-row">
          <div className="position-card__conviction-mini">
            <div className="conviction-mini-track">
              <div className="conviction-mini-fill" style={{ width: `${thesis.conviction}%` }} />
            </div>
            <span>{thesis.conviction}%</span>
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {isExpanded ? (
        <div className="position-card__detail">
          {/* Price + since-entry return */}
          <div className="position-detail__price-row">
            <div>
              <strong className="position-detail__price">{formatCurrency(lastPrice)}</strong>
              {entryPrice ? (
                <span className="position-detail__entry">entry {formatCurrency(entryPrice)}</span>
              ) : null}
            </div>
            <div className="position-detail__pills">
              <div className={`delta-pill${typeof sinceEntryReturn === 'number' && sinceEntryReturn < 0 ? ' delta-pill--down' : ''}`}>
                {sinceEntryReturn !== null
                  ? `${sinceEntryReturn >= 0 ? '+' : ''}${formatPercent(sinceEntryReturn)} since entry`
                  : 'n/a'}
              </div>
              {alpha !== null ? (
                <div className={`alpha-pill${alpha < 0 ? ' alpha-pill--under' : ' alpha-pill--over'}`}>
                  {alpha >= 0 ? '+' : ''}{formatPercent(alpha)} vs {normalizeSymbol(thesis.benchmarkSymbol) || 'QQQ'}
                </div>
              ) : null}
            </div>
          </div>

          {/* Chart */}
          {(market.busy || market.benchmarkBusy) ? (
            <p className="status-line">Loading…</p>
          ) : chartSeries.length > 0 ? (
            <>
              <PerformanceChart
                series={chartSeries}
                timestamps={stockTimestamps.length >= 2 ? stockTimestamps : undefined}
                indexed={false}
                baseline={0}
                entryTimestamp={entryTimestamp ?? undefined}
                projection={projectionData}
              />
              <div className="chart-legend">
                <span className="chart-legend__item chart-legend__item--teal">
                  ── {thesis.symbol}
                </span>
                {benchmarkValues.length >= 2 ? (
                  <span className="chart-legend__item chart-legend__item--blue">
                    ── {normalizeSymbol(thesis.benchmarkSymbol) || 'QQQ'}
                  </span>
                ) : null}
                {hasDistribution ? (
                  <span className="chart-legend__item chart-legend__item--proj">
                    ░ projection
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <div className="chart-empty">
              {marketApiKey.trim() ? 'No chart data available.' : 'Add a Twelve Data key in Settings.'}
            </div>
          )}

          {/* Distribution */}
          {hasDistribution ? (
            <DistributionSection
              destination={thesis.destination!}
              durationDays={thesis.durationDays!}
              errorBand={thesis.errorBand!}
              elapsedDays={daysElapsed}
              currentReturn={sinceEntryReturn}
            />
          ) : null}

          {/* Metrics grid */}
          <div className="metric-grid">
            <div className="metric-tile">
              <span>Open</span>
              <strong>{formatQuantity(metrics.openQuantity)}</strong>
            </div>
            <div className="metric-tile">
              <span>Avg</span>
              <strong>{formatCurrency(metrics.averageBuyPrice)}</strong>
            </div>
            <div className="metric-tile">
              <span>Value</span>
              <strong>
                {formatCurrency(lastPrice && metrics.openQuantity ? lastPrice * metrics.openQuantity : null)}
              </strong>
            </div>
          </div>

          {market.status ? <p className="status-line">{market.status}</p> : null}

          {/* Quick actions */}
          <div className="action-row">
            <button
              className={`segment${composerMode === 'trade' ? ' segment--active' : ''}`}
              type="button"
              onClick={() => setComposerMode(composerMode === 'trade' ? null : 'trade')}
            >
              Log trade
            </button>
            <button
              className={`segment${composerMode === 'note' ? ' segment--active' : ''}`}
              type="button"
              onClick={() => setComposerMode(composerMode === 'note' ? null : 'note')}
            >
              Add note
            </button>
          </div>

          {composerMode === 'trade' ? (
            <form className="card form-card" onSubmit={handleLogTrade}>
              <div className="segmented">
                {(['buy', 'sell'] as TradeSide[]).map((side) => (
                  <button
                    key={side}
                    className={`segment${tradeForm.side === side ? ' segment--active' : ''}`}
                    type="button"
                    onClick={() => setTradeForm((p) => ({ ...p, side }))}
                  >{side}</button>
                ))}
              </div>
              <div className="field-grid">
                <label className="field">
                  <span>Qty</span>
                  <input inputMode="decimal" value={tradeForm.quantity}
                    onChange={(e) => setTradeForm((p) => ({ ...p, quantity: e.target.value }))}
                    placeholder="5" />
                </label>
                <label className="field">
                  <span>Price</span>
                  <input inputMode="decimal" value={tradeForm.price}
                    onChange={(e) => setTradeForm((p) => ({ ...p, price: e.target.value }))}
                    placeholder="185.50" />
                </label>
              </div>
              <details className="drawer">
                <summary>Optional note</summary>
                <label className="field field--inside">
                  <textarea value={tradeForm.note}
                    onChange={(e) => setTradeForm((p) => ({ ...p, note: e.target.value }))}
                    placeholder="Execution context" />
                </label>
              </details>
              <button className="button button--primary" type="submit" disabled={formBusy}>Log trade</button>
            </form>
          ) : null}

          {composerMode === 'note' ? (
            <form className="card form-card" onSubmit={handleLogNote}>
              <label className="field">
                <span>Note</span>
                <textarea value={noteForm.statement}
                  onChange={(e) => setNoteForm((p) => ({ ...p, statement: e.target.value }))}
                  placeholder="What changed?" />
              </label>
              <div className="status-strip">
                {(['holding', 'weaker', 'broken'] as AssumptionStatus[]).map((s) => (
                  <button
                    key={s}
                    className={`chip${noteForm.status === s ? ' chip--active' : ''}`}
                    type="button"
                    onClick={() => setNoteForm((p) => ({ ...p, status: s }))}
                  >{s}</button>
                ))}
              </div>
              <button className="button button--primary" type="submit" disabled={formBusy}>Save note</button>
            </form>
          ) : null}

          {formStatus ? <p className="status-line">{formStatus}</p> : null}

          {/* Thesis text */}
          <div className="position-detail__section">
            <span className="eyebrow">Thesis</span>
            <p className="thesis-copy">{thesis.summary}</p>
            {thesis.invalidation ? (
              <p className="subtle-copy">Breaks if {thesis.invalidation}</p>
            ) : null}
          </div>

          {/* Assumptions */}
          {assumptions.length > 0 ? (
            <div className="position-detail__section">
              <span className="eyebrow">Assumptions</span>
              <div className="assumption-list">
                {assumptions.map((a) => (
                  <div key={a.id} className="assumption-row">
                    <span className={`tag tag--${a.status}`}>{a.status}</span>
                    <p>{a.statement}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Timeline */}
          <div className="position-detail__section">
            <span className="eyebrow">Timeline</span>
            <ul className="timeline">
              {timeline.map((event) => {
                const s = summarizeTimeline(event);
                return (
                  <li key={event.id} className="timeline-item">
                    <div className={`tag tag--${s.tag}`}>{s.tag}</div>
                    <div className="timeline-copy">
                      <p>{s.text}</p>
                      <span>{s.meta}</span>
                    </div>
                    <span className="timeline-time">
                      <RelativeTime value={event.occurredAt} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </article>
  );
}

// ── Positions tab ─────────────────────────────────────────────────────────────

interface PositionsTabProps {
  snapshots: ThesisSnapshot[];
  selectedId: string | null;
  onSelectId: (id: string) => void;
  marketApiKey: string;
  onNavigateToNew: () => void;
  onRefresh: (nextId?: string | null) => Promise<void>;
  benchmarkCurrentPrice: number | null;
}

export function PositionsTab({
  snapshots,
  selectedId,
  onSelectId,
  marketApiKey,
  onNavigateToNew,
  onRefresh,
  benchmarkCurrentPrice
}: PositionsTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(selectedId);

  useEffect(() => {
    if (selectedId && expandedId === null) {
      setExpandedId(selectedId);
    }
  }, [selectedId]);

  function handleToggle(id: string) {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (next) onSelectId(next);
  }

  if (snapshots.length === 0) {
    return (
      <EmptyState
        title="No positions yet"
        copy="Start with one clean thesis and one real fill."
        actionLabel="Create thesis"
        onAction={onNavigateToNew}
      />
    );
  }

  return (
    <section className="screen">
      {snapshots.map((snapshot) => (
        <PositionCard
          key={snapshot.thesis.id}
          snapshot={snapshot}
          isExpanded={expandedId === snapshot.thesis.id}
          onToggle={() => handleToggle(snapshot.thesis.id)}
          marketApiKey={marketApiKey}
          benchmarkCurrentPrice={benchmarkCurrentPrice}
          onRefresh={onRefresh}
        />
      ))}
    </section>
  );
}
