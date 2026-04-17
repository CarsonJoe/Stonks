import { useEffect, useState, type JSX } from 'react';
import {
  getLocalPasskeyCredential,
  getSetting,
  listThesisSnapshots,
  setSetting,
  type ThesisSnapshot
} from './db';
import { fetchMarketDataQuote } from './lib/market';
import { getWebAuthnSupportSnapshot, authenticateLocalPasskey } from './lib/webauthn';
import { NewThesisTab } from './tabs/NewThesisTab';
import { NotificationsTab } from './tabs/NotificationsTab';
import { PositionsTab } from './tabs/PositionsTab';
import { ResearchTab } from './tabs/ResearchTab';
import { SettingsTab } from './tabs/SettingsTab';

// ── Types ─────────────────────────────────────────────────────────────────────

type TabId = 'notifications' | 'positions' | 'new-thesis' | 'research' | 'settings';

type IconProps = { className?: string };

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconBell({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 10a6 6 0 0 1 12 0c0 3.5 1.5 5 1.5 5H4.5S6 13.5 6 10Z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"
      />
      <path d="M9.5 19a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconCandles({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 4v4m0 8v4m0-8v4m5-11v8m0 4v2m5-13v2m0 8v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5.5 8h3v4h-3zm5-3h3v8h-3zm5 5h3v4h-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function IconPlus({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function IconTrend({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 17.5h16M6.5 14.5l3.5-3.5 3 2.5 4.5-6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSliders({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="9" cy="7" r="2" fill="currentColor" />
      <circle cx="15" cy="12" r="2" fill="currentColor" />
      <circle cx="11" cy="17" r="2" fill="currentColor" />
    </svg>
  );
}

const navItems: Array<{
  id: TabId;
  label: string;
  icon: (props: IconProps) => JSX.Element;
  center?: boolean;
}> = [
  { id: 'notifications', label: 'Reminders', icon: IconBell },
  { id: 'positions', label: 'Positions', icon: IconCandles },
  { id: 'new-thesis', label: 'New', icon: IconPlus, center: true },
  { id: 'research', label: 'Research', icon: IconTrend },
  { id: 'settings', label: 'Settings', icon: IconSliders }
];

