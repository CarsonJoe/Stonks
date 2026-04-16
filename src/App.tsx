import { useEffect, useState } from 'react';
import {
  addAssumptionToThesis,
  addReviewToThesis,
  addTradeToThesis,
  createThesisEntry,
  getFoundationCounts,
  getLocalPasskeyCredential,
  getSetting,
  listThesisSnapshots,
  saveLocalPasskeyCredential,
  saveMarketSnapshot,
  seedFoundationEntries,
  setSetting,
  type AssumptionStatus,
  type FoundationCounts,
  type ReviewKind,
  type ThesisSnapshot,
  type ThesisStance,
  type ThesisStatus,
  type ThesisTimelineEvent,
  type TradeSide
} from './db';
import {
  fetchFredObservations,
  fetchMarketDataQuote,
  type ApiProbeResult
} from './lib/market';
import {
  formatBytes,
  getStorageSnapshot,
  requestStoragePersistence,
  type StorageSnapshot
} from './lib/storage';
import {
  authenticateLocalPasskey,
  getWebAuthnSupportSnapshot,
  registerLocalPasskey,
  type LocalPasskeyCredential,
  type WebAuthnSupportSnapshot
} from './lib/webauthn';

interface ThesisFormState {
  symbol: string;
  title: string;
  stance: ThesisStance;
  status: ThesisStatus;
  summary: string;
  invalidation: string;
  timeHorizon: string;
  benchmark: string;
  assumption: string;
  assumptionWeight: string;
  assumptionStatus: AssumptionStatus;
  createTrade: boolean;
  tradeSide: TradeSide;
  quantity: string;
  price: string;
  fees: string;
  occurredAt: string;
  notes: string;
}

interface TradeFormState {
  side: TradeSide;
  quantity: string;
  price: string;
  fees: string;
  occurredAt: string;
  notes: string;
}

interface AssumptionFormState {
  statement: string;
  weight: string;
  status: AssumptionStatus;
}

interface ReviewFormState {
  kind: ReviewKind;
  conviction: string;
  summary: string;
}

const emptyCounts: FoundationCounts = {
  theses: 0,
  assumptions: 0,
  trades: 0,
  reviews: 0,
  marketSnapshots: 0
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2
});

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 4
});

function formatCurrency(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  return currencyFormatter.format(value);
}

function formatQuantity(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  return numberFormatter.format(value);
}

function toLocalDateTimeInput(value = new Date()) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(value: string) {
  return new Date(value).toISOString();
}

function defaultThesisForm(): ThesisFormState {
  return {
    symbol: '',
    title: '',
    stance: 'long',
    status: 'active',
    summary: '',
    invalidation: '',
    timeHorizon: '3-12 months',
    benchmark: 'SPY + CPIAUCSL',
    assumption: '',
    assumptionWeight: '7',
    assumptionStatus: 'holding',
    createTrade: true,
    tradeSide: 'buy',
    quantity: '',
    price: '',
    fees: '0',
    occurredAt: toLocalDateTimeInput(),
    notes: ''
  };
}

function defaultTradeForm(): TradeFormState {
  return {
    side: 'buy',
    quantity: '',
    price: '',
    fees: '0',
    occurredAt: toLocalDateTimeInput(),
    notes: ''
  };
}

function defaultAssumptionForm(): AssumptionFormState {
  return {
    statement: '',
    weight: '7',
    status: 'holding'
  };
}

function defaultReviewForm(): ReviewFormState {
  return {
    kind: 'checkin',
    conviction: '60',
    summary: ''
  };
}

function RelativeTime({ value }: { value: string }) {
  const date = new Date(value);
  return <time dateTime={value}>{date.toLocaleString()}</time>;
}

