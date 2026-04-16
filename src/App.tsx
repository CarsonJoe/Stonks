import { useEffect, useState } from 'react';
import {
  addAssumptionToThesis,
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
  type ThesisSnapshot,
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
  thesis: string;
  invalidation: string;
  assumption: string;
  createTrade: boolean;
  tradeSide: TradeSide;
  quantity: string;
  price: string;
  note: string;
}

interface TradeFormState {
  side: TradeSide;
  quantity: string;
  price: string;
  note: string;
}

interface AssumptionFormState {
  statement: string;
  status: AssumptionStatus;
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

const quantityFormatter = new Intl.NumberFormat('en-US', {
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

  return quantityFormatter.format(value);
}

function defaultThesisForm(): ThesisFormState {
  return {
    symbol: '',
    thesis: '',
    invalidation: '',
    assumption: '',
    createTrade: true,
    tradeSide: 'buy',
    quantity: '',
    price: '',
    note: ''
  };
}

function defaultTradeForm(): TradeFormState {
  return {
    side: 'buy',
    quantity: '',
    price: '',
    note: ''
  };
}

function defaultAssumptionForm(): AssumptionFormState {
  return {
    statement: '',
    status: 'holding'
  };
}

function RelativeTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>;
}

function ResultPanel({ result }: { result: ApiProbeResult | null }) {
  if (!result) {
    return null;
  }

  return (
    <div className="terminal">
      <div className="terminal__meta">
        <span>{result.source}</span>
        <span>{result.status ?? 'network error'}</span>
        <RelativeTime value={result.requestedAt} />
      </div>
      {result.error ? <p className="terminal__error">{result.error}</p> : null}
      <pre>
        {typeof result.preview === 'string'
          ? result.preview
          : JSON.stringify(result.preview, null, 2)}
      </pre>
    </div>
  );
}

function timelineSummary(event: ThesisTimelineEvent) {
  if (event.kind === 'thesis') {
    return {
      label: 'thesis',
      title: event.thesis.summary,
      meta: event.thesis.invalidation
        ? `breaks if ${event.thesis.invalidation}`
        : `${event.thesis.symbol} opened`
    };
  }

  if (event.kind === 'trade') {
    return {
      label: event.trade.side,
      title: `${event.trade.side} ${formatQuantity(event.trade.quantity)} @ ${formatCurrency(
        event.trade.price
      )}`,
      meta: event.trade.notes?.trim() || `${event.trade.symbol} fill logged`
    };
  }

  if (event.kind === 'assumption') {
    return {
      label: event.assumption.status,
      title: event.assumption.statement,
      meta: `assumption is ${event.assumption.status}`
    };
  }

  return {
    label: event.review.kind,
    title: event.review.summary,
    meta: 'checkpoint'
  };
}

export default function App() {
  const [storageSnapshot, setStorageSnapshot] = useState<StorageSnapshot>({
    supported: false
  });
  const [foundationCounts, setFoundationCounts] = useState<FoundationCounts>(emptyCounts);
  const [thesisSnapshots, setThesisSnapshots] = useState<ThesisSnapshot[]>([]);
  const [selectedThesisId, setSelectedThesisId] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [tradeNoteOpen, setTradeNoteOpen] = useState(false);

  const [composerMessage, setComposerMessage] = useState(
    'Capture one thesis and start logging fills.'
  );
  const [activityMessage, setActivityMessage] = useState(
    'Log the next executed trade.'
  );
  const [storageMessage, setStorageMessage] = useState('Local storage is ready.');

  const [thesisForm, setThesisForm] = useState<ThesisFormState>(defaultThesisForm());
  const [tradeForm, setTradeForm] = useState<TradeFormState>(defaultTradeForm());
  const [assumptionForm, setAssumptionForm] = useState<AssumptionFormState>(
    defaultAssumptionForm()
  );

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
    'Passkey gate is optional and hidden until you need it.'
  );
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [sessionLocked, setSessionLocked] = useState(false);

  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const selectedSnapshot =
    thesisSnapshots.find((snapshot) => snapshot.thesis.id === selectedThesisId) ?? null;
  const timelineItems = selectedSnapshot
    ? historyExpanded
      ? selectedSnapshot.timeline
      : selectedSnapshot.timeline.slice(0, 6)
    : [];

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
      setComposerOpen(true);
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
    setTradeNoteOpen(false);
    setHistoryExpanded(false);
  }, [selectedThesisId]);

  async function handleCreateThesis(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setComposerBusy(true);

    try {
      const symbol = thesisForm.symbol.trim().toUpperCase();
      const thesis = thesisForm.thesis.trim();

      if (!symbol || !thesis) {
        throw new Error('Symbol and thesis are the only required fields here.');
      }

      let initialTrade;
      if (thesisForm.createTrade) {
        const quantity = Number(thesisForm.quantity);
        const price = Number(thesisForm.price);

        if (!(quantity > 0) || !(price > 0)) {
          throw new Error('If you log the first fill now, quantity and price must be positive.');
        }

        initialTrade = {
          side: thesisForm.tradeSide,
          quantity,
          price,
          fees: 0,
          occurredAt: new Date().toISOString(),
          notes: thesisForm.note
        };
      }

      const thesisId = await createThesisEntry({
        symbol,
        summary: thesis,
        invalidation: thesisForm.invalidation,
        initialAssumption: thesisForm.assumption.trim()
          ? {
              statement: thesisForm.assumption,
              status: 'holding',
              weight: 7
            }
          : undefined,
        initialTrade
      });

      await refreshPortfolioState(thesisId);
      setThesisForm(defaultThesisForm());
      setComposerOpen(false);
      setComposerMessage(`${symbol} is live. Keep logging from the main screen.`);
    } catch (error) {
      setComposerMessage(
        error instanceof Error ? error.message : 'Could not create the thesis.'
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

      if (!(quantity > 0) || !(price > 0)) {
        throw new Error('Quantity and price must both be positive.');
      }

      await addTradeToThesis({
        thesisId: selectedSnapshot.thesis.id,
        side: tradeForm.side,
        quantity,
        price,
        fees: 0,
        occurredAt: new Date().toISOString(),
        notes: tradeForm.note
      });

      await refreshPortfolioState(selectedSnapshot.thesis.id);
      setTradeForm(defaultTradeForm());
      setTradeNoteOpen(false);
      setActivityMessage(`${selectedSnapshot.thesis.symbol} fill logged.`);
    } catch (error) {
      setActivityMessage(
        error instanceof Error ? error.message : 'Could not log the trade.'
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
        throw new Error('Add the assumption text first.');
      }

      await addAssumptionToThesis({
        thesisId: selectedSnapshot.thesis.id,
        statement: assumptionForm.statement,
        status: assumptionForm.status,
        weight: 7
      });

      await refreshPortfolioState(selectedSnapshot.thesis.id);
      setAssumptionForm(defaultAssumptionForm());
      setActivityMessage(`Assumption added to ${selectedSnapshot.thesis.symbol}.`);
    } catch (error) {
      setActivityMessage(
        error instanceof Error ? error.message : 'Could not log the assumption.'
      );
    } finally {
      setActivityBusy(false);
    }
  }

  async function handleRequestPersistence() {
    setStorageBusy(true);
    const granted = await requestStoragePersistence();
    const snapshot = await getStorageSnapshot();
    setStorageSnapshot(snapshot);
    setStorageMessage(
      granted
        ? 'Persistent storage is on for this origin.'
        : 'Persistent storage was not granted here.'
    );
    setStorageBusy(false);
  }

  async function handleSeedDemoData() {
    setStorageBusy(true);
    const thesisId = await seedFoundationEntries();
    await refreshPortfolioState(thesisId);
    setStorageMessage('Sample thesis loaded locally.');
    setStorageBusy(false);
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
      setPasskeyMessage('Passkey registered for this exact origin.');
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
      await authenticateLocalPasskey(passkeyRecord);
      setSessionLocked(false);
      setPasskeyMessage('Passkey accepted.');
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

  return (
    <div className="app-shell">
      {sessionLocked ? (
        <div className="lock-screen">
          <div className="lock-panel">
            <p className="kicker">session gate</p>
            <h2>Unlock Stonks</h2>
            <p className="muted">
              This is a local passkey gate for this deployed origin. On iPhone it
              should route through Face ID when supported.
            </p>
            <button
              className="button button--primary"
              type="button"
              onClick={() => void handleAuthenticatePasskey()}
              disabled={passkeyBusy}
            >
              {passkeyBusy ? 'checking…' : 'unlock'}
            </button>
            <p className="tiny muted">{passkeyMessage}</p>
          </div>
        </div>
      ) : null}

      <header className="topbar">
        <div>
          <p className="kicker">stonks //</p>
          <h1>simple trade journal</h1>
        </div>

        <div className="topbar__actions">
          <button
            className="button"
            type="button"
            onClick={() => setComposerOpen((current) => !current)}
          >
            {composerOpen ? 'close new thesis' : 'new thesis'}
          </button>
        </div>
      </header>

      {isIOS && !isStandalone ? (
        <section className="strip">
          <span>Open in Safari and add to home screen for the real iPhone app shell.</span>
        </section>
      ) : null}

      {composerOpen ? (
        <section className="panel panel--composer">
          <div className="panel__head">
            <div>
              <p className="kicker">new thesis</p>
              <h2>Capture only the core idea</h2>
            </div>
          </div>

          <form className="stack" onSubmit={handleCreateThesis}>
            <div className="field-grid">
              <label className="field">
                <span>symbol</span>
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
                <span>thesis</span>
                <input
                  value={thesisForm.thesis}
                  onChange={(event) =>
                    setThesisForm((current) => ({
                      ...current,
                      thesis: event.target.value
                    }))
                  }
                  placeholder="Why this is mispriced right now"
                />
              </label>
            </div>

            <details className="drawer">
              <summary>more context</summary>
              <div className="stack">
                <label className="field">
                  <span>breaks if</span>
                  <textarea
                    value={thesisForm.invalidation}
                    onChange={(event) =>
                      setThesisForm((current) => ({
                        ...current,
                        invalidation: event.target.value
                      }))
                    }
                    placeholder="What specifically would prove the trade wrong?"
                  />
                </label>

                <label className="field">
                  <span>core assumption</span>
                  <textarea
                    value={thesisForm.assumption}
                    onChange={(event) =>
                      setThesisForm((current) => ({
                        ...current,
                        assumption: event.target.value
                      }))
                    }
                    placeholder="What still has to stay true?"
                  />
                </label>
              </div>
            </details>

            <label className="toggle">
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
              <span>log the first fill right now</span>
            </label>

            {thesisForm.createTrade ? (
              <div className="stack">
                <div className="segmented">
                  {(['buy', 'sell'] as TradeSide[]).map((side) => (
                    <button
                      key={side}
                      className={`segment${
                        thesisForm.tradeSide === side ? ' segment--active' : ''
                      }`}
                      type="button"
                      onClick={() =>
                        setThesisForm((current) => ({
                          ...current,
                          tradeSide: side
                        }))
                      }
                    >
                      {side}
                    </button>
                  ))}
                </div>

                <div className="field-grid field-grid--tight">
                  <label className="field">
                    <span>quantity</span>
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
                    <span>price</span>
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

                <label className="field">
                  <span>note if needed</span>
                  <textarea
                    value={thesisForm.note}
                    onChange={(event) =>
                      setThesisForm((current) => ({
                        ...current,
                        note: event.target.value
                      }))
                    }
                    placeholder="Only write this if the fill itself needs context."
                  />
                </label>
              </div>
            ) : null}

            <div className="button-row">
              <button
                className="button button--primary"
                type="submit"
                disabled={composerBusy}
              >
                {composerBusy ? 'saving…' : 'save thesis'}
              </button>
            </div>

            <p className="tiny muted">{composerMessage}</p>
          </form>
        </section>
      ) : null}

      {selectedSnapshot ? (
        <main className="main-grid">
          <section className="panel panel--focus">
            <div className="panel__head">
              <div>
                <p className="kicker">focus</p>
                <h2>{selectedSnapshot.thesis.symbol}</h2>
              </div>
              <span className="badge">{selectedSnapshot.thesis.status}</span>
            </div>

            <p className="lead">{selectedSnapshot.thesis.summary}</p>

            {selectedSnapshot.thesis.invalidation ? (
              <div className="meta-box">
                <span className="meta-box__label">breaks if</span>
                <p>{selectedSnapshot.thesis.invalidation}</p>
              </div>
            ) : null}

            <div className="stat-strip">
              <div>
                <span className="stat-strip__label">open</span>
                <strong>{formatQuantity(selectedSnapshot.metrics.openQuantity)}</strong>
              </div>
              <div>
                <span className="stat-strip__label">avg</span>
                <strong>{formatCurrency(selectedSnapshot.metrics.averageBuyPrice)}</strong>
              </div>
              <div>
                <span className="stat-strip__label">trades</span>
                <strong>{selectedSnapshot.trades.length}</strong>
              </div>
            </div>

            {thesisSnapshots.length > 1 ? (
              <div className="chip-row">
                {thesisSnapshots.map((snapshot) => (
                  <button
                    key={snapshot.thesis.id}
                    className={`chip${
                      snapshot.thesis.id === selectedThesisId ? ' chip--active' : ''
                    }`}
                    type="button"
                    onClick={() => setSelectedThesisId(snapshot.thesis.id)}
                  >
                    {snapshot.thesis.symbol}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section className="panel panel--log">
            <div className="panel__head">
              <div>
                <p className="kicker">quick log</p>
                <h2>Executed trade</h2>
              </div>
            </div>

            <form className="stack" onSubmit={handleAddTrade}>
              <div className="segmented">
                {(['buy', 'sell'] as TradeSide[]).map((side) => (
                  <button
                    key={side}
                    className={`segment${tradeForm.side === side ? ' segment--active' : ''}`}
                    type="button"
                    onClick={() =>
                      setTradeForm((current) => ({
                        ...current,
                        side
                      }))
                    }
                  >
                    {side}
                  </button>
                ))}
              </div>

              <div className="field-grid field-grid--tight">
                <label className="field">
                  <span>quantity</span>
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
                  <span>price</span>
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

              {tradeNoteOpen || tradeForm.note ? (
                <label className="field">
                  <span>note</span>
                  <textarea
                    value={tradeForm.note}
                    onChange={(event) =>
                      setTradeForm((current) => ({
                        ...current,
                        note: event.target.value
                      }))
                    }
                    placeholder="Only add context if this fill changed the story."
                  />
                </label>
              ) : null}

              <div className="button-row">
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => setTradeNoteOpen((current) => !current)}
                >
                  {tradeNoteOpen ? 'hide note' : 'add note'}
                </button>
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={activityBusy}
                >
                  {activityBusy ? 'saving…' : 'log fill'}
                </button>
              </div>
            </form>

            <p className="tiny muted">{activityMessage}</p>
          </section>

          <details className="panel drawer">
            <summary>assumptions</summary>
            <form className="stack stack--drawer" onSubmit={handleAddAssumption}>
              <label className="field">
                <span>what has to stay true</span>
                <textarea
                  value={assumptionForm.statement}
                  onChange={(event) =>
                    setAssumptionForm((current) => ({
                      ...current,
                      statement: event.target.value
                    }))
                  }
                  placeholder="Only log this when the assumption actually matters."
                />
              </label>

              <div className="segmented segmented--small">
                {(['holding', 'weaker', 'broken'] as AssumptionStatus[]).map((status) => (
                  <button
                    key={status}
                    className={`segment${
                      assumptionForm.status === status ? ' segment--active' : ''
                    }`}
                    type="button"
                    onClick={() =>
                      setAssumptionForm((current) => ({
                        ...current,
                        status
                      }))
                    }
                  >
                    {status}
                  </button>
                ))}
              </div>

              <div className="button-row">
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={activityBusy}
                >
                  {activityBusy ? 'saving…' : 'save assumption'}
                </button>
              </div>
            </form>
          </details>

          <section className="panel panel--history">
            <div className="panel__head">
              <div>
                <p className="kicker">recent history</p>
                <h2>Only what changed</h2>
              </div>
              {selectedSnapshot.timeline.length > 6 ? (
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => setHistoryExpanded((current) => !current)}
                >
                  {historyExpanded ? 'show less' : 'show all'}
                </button>
              ) : null}
            </div>

            <ul className="timeline">
              {timelineItems.map((event) => {
                const summary = timelineSummary(event);
                return (
                  <li className="timeline__item" key={`${event.kind}-${event.id}`}>
                    <div className={`timeline__tag timeline__tag--${event.kind}`}>
                      {summary.label}
                    </div>
                    <div className="timeline__body">
                      <p>{summary.title}</p>
                      <span className="tiny muted">{summary.meta}</span>
                    </div>
                    <span className="tiny muted">
                      <RelativeTime value={event.occurredAt} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </main>
      ) : (
        <section className="panel panel--empty">
          <p className="lead">No thesis yet.</p>
          <p className="muted">
            Start with a symbol and one sentence about why the market is wrong.
          </p>
        </section>
      )}

      <details className="panel drawer drawer--system">
        <summary>system / lock / feed tests</summary>

        <div className="system-grid">
          <section className="mini-panel">
            <p className="kicker">storage</p>
            <p className="mini-panel__line">
              {storageSnapshot.persisted ? 'persistent' : 'best effort'} ·{' '}
              {formatBytes(storageSnapshot.usage)} used
            </p>
            <p className="tiny muted">
              {foundationCounts.theses} theses · {foundationCounts.trades} trades ·{' '}
              {foundationCounts.marketSnapshots} snapshots
            </p>
            <div className="button-row">
              <button
                className="button button--ghost"
                type="button"
                onClick={() => void handleRequestPersistence()}
                disabled={storageBusy}
              >
                {storageBusy ? 'working…' : 'request persistence'}
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => void handleSeedDemoData()}
                disabled={storageBusy}
              >
                {storageBusy ? 'loading…' : 'load sample'}
              </button>
            </div>
            <p className="tiny muted">{storageMessage}</p>
          </section>

          <section className="mini-panel">
            <p className="kicker">passkey</p>
            <p className="mini-panel__line">
              {webauthnSupport.platformAuthenticator ? 'face id / touch id path ready' : 'platform authenticator unknown'}
            </p>
            <label className="field">
              <span>device label</span>
              <input
                value={passkeyLabel}
                onChange={(event) => setPasskeyLabel(event.target.value)}
              />
            </label>
            <div className="button-row">
              <button
                className="button button--ghost"
                type="button"
                onClick={() => void handleRegisterPasskey()}
                disabled={passkeyBusy || !webauthnSupport.supported}
              >
                {passkeyBusy ? 'working…' : 'register'}
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => void handleAuthenticatePasskey()}
                disabled={passkeyBusy || !passkeyRecord}
              >
                {passkeyBusy ? 'working…' : 'test unlock'}
              </button>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={lockEnabled}
                onChange={(event) => void handleToggleLock(event.target.checked)}
                disabled={!passkeyRecord}
              />
              <span>lock app on reload</span>
            </label>
            <p className="tiny muted">{passkeyMessage}</p>
          </section>

          <section className="mini-panel">
            <p className="kicker">market feed</p>
            <div className="stack">
              <label className="field">
                <span>symbol</span>
                <input
                  value={marketSymbol}
                  onChange={(event) => setMarketSymbol(event.target.value)}
                />
              </label>
              <label className="field">
                <span>market token</span>
                <input
                  type="password"
                  value={marketToken}
                  onChange={(event) => setMarketToken(event.target.value)}
                />
              </label>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => void handleMarketProbe()}
                disabled={marketBusy}
              >
                {marketBusy ? 'fetching…' : 'test quote'}
              </button>
              <ResultPanel result={marketResult} />
            </div>
          </section>

          <section className="mini-panel">
            <p className="kicker">macro feed</p>
            <div className="stack">
              <label className="field">
                <span>series</span>
                <input
                  value={fredSeriesId}
                  onChange={(event) => setFredSeriesId(event.target.value)}
                />
              </label>
              <label className="field">
                <span>fred api key</span>
                <input
                  type="password"
                  value={fredApiKey}
                  onChange={(event) => setFredApiKey(event.target.value)}
                />
              </label>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => void handleFredProbe()}
                disabled={fredBusy || !fredApiKey.trim()}
              >
                {fredBusy ? 'fetching…' : 'test series'}
              </button>
              <ResultPanel result={fredResult} />
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}
