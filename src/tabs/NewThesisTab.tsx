import { useState, useEffect, type FormEvent } from 'react';
import { BellCurveChart } from '../components/BellCurveChart';
import { ThesisProjectionChart } from '../components/ThesisProjectionChart';
import { SymbolSearch } from '../components/SymbolSearch';
import {
  createThesisEntry,
  type TradeSide
} from '../db';
import { fetchMarketDataQuote, fetchMarketDataCandles } from '../lib/market';
import { getCached, setCached } from '../lib/marketCache';
import type { MarketQuoteResult, MarketCandlesResult } from '../lib/market';
import type { ResearchIdentity } from '../lib/research';
import { normalizeSymbol } from '../lib/utils';

interface NewThesisTabProps {
  marketApiKey: string;
  onSaved: (thesisId: string) => void;
}

interface ThesisFormState {
  symbolInput: string;
  symbol: string;
  errorBand: number;      // 5–50 integer percent: std dev at maturity
  thesis: string;
  invalidation: string;
  destination: string;    // integer % input, e.g. "25" → stored as 0.25
  durationDays: string;   // days as string for controlled input
  benchmarkSymbol: string;
  fillSide: TradeSide;
  fillQty: string;
  fillPrice: string;
  fillNote: string;
}

function defaultForm(): ThesisFormState {
  return {
    symbolInput: '',
    symbol: '',
    errorBand: 15,
    thesis: '',
    invalidation: '',
    destination: '',
    durationDays: '365',
    benchmarkSymbol: 'QQQ',
    fillSide: 'buy',
    fillQty: '',
    fillPrice: '',
    fillNote: ''
  };
}