// ── App shell ─────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('positions');
  const [snapshots, setSnapshots] = useState<ThesisSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [marketApiKey, setMarketApiKey] = useState('');
  const [benchmarkCurrentPrice, setBenchmarkCurrentPrice] = useState<number | null>(null);

  // Auth / lock state
  const [sessionLocked, setSessionLocked] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  useEffect(() => {
    async function boot() {
      const [savedKey, legacyKey, savedLockEnabled, savedPasskey, support] = await Promise.all([
        getSetting<string>('market.twelveDataApiKey'),
        getSetting<string>('market.quoteToken'),
        getSetting<boolean>('security.passkeyGateEnabled'),
        getLocalPasskeyCredential(),
        getWebAuthnSupportSnapshot()
      ]);

      const key = savedKey ?? legacyKey ?? '';
      setMarketApiKey(key);
      setSessionLocked(Boolean(savedLockEnabled && savedPasskey && support.supported));

      await refreshPortfolio(null, key);
    }

    void boot();
  }, []);

  // Fetch benchmark price when market data key is available
  useEffect(() => {
    if (!marketApiKey.trim()) return;

    fetchMarketDataQuote({ symbol: 'SPY', token: marketApiKey }).then((quote) => {
      if (quote.ok && quote.last !== null) {
        setBenchmarkCurrentPrice(quote.last);
      }
    });
  }, [marketApiKey]);

  // Lock on visibility hidden
  useEffect(() => {
    async function handleVisibility() {
      if (document.visibilityState !== 'hidden') return;
      const [lockEnabled, passkey] = await Promise.all([
        getSetting<boolean>('security.passkeyGateEnabled'),
        getLocalPasskeyCredential()
      ]);
      if (lockEnabled && passkey) setSessionLocked(true);
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // ── Portfolio refresh ──────────────────────────────────────────────────────

  async function refreshPortfolio(
    nextSelectedId?: string | null,
    keyOverride?: string
  ) {
    const loaded = await listThesisSnapshots();
    setSnapshots(loaded);

    if (loaded.length === 0) {
      setSelectedId(null);
      return;
    }

    const preferredId = nextSelectedId ?? selectedId;
    const found = preferredId
      ? loaded.find((s) => s.thesis.id === preferredId)
      : null;
    setSelectedId(found?.thesis.id ?? loaded[0].thesis.id);
  }

  // ── Tab navigation ─────────────────────────────────────────────────────────

  function handleTabPress(tab: TabId) {
    // Redirect to new-thesis if no positions yet and user taps positions/notifications
    if (snapshots.length === 0 && (tab === 'positions' || tab === 'notifications')) {
      setActiveTab('new-thesis');
      return;
    }
    setActiveTab(tab);
  }

  // ── Called when a new thesis is saved ─────────────────────────────────────

  async function handleThesisSaved(thesisId: string) {
    await refreshPortfolio(thesisId);
    setActiveTab('positions');
  }

  // ── Passkey unlock ─────────────────────────────────────────────────────────

  async function handleUnlock() {
    const passkey = await getLocalPasskeyCredential();
    if (!passkey) return;
    setPasskeyBusy(true);
    try {
      await authenticateLocalPasskey(passkey);
      setSessionLocked(false);
    } catch {
      // stay locked
    } finally {
      setPasskeyBusy(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="app-shell">
        <main className="main-view">
          {activeTab === 'notifications' ? (
            <NotificationsTab
              snapshots={snapshots}
              benchmarkCurrentPrice={benchmarkCurrentPrice}
              onNavigateToNew={() => setActiveTab('new-thesis')}
              onNavigateToPositions={() => setActiveTab('positions')}
            />
          ) : null}

          {activeTab === 'positions' ? (
            <PositionsTab
              snapshots={snapshots}
              selectedId={selectedId}
              onSelectId={setSelectedId}
              marketApiKey={marketApiKey}
              onNavigateToNew={() => setActiveTab('new-thesis')}
              onRefresh={refreshPortfolio}
              benchmarkCurrentPrice={benchmarkCurrentPrice}
            />
          ) : null}

          {activeTab === 'new-thesis' ? (
            <NewThesisTab
              marketApiKey={marketApiKey}
              onSaved={handleThesisSaved}
            />
          ) : null}

          {activeTab === 'research' ? (
            <ResearchTab
              marketApiKey={marketApiKey}
              selectedSnapshot={snapshots.find((s) => s.thesis.id === selectedId) ?? null}
            />
          ) : null}

          {activeTab === 'settings' ? (
            <SettingsTab
              marketApiKey={marketApiKey}
              onMarketApiKeyChange={setMarketApiKey}
            />
          ) : null}
        </main>
      </div>

      <nav className="tabbar" aria-label="Primary">
        {navItems.map(({ id, label, icon: Icon, center }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              className={`tabbar__button${active ? ' tabbar__button--active' : ''}${center ? ' tabbar__button--center' : ''}`}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => handleTabPress(id)}
            >
              <span className="tabbar__icon-shell">
                <Icon className="tabbar__icon" />
              </span>
              {!center ? <span className="tabbar__marker" /> : null}
            </button>
          );
        })}
      </nav>

      {sessionLocked ? (
        <div className="lock-screen">
          <div className="lock-panel">
            <span className="eyebrow">Locked</span>
            <strong>Unlock Stonks</strong>
            <p className="subtle-copy">Use the device passkey to continue.</p>
            <button
              className="button button--primary"
              type="button"
              onClick={handleUnlock}
              disabled={passkeyBusy}
            >
              Unlock
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
