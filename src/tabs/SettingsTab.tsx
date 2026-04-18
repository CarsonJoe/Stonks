import { useState } from 'react';
import { getSetting, setSetting } from '../db';
import { getStorageSnapshot, requestStoragePersistence, formatBytes } from '../lib/storage';
import {
  authenticateLocalPasskey,
  getWebAuthnSupportSnapshot,
  registerLocalPasskey,
  type LocalPasskeyCredential,
  type WebAuthnSupportSnapshot
} from '../lib/webauthn';
import { getLocalPasskeyCredential, saveLocalPasskeyCredential } from '../db';

interface SettingsTabProps {
  marketApiKey: string;
  onMarketApiKeyChange: (key: string) => void;
  geminiApiKey: string;
  onGeminiApiKeyChange: (key: string) => void;
}

export function SettingsTab({ marketApiKey, onMarketApiKeyChange, geminiApiKey, onGeminiApiKeyChange }: SettingsTabProps) {
  const [apiKeyInput, setApiKeyInput] = useState(marketApiKey);
  const [geminiKeyInput, setGeminiKeyInput] = useState(geminiApiKey);
  const [settingsStatus, setSettingsStatus] = useState('');
  const [settingsBusy, setSettingsBusy] = useState(false);

  const [storageSnapshot, setStorageSnapshot] = useState<Awaited<ReturnType<typeof getStorageSnapshot>> | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);

  const [webauthnSupport, setWebauthnSupport] = useState<WebAuthnSupportSnapshot | null>(null);
  const [passkeyRecord, setPasskeyRecord] = useState<LocalPasskeyCredential | null>(null);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [passkeyStatus, setPasskeyStatus] = useState('');
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  // Lazy load device info when section is opened
  async function loadDeviceInfo() {
    if (storageSnapshot) return;
    const [storage, support, savedPasskey, savedLockEnabled] = await Promise.all([
      getStorageSnapshot(),
      getWebAuthnSupportSnapshot(),
      getLocalPasskeyCredential(),
      getSetting<boolean>('security.passkeyGateEnabled')
    ]);
    setStorageSnapshot(storage);
    setWebauthnSupport(support);
    setPasskeyRecord(savedPasskey);
    setLockEnabled(Boolean(savedLockEnabled));
  }

  async function handleSaveApiKey() {
    setSettingsBusy(true);
    try {
      const next = apiKeyInput.trim();
      await setSetting('market.twelveDataApiKey', next);
      onMarketApiKeyChange(next);
      setSettingsStatus(next ? 'Key saved. Screens reload live data on next open.' : 'Key cleared.');
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleSaveGeminiKey() {
    setSettingsBusy(true);
    try {
      const next = geminiKeyInput.trim();
      await setSetting('ai.geminiApiKey', next);
      onGeminiApiKeyChange(next);
      setSettingsStatus(next ? 'Gemini key saved.' : 'Gemini key cleared.');
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleRequestPersistence() {
    setStorageBusy(true);
    const granted = await requestStoragePersistence();
    const snapshot = await getStorageSnapshot();
    setStorageSnapshot(snapshot);
    setSettingsStatus(granted ? 'Persistent storage on.' : 'Persistent storage not granted.');
    setStorageBusy(false);
  }

  async function handleRegisterPasskey() {
    setPasskeyBusy(true);
    try {
      const record = await registerLocalPasskey('This device');
      await saveLocalPasskeyCredential(record);
      await setSetting('security.passkeyGateEnabled', true);
      setPasskeyRecord(record);
      setLockEnabled(true);
      setPasskeyStatus('Passkey registered.');
    } catch (e) {
      setPasskeyStatus(e instanceof Error ? e.message : 'Passkey registration failed.');
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function handleTestPasskey() {
    if (!passkeyRecord) return;
    setPasskeyBusy(true);
    try {
      await authenticateLocalPasskey(passkeyRecord);
      setPasskeyStatus('Passkey accepted.');
    } catch (e) {
      setPasskeyStatus(e instanceof Error ? e.message : 'Passkey authentication failed.');
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function handleToggleLock(enabled: boolean) {
    setLockEnabled(enabled);
    await setSetting('security.passkeyGateEnabled', enabled);
  }

  return (
    <section className="screen">
      {/* Market data */}
      <article className="card form-card">
        <div className="card__header">
          <span className="eyebrow">Market data</span>
        </div>
        <label className="field">
          <span>Twelve Data API key</span>
          <input
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="Paste key from dashboard"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <div className="setup-list">
          <p className="subtle-copy">
            Free tier is enough — the app only refreshes when you open{' '}
            <code>positions</code> or <code>research</code>.
          </p>
          <p className="subtle-copy">1. Create a free Twelve Data account.</p>
          <p className="subtle-copy">2. Copy your API key from the dashboard.</p>
          <p className="subtle-copy">3. Paste it here. The key stays on this device only.</p>
          <div className="link-row">
            <a className="text-link" href="https://twelvedata.com/" target="_blank" rel="noreferrer">
              Get API key
            </a>
            <a className="text-link" href="https://twelvedata.com/docs" target="_blank" rel="noreferrer">
              Docs
            </a>
          </div>
          <p className="subtle-copy">Data provided by Twelve Data.</p>
        </div>
        <button
          className="button button--primary"
          type="button"
          onClick={handleSaveApiKey}
          disabled={settingsBusy}
        >
          Save key
        </button>
      </article>

      {/* AI research */}
      <article className="card form-card">
        <div className="card__header">
          <span className="eyebrow">AI research</span>
        </div>
        <label className="field">
          <span>Gemini API key</span>
          <input
            value={geminiKeyInput}
            onChange={(e) => setGeminiKeyInput(e.target.value)}
            placeholder="Paste key from AI Studio"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <div className="setup-list">
          <p className="subtle-copy">
            Used to pull a grounded sentiment summary when you search a stock in Research.
            Free tier is enough — one call per symbol lookup.
          </p>
          <p className="subtle-copy">1. Go to Google AI Studio and sign in.</p>
          <p className="subtle-copy">2. Create an API key (free, no billing required).</p>
          <p className="subtle-copy">3. Paste it here. The key stays on this device only.</p>
          <div className="link-row">
            <a className="text-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              Get API key
            </a>
            <a className="text-link" href="https://ai.google.dev/gemini-api/docs" target="_blank" rel="noreferrer">
              Docs
            </a>
          </div>
        </div>
        <button
          className="button button--primary"
          type="button"
          onClick={handleSaveGeminiKey}
          disabled={settingsBusy}
        >
          Save key
        </button>
      </article>

      {/* App lock */}
      <details className="card drawer drawer--card" onToggle={loadDeviceInfo}>
        <summary style={{ padding: '0.85rem 1rem' }}>
          <div className="card__header" style={{ display: 'inline-flex', gap: '0.85rem' }}>
            <span className="eyebrow">App lock</span>
            {passkeyRecord ? (
              <button
                className={`chip${lockEnabled ? ' chip--active' : ''}`}
                type="button"
                onClick={(e) => { e.preventDefault(); void handleToggleLock(!lockEnabled); }}
              >
                {lockEnabled ? 'On' : 'Off'}
              </button>
            ) : null}
          </div>
        </summary>
        <div className="stack" style={{ padding: '0 1rem 1rem' }}>
          {!webauthnSupport ? (
            <p className="subtle-copy">Loading…</p>
          ) : !webauthnSupport.supported || webauthnSupport.platformAuthenticator === false ? (
            <p className="subtle-copy">Platform passkeys are not available here.</p>
          ) : passkeyRecord ? (
            <>
              <p className="subtle-copy">Unlock with the device passkey.</p>
              <button className="button" type="button" onClick={handleTestPasskey} disabled={passkeyBusy}>
                Test unlock
              </button>
            </>
          ) : (
            <button
              className="button button--primary"
              type="button"
              onClick={handleRegisterPasskey}
              disabled={passkeyBusy}
            >
              Enable Face ID / Touch ID
            </button>
          )}
          {passkeyStatus ? <p className="status-line">{passkeyStatus}</p> : null}
        </div>
      </details>

      {/* Device storage */}
      <details className="card drawer drawer--card" onToggle={loadDeviceInfo}>
        <summary style={{ padding: '0.85rem 1rem' }}>
          <span className="eyebrow">Device storage</span>
        </summary>
        <div className="stack" style={{ padding: '0 1rem 1rem' }}>
          {storageSnapshot ? (
            <>
              <div className="device-row">
                <span>Used</span>
                <strong>{formatBytes(storageSnapshot.usage)}</strong>
              </div>
              <div className="device-row">
                <span>Quota</span>
                <strong>{formatBytes(storageSnapshot.quota)}</strong>
              </div>
              <div className="device-row">
                <span>Persistent</span>
                <strong>{storageSnapshot.persisted ? 'On' : 'Off'}</strong>
              </div>
              <button
                className="button"
                type="button"
                onClick={handleRequestPersistence}
                disabled={storageBusy}
              >
                Keep data on device
              </button>
            </>
          ) : (
            <p className="subtle-copy">Open to check storage.</p>
          )}
        </div>
      </details>

      {settingsStatus ? <p className="status-line">{settingsStatus}</p> : null}
    </section>
  );
}