export function NewThesisTab({ marketApiKey, onSaved }: NewThesisTabProps) {
  const [form, setForm] = useState<ThesisFormState>(defaultForm());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [historicalAlpha, setHistoricalAlpha] = useState<number[] | null>(null);
  const [histStatus, setHistStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');

  // Fetch 90-day daily candles for symbol + benchmark to show historical alpha
  useEffect(() => {
    const symbol = normalizeSymbol(form.symbol);
    const bmSymbol = normalizeSymbol(form.benchmarkSymbol) || 'QQQ';
    if (!symbol) { setHistoricalAlpha(null); setHistStatus('idle'); return; }
    if (!marketApiKey.trim()) { setHistoricalAlpha(null); setHistStatus('idle'); return; }

    let cancelled = false;
    setHistStatus('loading');
    const stockKey = `candles:${symbol}:1day:preview`;
    const bmKey    = `candles:${bmSymbol}:1day:preview`;

    async function load() {
      try {
        let stockRes = getCached<MarketCandlesResult>(stockKey);
        if (!stockRes) {
          stockRes = await fetchMarketDataCandles({ symbol, token: marketApiKey, resolution: '1day', countback: 90 });
          if (stockRes.ok) setCached(stockKey, stockRes);
        }
        let bmRes = getCached<MarketCandlesResult>(bmKey);
        if (!bmRes) {
          bmRes = await fetchMarketDataCandles({ symbol: bmSymbol, token: marketApiKey, resolution: '1day', countback: 90 });
          if (bmRes.ok) setCached(bmKey, bmRes);
        }
        if (cancelled) return;
        if (!stockRes.ok || !bmRes.ok) { setHistStatus('error'); return; }
        const len = Math.min(stockRes.candles.length, bmRes.candles.length);
        if (len < 2) { setHistStatus('error'); return; }
        const sBase = stockRes.candles[0].close;
        const bBase = bmRes.candles[0].close;
        setHistoricalAlpha(
          Array.from({ length: len }, (_, i) =>
            (stockRes!.candles[i].close / sBase - 1) * 100 -
            (bmRes!.candles[i].close  / bBase - 1) * 100
          )
        );
        setHistStatus('ok');
      } catch {
        if (!cancelled) setHistStatus('error');
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [form.symbol, form.benchmarkSymbol, marketApiKey]);

  function patch(next: Partial<ThesisFormState>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  function handleSymbolSelect(identity: ResearchIdentity) {
    setHistoricalAlpha(null);
    patch({
      symbol: identity.symbol,
      symbolInput: identity.instrumentName || identity.symbol
    });
  }

  // Bell curve at maturity: mean = destination, std = errorBand
  const destDecimal = form.destination.trim() ? Number(form.destination) / 100 : null;
  const bellMean = destDecimal ?? 0;
  const bellStd = form.errorBand / 100;
  const showBell = destDecimal !== null && !isNaN(destDecimal);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const symbol = normalizeSymbol(form.symbol || form.symbolInput);
    const thesis = form.thesis.trim();
    const benchmark = normalizeSymbol(form.benchmarkSymbol) || 'QQQ';

    if (!symbol) {
      setStatus('Search and select a symbol first.');
      return;
    }
    if (!thesis) {
      setStatus('Thesis is required.');
      return;
    }

    const destination = form.destination.trim() ? Number(form.destination) / 100 : undefined;
    if (form.destination.trim() && (isNaN(destination!) || destination! <= -1)) {
      setStatus('Destination must be a number like 40 for +40% or -20 for -20%.');
      return;
    }

    setBusy(true);
    setStatus('');

    try {
      // Fetch benchmark entry price
      let benchmarkEntryPrice: number | undefined;
      if (marketApiKey.trim()) {
        const cacheKey = `quote:${benchmark}`;
        let quote = getCached<MarketQuoteResult>(cacheKey);
        if (!quote) {
          quote = await fetchMarketDataQuote({ symbol: benchmark, token: marketApiKey });
          if (quote.ok) setCached(cacheKey, quote);
        }
        if (quote?.ok && quote.last !== null) {
          benchmarkEntryPrice = quote.last;
        }
      }

      // Optional first fill
      let initialTrade: Parameters<typeof createThesisEntry>[0]['initialTrade'];
      const hasQty = form.fillQty.trim();
      const hasPrice = form.fillPrice.trim();
      if (hasQty || hasPrice) {
        const qty = Number(form.fillQty);
        const price = Number(form.fillPrice);
        if (!(qty > 0) || !(price > 0)) {
          throw new Error('First fill needs both a valid quantity and price.');
        }
        initialTrade = {
          side: form.fillSide,
          quantity: qty,
          price,
          fees: 0,
          occurredAt: new Date().toISOString(),
          notes: form.fillNote.trim() || undefined
        };
      }

      const thesisId = await createThesisEntry({
        symbol,
        summary: thesis,
        direction: destination !== undefined && destination < 0 ? 'short' : 'long',
        conviction: 100,
        invalidation: form.invalidation.trim() || undefined,
        destination,
        durationDays: destination !== undefined ? (Number(form.durationDays) || 365) : undefined,
        errorBand: destination !== undefined ? form.errorBand / 100 : undefined,
        benchmarkSymbol: benchmark,
        benchmarkEntryPrice,
        initialTrade
      });

      setForm(defaultForm());
      onSaved(thesisId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save thesis.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen">
      <form className="card form-card" onSubmit={handleSubmit}>

        {/* Symbol */}
        <div className="field">
          <span>Symbol</span>
          <SymbolSearch
            value={form.symbolInput}
            onChange={(v) => patch({ symbolInput: v, symbol: '' })}
            onSelect={handleSymbolSelect}
            marketApiKey={marketApiKey}
            inline
            placeholder="Search ticker or company"
          />
          {form.symbol ? (
            <div className="context-pill" style={{ width: 'fit-content' }}>{form.symbol}</div>
          ) : null}
        </div>

        {/* Thesis */}
        <label className="field">
          <span>Thesis</span>
          <textarea
            value={form.thesis}
            onChange={(e) => patch({ thesis: e.target.value })}
            placeholder="Why is this worth owning?"
          />
        </label>

        {/* ── Goal section ─────────────────────────────────────────────────── */}
        <div className="field goal-section">
          <span className="field-label">Goal</span>

          {/* Target return + Duration row */}
          <div className="goal-row">
            <label className="goal-dest">
              <span>Target %</span>
              <input
                inputMode="decimal"
                value={form.destination}
                onChange={(e) => patch({ destination: e.target.value })}
                placeholder="e.g. 25"
                className="dest-input"
              />
            </label>
            <label className="goal-duration">
              <span>By (days)</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={form.durationDays}
                onChange={(e) => patch({ durationDays: e.target.value })}
                className="duration-number-input"
              />
            </label>
          </div>

          {/* Uncertainty slider */}
          <div className="slider-row">
            <div className="slider-header">
              <span>Uncertainty</span>
              <span className="slider-value">±{form.errorBand}% std dev at maturity</span>
            </div>
            <input
              type="range"
              className="thesis-slider"
              min={5}
              max={50}
              step={5}
              value={form.errorBand}
              onChange={(e) => patch({ errorBand: Number(e.target.value) })}
            />
            <div className="slider-track-labels">
              <span>Tight</span>
              <span>Wide</span>
            </div>
          </div>

          {/* Live bell curve preview */}
          {showBell ? (
            <BellCurveChart
              mean={bellMean}
              std={bellStd}
              destination={destDecimal!}
            />
          ) : (
            <div className="bell-curve-placeholder">
              Enter a target % to preview the distribution
            </div>
          )}

          {/* Forward projection fan (+ historical alpha when available) */}
          {showBell ? (
            <>
              <ThesisProjectionChart
                destination={destDecimal!}
                errorBand={form.errorBand / 100}
                durationDays={Number(form.durationDays) || 365}
                historicalAlpha={historicalAlpha ?? undefined}
              />
              {histStatus === 'loading' ? (
                <p className="hist-status">Loading historical alpha…</p>
              ) : histStatus === 'error' ? (
                <p className="hist-status hist-status--error">Could not load history.</p>
              ) : !form.symbol && !form.symbolInput.trim() ? null : !form.symbol ? (
                <p className="hist-status">Select a symbol to see prior performance.</p>
              ) : null}
            </>
          ) : null}
        </div>

        {/* ── Baseline ticker ───────────────────────────────────────────────── */}
        <label className="field">
          <span>Baseline ticker</span>
          <input
            value={form.benchmarkSymbol}
            onChange={(e) => patch({ benchmarkSymbol: e.target.value.toUpperCase() })}
            placeholder="QQQ"
            className="baseline-input"
          />
          <span className="field-hint">
            Compare against QQQ, SPY, SOXX, XLK, etc.
          </span>
        </label>

        {/* ── Invalidation (optional) ───────────────────────────────────────── */}
        <details className="drawer">
          <summary>Invalidation condition</summary>
          <label className="field">
            <span>Breaks if</span>
            <textarea
              value={form.invalidation}
              onChange={(e) => patch({ invalidation: e.target.value })}
              placeholder="What would prove you wrong?"
            />
          </label>
        </details>

        {/* ── First fill (optional) ─────────────────────────────────────────── */}
        <details className="drawer">
          <summary>First fill</summary>
          <div className="stack">
            <div className="segmented">
              {(['buy', 'sell'] as TradeSide[]).map((side) => (
                <button
                  key={side}
                  className={`segment${form.fillSide === side ? ' segment--active' : ''}`}
                  type="button"
                  onClick={() => patch({ fillSide: side })}
                >
                  {side}
                </button>
              ))}
            </div>
            <div className="field-grid">
              <label className="field">
                <span>Qty</span>
                <input
                  inputMode="decimal"
                  value={form.fillQty}
                  onChange={(e) => patch({ fillQty: e.target.value })}
                  placeholder="5"
                />
              </label>
              <label className="field">
                <span>Price</span>
                <input
                  inputMode="decimal"
                  value={form.fillPrice}
                  onChange={(e) => patch({ fillPrice: e.target.value })}
                  placeholder="185.50"
                />
              </label>
            </div>
            <label className="field">
              <span>Note</span>
              <textarea
                value={form.fillNote}
                onChange={(e) => patch({ fillNote: e.target.value })}
                placeholder="Execution context"
                style={{ minHeight: '4rem' }}
              />
            </label>
          </div>
        </details>

        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save thesis'}
        </button>

        {status ? <p className="status-line">{status}</p> : null}
      </form>
    </section>
  );
}