function Metric({
  label,
  value,
  accent = 'neutral'
}: {
  label: string;
  value: string | number;
  accent?: 'neutral' | 'good' | 'warn';
}) {
  return (
    <div className={`metric metric--${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function timelineSummary(event: ThesisTimelineEvent) {
  if (event.kind === 'thesis') {
    return {
      title: 'Thesis opened',
      body: event.thesis.summary || 'Base thesis record created.',
      meta: `${event.thesis.symbol} · ${event.thesis.stance} · ${event.thesis.status}`
    };
  }

  if (event.kind === 'trade') {
    const gross = event.trade.quantity * event.trade.price;
    return {
      title: `${event.trade.side === 'buy' ? 'Bought' : 'Sold'} ${formatQuantity(
        event.trade.quantity
      )} shares`,
      body:
        event.trade.notes?.trim() ||
        `${formatCurrency(event.trade.price)} per share · gross ${formatCurrency(gross)}`,
      meta: `${event.trade.symbol} · fees ${formatCurrency(event.trade.fees)}`
    };
  }

  if (event.kind === 'assumption') {
    return {
      title: `Assumption logged · ${event.assumption.status}`,
      body: event.assumption.statement,
      meta: `Weight ${event.assumption.weight}/10`
    };
  }

  return {
    title: `Review logged · ${event.review.kind}`,
    body: event.review.summary,
    meta: `Conviction ${event.review.conviction}/100`
  };
}

function ResultPanel({ result }: { result: ApiProbeResult | null }) {
  if (!result) {
    return (
      <div className="result-shell">
        <p className="muted">No request has run yet.</p>
      </div>
    );
  }

  return (
    <div className="result-shell">
      <div className="result-meta">
        <span className={result.ok ? 'pill pill--good' : 'pill pill--warn'}>
          {result.ok ? 'OK' : 'Needs attention'}
        </span>
        <span>{result.source}</span>
        <span>{result.status ?? 'network error'}</span>
        <RelativeTime value={result.requestedAt} />
      </div>
      <p className="tiny muted">{result.requestUrl}</p>
      {result.error ? <p className="warning-text">{result.error}</p> : null}
      <pre>
        {typeof result.preview === 'string'
          ? result.preview
          : JSON.stringify(result.preview, null, 2)}
      </pre>
    </div>
  );
}

export default function App() {
  const [storageSnapshot, setStorageSnapshot] = useState<StorageSnapshot>({
    supported: false
  });
  const [foundationCounts, setFoundationCounts] = useState<FoundationCounts>(emptyCounts);
  const [thesisSnapshots, setThesisSnapshots] = useState<ThesisSnapshot[]>([]);
  const [selectedThesisId, setSelectedThesisId] = useState<string | null>(null);
  const [storageMessage, setStorageMessage] = useState(
    'No local writes have been requested yet.'
  );
  const [composerMessage, setComposerMessage] = useState(
    'This is ready for the first real thesis entry.'
  );
  const [activityMessage, setActivityMessage] = useState(
    'Choose a thesis and log the next trade, assumption, or check-in.'
  );

  const [thesisForm, setThesisForm] = useState<ThesisFormState>(defaultThesisForm());
  const [tradeForm, setTradeForm] = useState<TradeFormState>(defaultTradeForm());
  const [assumptionForm, setAssumptionForm] = useState<AssumptionFormState>(
    defaultAssumptionForm()
  );
  const [reviewForm, setReviewForm] = useState<ReviewFormState>(defaultReviewForm());

  const [composerBusy, setComposerBusy] = useState(false);
  const [activityBusy, setActivityBusy] = useState(false);
  const [storageBusy, setStorageBusy] = useState(false);

  const [marketToken, setMarketToken] = useState('');
  const [marketSymbol, setMarketSymbol] = useState('AAPL');
  const [marketResult, setMarketResult] = useState<ApiProbeResult | null>(null);
  const [marketBusy, setMarketBusy] = useState(false);

  const [fredApiKey, setFredApiKey] = useState('');
  const [fredSeriesId, setFredSeriesId] = useState('CPIAUCSL');
  const [fredResult, setFredResult] = useState<ApiProbeResult | null>(null);
  const [fredBusy, setFredBusy] = useState(false);

  const [webauthnSupport, setWebauthnSupport] = useState<WebAuthnSupportSnapshot>({
    supported: false,
    platformAuthenticator: null,
    conditionalMediation: null,
    clientCapabilities: {}
  });
  const [passkeyRecord, setPasskeyRecord] = useState<LocalPasskeyCredential | null>(null);
  const [passkeyLabel, setPasskeyLabel] = useState('Carson iPhone');
  const [passkeyMessage, setPasskeyMessage] = useState(
    'No passkey action has run yet.'
  );
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [sessionLocked, setSessionLocked] = useState(false);

  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const selectedSnapshot =
    thesisSnapshots.find((snapshot) => snapshot.thesis.id === selectedThesisId) ?? null;

  async function refreshPortfolioState(nextSelectedId?: string | null) {
    const [counts, snapshots, storage] = await Promise.all([
      getFoundationCounts(),
      listThesisSnapshots(),
      getStorageSnapshot()
    ]);

    setFoundationCounts(counts);
    setThesisSnapshots(snapshots);
    setStorageSnapshot(storage);

    if (snapshots.length === 0) {
      setSelectedThesisId(null);
      return;
    }

    const desiredId = nextSelectedId ?? selectedThesisId;
    const matching = desiredId
      ? snapshots.find((snapshot) => snapshot.thesis.id === desiredId)
      : null;

    setSelectedThesisId(matching?.thesis.id ?? snapshots[0].thesis.id);
  }

  async function refreshEnvironmentState() {
    const [
      support,
      savedPasskey,
      savedMarketToken,
      savedFredApiKey,
      savedLockEnabled
    ] = await Promise.all([
      getWebAuthnSupportSnapshot(),
      getLocalPasskeyCredential(),
      getSetting<string>('integrations.marketDataToken'),
      getSetting<string>('integrations.fredApiKey'),
      getSetting<boolean>('security.passkeyGateEnabled')
    ]);

    setWebauthnSupport(support);
    setPasskeyRecord(savedPasskey);
    setMarketToken(savedMarketToken ?? '');
    setFredApiKey(savedFredApiKey ?? '');
    setLockEnabled(Boolean(savedLockEnabled));
    setSessionLocked(Boolean(savedLockEnabled && savedPasskey));
  }

  useEffect(() => {
    void Promise.all([refreshPortfolioState(), refreshEnvironmentState()]);
  }, []);

  useEffect(() => {
    setTradeForm(defaultTradeForm());
    setAssumptionForm(defaultAssumptionForm());
    setReviewForm(defaultReviewForm());
  }, [selectedThesisId]);

  async function handleRequestPersistence() {
    setStorageBusy(true);
    const granted = await requestStoragePersistence();
    const snapshot = await getStorageSnapshot();
    setStorageSnapshot(snapshot);
    setStorageMessage(
      granted
        ? 'Persistent storage was granted for this origin.'
        : 'Persistent storage was not granted or is unavailable.'
    );
    setStorageBusy(false);
  }

  async function handleSeedDemoData() {
    setStorageBusy(true);
    const thesisId = await seedFoundationEntries();
    await refreshPortfolioState(thesisId);
    setStorageMessage('A sample thesis and initial trade were written locally.');
    setStorageBusy(false);
  }

  async function handleCreateThesis(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setComposerBusy(true);

    try {
      const symbol = thesisForm.symbol.trim().toUpperCase();
      const title = thesisForm.title.trim();

      if (!symbol || !title || !thesisForm.summary.trim()) {
        throw new Error('Symbol, title, and thesis summary are required.');
      }

      let initialTrade;
      if (thesisForm.createTrade) {
        const quantity = Number(thesisForm.quantity);
        const price = Number(thesisForm.price);
        const fees = Number(thesisForm.fees || '0');

        if (!(quantity > 0) || !(price > 0) || fees < 0) {
          throw new Error(
            'Initial trade quantity and price must be positive, and fees cannot be negative.'
          );
        }

        initialTrade = {
          side: thesisForm.tradeSide,
          quantity,
          price,
          fees,
          occurredAt: fromLocalDateTimeInput(thesisForm.occurredAt),
          notes: thesisForm.notes
        };
      }

      const thesisId = await createThesisEntry({
        title,
        symbol,
        status: thesisForm.status,
        stance: thesisForm.stance,
        summary: thesisForm.summary,
        invalidation: thesisForm.invalidation,
        timeHorizon: thesisForm.timeHorizon,
        benchmark: thesisForm.benchmark,
        initialAssumption: thesisForm.assumption.trim()
          ? {
              statement: thesisForm.assumption,
              status: thesisForm.assumptionStatus,
              weight: Number(thesisForm.assumptionWeight || '0')
            }
          : undefined,
        initialTrade
      });

      await refreshPortfolioState(thesisId);
      setThesisForm(defaultThesisForm());
      setComposerMessage(
        `Created ${symbol} and selected it for live logging.`
      );
    } catch (error) {
      setComposerMessage(
        error instanceof Error ? error.message : 'The thesis entry failed.'
      );
    } finally {
      setComposerBusy(false);
    }
  }

  async function handleAddTrade(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedSnapshot) {
      return;
    }

    setActivityBusy(true);

    try {
      const quantity = Number(tradeForm.quantity);
      const price = Number(tradeForm.price);
      const fees = Number(tradeForm.fees || '0');

      if (!(quantity > 0) || !(price > 0) || fees < 0) {
        throw new Error('Trade quantity and price must be positive.');
      }

      await addTradeToThesis({
        thesisId: selectedSnapshot.thesis.id,
        side: tradeForm.side,
        quantity,
        price,
        fees,
        occurredAt: fromLocalDateTimeInput(tradeForm.occurredAt),
        notes: tradeForm.notes
      });

      await refreshPortfolioState(selectedSnapshot.thesis.id);
      setTradeForm(defaultTradeForm());
      setActivityMessage(
        `Trade added to ${selectedSnapshot.thesis.symbol}.`
      );
    } catch (error) {
      setActivityMessage(
        error instanceof Error ? error.message : 'Trade logging failed.'
      );
    } finally {
      setActivityBusy(false);
    }
  }

  async function handleAddAssumption(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedSnapshot) {
      return;
    }

    setActivityBusy(true);

    try {
      if (!assumptionForm.statement.trim()) {
        throw new Error('Assumption text is required.');
      }

      const weight = Number(assumptionForm.weight);
      if (!(weight >= 0 && weight <= 10)) {
        throw new Error('Assumption weight must be between 0 and 10.');
      }

      await addAssumptionToThesis({
        thesisId: selectedSnapshot.thesis.id,
        statement: assumptionForm.statement,
        status: assumptionForm.status,
        weight
      });

      await refreshPortfolioState(selectedSnapshot.thesis.id);
      setAssumptionForm(defaultAssumptionForm());
      setActivityMessage(
        `Assumption added to ${selectedSnapshot.thesis.symbol}.`
      );
    } catch (error) {
      setActivityMessage(
        error instanceof Error ? error.message : 'Assumption logging failed.'
      );
    } finally {
      setActivityBusy(false);
    }
  }

  async function handleAddReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedSnapshot) {
      return;
    }

    setActivityBusy(true);

    try {
      if (!reviewForm.summary.trim()) {
        throw new Error('Review summary is required.');
      }

      const conviction = Number(reviewForm.conviction);
      if (!(conviction >= 0 && conviction <= 100)) {
        throw new Error('Conviction must be between 0 and 100.');
      }

      await addReviewToThesis({
        thesisId: selectedSnapshot.thesis.id,
        kind: reviewForm.kind,
        summary: reviewForm.summary,
        conviction
      });

      await refreshPortfolioState(selectedSnapshot.thesis.id);
      setReviewForm(defaultReviewForm());
      setActivityMessage(
        `Check-in added to ${selectedSnapshot.thesis.symbol}.`
      );
    } catch (error) {
      setActivityMessage(
        error instanceof Error ? error.message : 'Review logging failed.'
      );
    } finally {
      setActivityBusy(false);
    }
  }

  async function handleMarketProbe() {
    setMarketBusy(true);
    await setSetting('integrations.marketDataToken', marketToken.trim());
    const result = await fetchMarketDataQuote({
      symbol: marketSymbol,
      token: marketToken
    });
    setMarketResult(result);

    if (result.preview) {
      await saveMarketSnapshot(marketSymbol.trim().toUpperCase(), result.source, result.preview);
      setFoundationCounts(await getFoundationCounts());
    }

    setMarketBusy(false);
  }

  async function handleFredProbe() {
    setFredBusy(true);
    await setSetting('integrations.fredApiKey', fredApiKey.trim());
    const result = await fetchFredObservations({
      seriesId: fredSeriesId,
      apiKey: fredApiKey
    });
    setFredResult(result);

    if (result.preview) {
      await saveMarketSnapshot(fredSeriesId.trim().toUpperCase(), result.source, result.preview);
      setFoundationCounts(await getFoundationCounts());
    }

    setFredBusy(false);
  }

  async function handleRegisterPasskey() {
    setPasskeyBusy(true);

    try {
      const record = await registerLocalPasskey(passkeyLabel);
      await saveLocalPasskeyCredential(record);
      await setSetting('security.passkeyGateEnabled', true);
      setPasskeyRecord(record);
      setLockEnabled(true);
      setSessionLocked(false);
      setPasskeyMessage(
        `Passkey probe registered for ${record.label}. Re-register after moving to a new origin such as GitHub Pages or a custom domain.`
      );
    } catch (error) {
      setPasskeyMessage(
        error instanceof Error ? error.message : 'Passkey registration failed.'
      );
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function handleAuthenticatePasskey() {
    if (!passkeyRecord) {
      return;
    }

    setPasskeyBusy(true);

    try {
      const result = await authenticateLocalPasskey(passkeyRecord);
      setSessionLocked(false);
      setPasskeyMessage(
        `Passkey assertion returned ${result.signatureBytes} signature bytes at ${new Date(
          result.verifiedAt
        ).toLocaleTimeString()}.`
      );
    } catch (error) {
      setPasskeyMessage(
        error instanceof Error ? error.message : 'Passkey authentication failed.'
      );
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function handleToggleLock(enabled: boolean) {
    setLockEnabled(enabled);
    await setSetting('security.passkeyGateEnabled', enabled);
    setSessionLocked(Boolean(enabled && passkeyRecord));
  }

  const activeTheses = thesisSnapshots.filter(
    (snapshot) => snapshot.thesis.status === 'active'
  ).length;

  return (
    <div className="app-shell">
      {sessionLocked ? (
        <div className="lock-screen">
          <div className="lock-panel">
            <p className="eyebrow">Session Gate</p>
            <h2>Unlock Stonks</h2>
            <p>
              This uses the browser passkey flow for this exact origin. On iPhone,
              a supported platform authenticator should route through Face ID.
            </p>
            <button
              className="button button--primary"
              onClick={() => void handleAuthenticatePasskey()}
              disabled={passkeyBusy}
            >
              {passkeyBusy ? 'Checking passkey…' : 'Unlock with passkey'}
            </button>
            <p className="tiny muted">{passkeyMessage}</p>
          </div>
        </div>
      ) : null}

      <header className="hero">
        <div className="hero__copy">
          <p className="eyebrow">Local-First Investment Journal</p>
          <h1>Stonks</h1>
          <p className="hero-copy">
            The shell now does real work: create a thesis, log the executed trade,
            track assumptions over time, and keep a local timeline of what changed
            and why.
          </p>
        </div>

        <div className="hero-grid">
          <Metric
            label="Standalone mode"
            value={isStandalone ? 'Home screen' : 'Browser tab'}
            accent={isStandalone ? 'good' : 'neutral'}
          />
          <Metric
            label="Active theses"
            value={activeTheses}
            accent={activeTheses > 0 ? 'good' : 'neutral'}
          />
          <Metric
            label="Logged trades"
            value={foundationCounts.trades}
            accent={foundationCounts.trades > 0 ? 'good' : 'neutral'}
          />
          <Metric
            label="Storage mode"
            value={storageSnapshot.persisted ? 'Persistent' : 'Best effort'}
            accent={storageSnapshot.persisted ? 'good' : 'neutral'}
          />
          <Metric
            label="Platform authenticator"
            value={
              webauthnSupport.platformAuthenticator === null
                ? 'Unknown'
                : webauthnSupport.platformAuthenticator
                  ? 'Available'
                  : 'Unavailable'
            }
            accent={webauthnSupport.platformAuthenticator ? 'good' : 'warn'}
          />
          <Metric
            label="Pages base path"
            value={import.meta.env.BASE_URL}
            accent="neutral"
          />
        </div>
      </header>

      {!isStandalone && isIOS ? (
        <section className="card card--install">
          <div>
            <p className="eyebrow">iPhone Install</p>
            <h2>Use the home-screen version</h2>
          </div>
          <ol className="ordered-list">
            <li>Open this site in Safari.</li>
            <li>Tap Share.</li>
            <li>Tap “Add to Home Screen”.</li>
            <li>Launch Stonks from the icon so storage, passkey gating, and app chrome behave like an installed app.</li>
          </ol>
        </section>
      ) : null}

      <main className="grid grid--app">
        <section className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">New Thesis</p>
              <h2>Capture the position at entry</h2>
            </div>
            <span className="pill pill--good">Local only</span>
          </div>

          <form className="stack-form" onSubmit={handleCreateThesis}>
            <div className="field-grid">
              <label className="field">
                <span>Symbol</span>
                <input
                  value={thesisForm.symbol}
                  onChange={(event) =>
                    setThesisForm((current) => ({
                      ...current,
                      symbol: event.target.value.toUpperCase()
                    }))
                  }
                  placeholder="AAPL"
                />
              </label>

              <label className="field">
                <span>Title</span>
                <input
                  value={thesisForm.title}
                  onChange={(event) =>
                    setThesisForm((current) => ({
                      ...current,
                      title: event.target.value
                    }))
                  }
                  placeholder="Risk sleeve earnings rerating"
                />
              </label>
            </div>

            <div className="field-grid field-grid--triplet">
              <label className="field">
                <span>Stance</span>
                <select
                  value={thesisForm.stance}
                  onChange={(event) =>
                    setThesisForm((current) => ({
                      ...current,
                      stance: event.target.value as ThesisStance
                    }))
                  }
                >
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                  <option value="pair">Pair</option>
                </select>
              </label>

              <label className="field">
                <span>Status</span>
                <select
                  value={thesisForm.status}
                  onChange={(event) =>
                    setThesisForm((current) => ({
                      ...current,
                      status: event.target.value as ThesisStatus
                    }))
                  }
                >
                  <option value="watch">Watch</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              </label>

              <label className="field">
                <span>Time horizon</span>
                <input
                  value={thesisForm.timeHorizon}
                  onChange={(event) =>
                    setThesisForm((current) => ({
                      ...current,
                      timeHorizon: event.target.value
                    }))
                  }
                  placeholder="3-12 months"
                />
              </label>
            </div>

            <label className="field">
              <span>Thesis summary</span>
              <textarea
                value={thesisForm.summary}
                onChange={(event) =>
                  setThesisForm((current) => ({
                    ...current,
                    summary: event.target.value
                  }))
                }
                placeholder="What needs to happen for this to work, and why does the market misprice it?"
              />
            </label>

            <label className="field">
              <span>What would break the thesis</span>
              <textarea
                value={thesisForm.invalidation}
                onChange={(event) =>
                  setThesisForm((current) => ({
                    ...current,
                    invalidation: event.target.value
                  }))
                }
                placeholder="Revenue guide rolls over, margins compress, or the catalyst slips."
              />
            </label>

            <label className="field">
              <span>Benchmark / hurdle</span>
              <input
                value={thesisForm.benchmark}
                onChange={(event) =>
                  setThesisForm((current) => ({
                    ...current,
                    benchmark: event.target.value
                  }))
                }
                placeholder="SPY + CPIAUCSL"
              />
            </label>

            <div className="panel-grid">
              <div className="panel">
                <div className="panel__heading">
                  <h3>Initial assumption</h3>
                  <span className="tiny muted">Optional</span>
                </div>

                <label className="field">
                  <span>Assumption</span>
                  <textarea
                    value={thesisForm.assumption}
                    onChange={(event) =>
                      setThesisForm((current) => ({
                        ...current,
                        assumption: event.target.value
                      }))
                    }
                    placeholder="Demand stays stronger than consensus expects."
                  />
                </label>

                <div className="field-grid">
                  <label className="field">
                    <span>Status</span>
                    <select
                      value={thesisForm.assumptionStatus}
                      onChange={(event) =>
                        setThesisForm((current) => ({
                          ...current,
                          assumptionStatus: event.target.value as AssumptionStatus
                        }))
                      }
                    >
                      <option value="holding">Holding</option>
                      <option value="weaker">Weaker</option>
                      <option value="broken">Broken</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </label>

                  <label className="field">
                    <span>Weight (0-10)</span>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      step="1"
                      value={thesisForm.assumptionWeight}
                      onChange={(event) =>
                        setThesisForm((current) => ({
                          ...current,
                          assumptionWeight: event.target.value
                        }))
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="panel">
                <div className="panel__heading">
                  <h3>Initial trade</h3>
                  <label className="checkbox checkbox--inline">
                    <input
                      type="checkbox"
                      checked={thesisForm.createTrade}
                      onChange={(event) =>
                        setThesisForm((current) => ({
                          ...current,
                          createTrade: event.target.checked
                        }))
                      }
                    />
                    <span>Log executed trade now</span>
                  </label>
                </div>

                {thesisForm.createTrade ? (
                  <>
                    <div className="field-grid field-grid--triplet">
                      <label className="field">
                        <span>Side</span>
                        <select
                          value={thesisForm.tradeSide}
                          onChange={(event) =>
                            setThesisForm((current) => ({
                              ...current,
                              tradeSide: event.target.value as TradeSide
                            }))
                          }
                        >
                          <option value="buy">Buy</option>
                          <option value="sell">Sell</option>
                        </select>
                      </label>

                      <label className="field">
                        <span>Quantity</span>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={thesisForm.quantity}
                          onChange={(event) =>
                            setThesisForm((current) => ({
                              ...current,
                              quantity: event.target.value
                            }))
                          }
                        />
                      </label>

                      <label className="field">
                        <span>Price</span>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={thesisForm.price}
                          onChange={(event) =>
                            setThesisForm((current) => ({
                              ...current,
                              price: event.target.value
                            }))
                          }
                        />
                      </label>
                    </div>

                    <div className="field-grid">
                      <label className="field">
                        <span>Fees</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={thesisForm.fees}
                          onChange={(event) =>
                            setThesisForm((current) => ({
                              ...current,
                              fees: event.target.value
                            }))
                          }
                        />
                      </label>

                      <label className="field">
                        <span>Executed at</span>
                        <input
                          type="datetime-local"
                          value={thesisForm.occurredAt}
                          onChange={(event) =>
                            setThesisForm((current) => ({
                              ...current,
                              occurredAt: event.target.value
                            }))
                          }
                        />
                      </label>
                    </div>

                    <label className="field">
                      <span>Trade note</span>
                      <textarea
                        value={thesisForm.notes}
                        onChange={(event) =>
                          setThesisForm((current) => ({
                            ...current,
                            notes: event.target.value
                          }))
                        }
                        placeholder="Why this fill, why this size, and what changed since the order was placed?"
                      />
                    </label>
                  </>
                ) : (
                  <p className="muted">
                    Leave this off for watch ideas. Turn it on when you want the
                    thesis and the executed fill created together.
                  </p>
                )}
              </div>
            </div>

            <div className="button-row">
              <button
                className="button button--primary"
                type="submit"
                disabled={composerBusy}
              >
                {composerBusy ? 'Creating thesis…' : 'Create thesis'}
              </button>
            </div>

            <p className="tiny">{composerMessage}</p>
          </form>
        </section>

        <section className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Current Thesis</p>
              <h2>
                {selectedSnapshot
                  ? `${selectedSnapshot.thesis.symbol} · ${selectedSnapshot.thesis.title}`
                  : 'Nothing selected yet'}
              </h2>
            </div>
            {selectedSnapshot ? (
              <span className="pill">{selectedSnapshot.thesis.status}</span>
            ) : null}
          </div>

          {selectedSnapshot ? (
            <>
              <p className="muted">{selectedSnapshot.thesis.summary}</p>

              <div className="metrics-grid">
                <Metric
                  label="Open quantity"
                  value={formatQuantity(selectedSnapshot.metrics.openQuantity)}
                  accent={
                    selectedSnapshot.metrics.openQuantity !== 0 ? 'good' : 'neutral'
                  }
                />
                <Metric
                  label="Avg buy price"
                  value={formatCurrency(selectedSnapshot.metrics.averageBuyPrice)}
                  accent="neutral"
                />
                <Metric
                  label="Assumptions"
                  value={selectedSnapshot.assumptions.length}
                  accent={selectedSnapshot.assumptions.length > 0 ? 'good' : 'neutral'}
                />
                <Metric
                  label="Check-ins"
                  value={selectedSnapshot.reviews.length}
                  accent={selectedSnapshot.reviews.length > 0 ? 'good' : 'neutral'}
                />
              </div>

              <div className="detail-grid">
                <div>
                  <p className="detail-label">Benchmark</p>
                  <p>{selectedSnapshot.thesis.benchmark || 'Not set yet.'}</p>
                </div>
                <div>
                  <p className="detail-label">Time horizon</p>
                  <p>{selectedSnapshot.thesis.timeHorizon || 'Not set yet.'}</p>
                </div>
                <div className="detail-grid__wide">
                  <p className="detail-label">Invalidation</p>
                  <p>{selectedSnapshot.thesis.invalidation || 'Not set yet.'}</p>
                </div>
              </div>

              <div className="panel-grid">
                <form className="panel" onSubmit={handleAddTrade}>
                  <div className="panel__heading">
                    <h3>Log trade</h3>
                    <span className="tiny muted">Executed fills only</span>
                  </div>

                  <div className="field-grid field-grid--triplet">
                    <label className="field">
                      <span>Side</span>
                      <select
                        value={tradeForm.side}
                        onChange={(event) =>
                          setTradeForm((current) => ({
                            ...current,
                            side: event.target.value as TradeSide
                          }))
                        }
                      >
                        <option value="buy">Buy</option>
                        <option value="sell">Sell</option>
                      </select>
                    </label>

                    <label className="field">
                      <span>Quantity</span>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={tradeForm.quantity}
                        onChange={(event) =>
                          setTradeForm((current) => ({
                            ...current,
                            quantity: event.target.value
                          }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Price</span>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={tradeForm.price}
                        onChange={(event) =>
                          setTradeForm((current) => ({
                            ...current,
                            price: event.target.value
                          }))
                        }
                      />
                    </label>
                  </div>

                  <div className="field-grid">
                    <label className="field">
                      <span>Fees</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={tradeForm.fees}
                        onChange={(event) =>
                          setTradeForm((current) => ({
                            ...current,
                            fees: event.target.value
                          }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Executed at</span>
                      <input
                        type="datetime-local"
                        value={tradeForm.occurredAt}
                        onChange={(event) =>
                          setTradeForm((current) => ({
                            ...current,
                            occurredAt: event.target.value
                          }))
                        }
                      />
                    </label>
                  </div>

                  <label className="field">
                    <span>Trade note</span>
                    <textarea
                      value={tradeForm.notes}
                      onChange={(event) =>
                        setTradeForm((current) => ({
                          ...current,
                          notes: event.target.value
                        }))
                      }
                      placeholder="What changed between the original thesis and this fill?"
                    />
                  </label>

                  <button
                    className="button button--primary"
                    type="submit"
                    disabled={activityBusy}
                  >
                    {activityBusy ? 'Logging…' : 'Add trade'}
                  </button>
                </form>

                <form className="panel" onSubmit={handleAddAssumption}>
                  <div className="panel__heading">
                    <h3>Log assumption update</h3>
                    <span className="tiny muted">Keep the thesis honest</span>
                  </div>

                  <label className="field">
                    <span>Assumption</span>
                    <textarea
                      value={assumptionForm.statement}
                      onChange={(event) =>
                        setAssumptionForm((current) => ({
                          ...current,
                          statement: event.target.value
                        }))
                      }
                      placeholder="What still has to be true for the trade to work?"
                    />
                  </label>

                  <div className="field-grid">
                    <label className="field">
                      <span>Status</span>
                      <select
                        value={assumptionForm.status}
                        onChange={(event) =>
                          setAssumptionForm((current) => ({
                            ...current,
                            status: event.target.value as AssumptionStatus
                          }))
                        }
                      >
                        <option value="holding">Holding</option>
                        <option value="weaker">Weaker</option>
                        <option value="broken">Broken</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </label>

                    <label className="field">
                      <span>Weight (0-10)</span>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        step="1"
                        value={assumptionForm.weight}
                        onChange={(event) =>
                          setAssumptionForm((current) => ({
                            ...current,
                            weight: event.target.value
                          }))
                        }
                      />
                    </label>
                  </div>

                  <button
                    className="button button--primary"
                    type="submit"
                    disabled={activityBusy}
                  >
                    {activityBusy ? 'Logging…' : 'Add assumption'}
                  </button>
                </form>

                <form className="panel" onSubmit={handleAddReview}>
                  <div className="panel__heading">
                    <h3>Log check-in</h3>
                    <span className="tiny muted">A quick note for future you</span>
                  </div>

                  <div className="field-grid">
                    <label className="field">
                      <span>Review type</span>
                      <select
                        value={reviewForm.kind}
                        onChange={(event) =>
                          setReviewForm((current) => ({
                            ...current,
                            kind: event.target.value as ReviewKind
                          }))
                        }
                      >
                        <option value="entry">Entry</option>
                        <option value="checkin">Check-in</option>
                        <option value="exit">Exit</option>
                      </select>
                    </label>

                    <label className="field">
                      <span>Conviction (0-100)</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={reviewForm.conviction}
                        onChange={(event) =>
                          setReviewForm((current) => ({
                            ...current,
                            conviction: event.target.value
                          }))
                        }
                      />
                    </label>
                  </div>

                  <label className="field">
                    <span>Review note</span>
                    <textarea
                      value={reviewForm.summary}
                      onChange={(event) =>
                        setReviewForm((current) => ({
                          ...current,
                          summary: event.target.value
                        }))
                      }
                      placeholder="What got stronger, weaker, or invalidated since the last review?"
                    />
                  </label>

                  <button
                    className="button button--primary"
                    type="submit"
                    disabled={activityBusy}
                  >
                    {activityBusy ? 'Logging…' : 'Add check-in'}
                  </button>
                </form>
              </div>

              <p className="tiny">{activityMessage}</p>

              <div className="timeline">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Timeline</p>
                    <h3>What changed over time</h3>
                  </div>
                </div>

                {selectedSnapshot.timeline.length > 0 ? (
                  <ul className="timeline-list">
                    {selectedSnapshot.timeline.map((event) => {
                      const summary = timelineSummary(event);
                      return (
                        <li
                          className={`timeline-item timeline-item--${event.kind}`}
                          key={`${event.kind}-${event.id}`}
                        >
                          <div className="timeline-item__marker" />
                          <div className="timeline-item__body">
                            <div className="timeline-item__header">
                              <strong>{summary.title}</strong>
                              <span className="tiny muted">
                                <RelativeTime value={event.occurredAt} />
                              </span>
                            </div>
                            <p>{summary.body}</p>
                            <span className="tiny muted">{summary.meta}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="muted">Nothing has been logged for this thesis yet.</p>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <p className="muted">
                No thesis exists yet. Create one on the left or load a sample entry
                from the foundation panel below.
              </p>
            </div>
          )}
        </section>

        <section className="card card--wide">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Theses</p>
              <h2>Your local book</h2>
            </div>
            <span className="pill">{foundationCounts.theses} stored</span>
          </div>

          {thesisSnapshots.length > 0 ? (
            <div className="thesis-list">
              {thesisSnapshots.map((snapshot) => (
                <button
                  className={`thesis-card${
                    selectedThesisId === snapshot.thesis.id ? ' thesis-card--active' : ''
                  }`}
                  key={snapshot.thesis.id}
                  onClick={() => setSelectedThesisId(snapshot.thesis.id)}
                  type="button"
                >
                  <div className="thesis-card__header">
                    <div>
                      <p className="eyebrow">{snapshot.thesis.symbol}</p>
                      <h3>{snapshot.thesis.title}</h3>
                    </div>
                    <span className="pill">{snapshot.thesis.status}</span>
                  </div>
                  <p className="thesis-card__summary">{snapshot.thesis.summary}</p>
                  <div className="thesis-card__stats">
                    <span>Open {formatQuantity(snapshot.metrics.openQuantity)}</span>
                    <span>Trades {snapshot.trades.length}</span>
                    <span>Updated <RelativeTime value={snapshot.thesis.updatedAt} /></span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">
              Nothing is stored yet. Once you create a thesis, this becomes your
              on-device investment timeline.
            </p>
          )}
        </section>

        <section className="card card--wide">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Foundation</p>
              <h2>Deployment, security, and data probes</h2>
            </div>
          </div>

          <div className="ops-grid">
            <div className="panel">
              <div className="panel__heading">
                <h3>GitHub Pages + iPhone use</h3>
              </div>

              <ul className="plain-list">
                <li>A GitHub Actions deployment workflow is included for Pages.</li>
                <li>Default Pages base path targets `/{'{repo-name}'}/`; override with repository variable `VITE_BASE_PATH` when using a custom domain or user site root.</li>
                <li>Passkeys are origin-specific, so re-register after moving from localhost to GitHub Pages or a custom domain.</li>
              </ul>
            </div>

            <div className="panel">
              <div className="panel__heading">
                <h3>Storage + passkey</h3>
              </div>

              <div className="metrics-grid">
                <Metric label="Usage" value={formatBytes(storageSnapshot.usage)} />
                <Metric label="Quota" value={formatBytes(storageSnapshot.quota)} />
                <Metric
                  label="Persistent storage"
                  value={storageSnapshot.persisted ? 'Yes' : 'No'}
                  accent={storageSnapshot.persisted ? 'good' : 'neutral'}
                />
                <Metric
                  label="Saved passkey"
                  value={passkeyRecord ? '1 local record' : 'None'}
                  accent={passkeyRecord ? 'good' : 'neutral'}
                />
              </div>

              <div className="button-row">
                <button
                  className="button button--primary"
                  onClick={() => void handleRequestPersistence()}
                  disabled={storageBusy}
                  type="button"
                >
                  {storageBusy ? 'Working…' : 'Request persistent storage'}
                </button>
                <button
                  className="button"
                  onClick={() => void handleSeedDemoData()}
                  disabled={storageBusy}
                  type="button"
                >
                  {storageBusy ? 'Writing…' : 'Load sample thesis'}
                </button>
              </div>

              <label className="field">
                <span>Passkey label</span>
                <input
                  value={passkeyLabel}
                  onChange={(event) => setPasskeyLabel(event.target.value)}
                  placeholder="Carson iPhone"
                />
              </label>

              <div className="button-row">
                <button
                  className="button button--primary"
                  onClick={() => void handleRegisterPasskey()}
                  disabled={passkeyBusy || !webauthnSupport.supported}
                  type="button"
                >
                  {passkeyBusy ? 'Registering…' : 'Register local passkey'}
                </button>
                <button
                  className="button"
                  onClick={() => void handleAuthenticatePasskey()}
                  disabled={passkeyBusy || !passkeyRecord}
                  type="button"
                >
                  {passkeyBusy ? 'Checking…' : 'Run unlock probe'}
                </button>
              </div>

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={lockEnabled}
                  onChange={(event) => void handleToggleLock(event.target.checked)}
                  disabled={!passkeyRecord}
                />
                <span>Gate the app shell behind passkey auth on reload</span>
              </label>

              <p className="tiny">{storageMessage}</p>
              <p className="tiny">{passkeyMessage}</p>
            </div>

            <div className="panel panel--probe">
              <div className="panel__heading">
                <h3>Market data probes</h3>
              </div>

              <div className="probe-stack">
                <div className="probe">
                  <h3>MarketData.app quote probe</h3>
                  <label className="field">
                    <span>Symbol</span>
                    <input
                      value={marketSymbol}
                      onChange={(event) => setMarketSymbol(event.target.value)}
                      placeholder="AAPL"
                    />
                  </label>
                  <label className="field">
                    <span>Bearer token</span>
                    <input
                      type="password"
                      value={marketToken}
                      onChange={(event) => setMarketToken(event.target.value)}
                      placeholder="Optional token"
                    />
                  </label>
                  <button
                    className="button button--primary"
                    onClick={() => void handleMarketProbe()}
                    disabled={marketBusy}
                    type="button"
                  >
                    {marketBusy ? 'Fetching quote…' : 'Fetch quote'}
                  </button>
                  <ResultPanel result={marketResult} />
                </div>

                <div className="probe">
                  <h3>FRED macro probe</h3>
                  <label className="field">
                    <span>Series ID</span>
                    <input
                      value={fredSeriesId}
                      onChange={(event) => setFredSeriesId(event.target.value)}
                      placeholder="CPIAUCSL"
                    />
                  </label>
                  <label className="field">
                    <span>FRED API key</span>
                    <input
                      type="password"
                      value={fredApiKey}
                      onChange={(event) => setFredApiKey(event.target.value)}
                      placeholder="Required by FRED"
                    />
                  </label>
                  <button
                    className="button button--primary"
                    onClick={() => void handleFredProbe()}
                    disabled={fredBusy || !fredApiKey.trim()}
                    type="button"
                  >
                    {fredBusy ? 'Fetching series…' : 'Fetch series'}
                  </button>
                  <ResultPanel result={fredResult} />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
