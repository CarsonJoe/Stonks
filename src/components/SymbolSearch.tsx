import { useEffect, useRef, useState, type FormEvent } from 'react';
import { fetchMarketSymbolSearch } from '../lib/market';
import {
  dedupeResearchSuggestions,
  findAliasMatches,
  findExactAlias,
  type ResearchIdentity,
  type ResearchSuggestion
} from '../lib/research';
import { normalizeSearchText, normalizeSymbol } from '../lib/utils';

interface SymbolSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (identity: ResearchIdentity) => void;
  marketApiKey: string;
  submitLabel?: string;
  placeholder?: string;
  /** If true, suppress the submit button and submit on selection */
  inline?: boolean;
}

export function SymbolSearch({
  value,
  onChange,
  onSelect,
  marketApiKey,
  submitLabel = 'Go',
  placeholder = 'Search company or ticker',
  inline = false
}: SymbolSearchProps) {
  const [suggestions, setSuggestions] = useState<ResearchSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const cancelRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced live search
  useEffect(() => {
    if (cancelRef.current) clearTimeout(cancelRef.current);

    const query = value.trim();
    const aliasMatches = findAliasMatches(query);

    if (query.length < 2) {
      setSuggestions(aliasMatches);
      setSearching(false);
      return;
    }

    if (!marketApiKey.trim()) {
      setSuggestions(aliasMatches);
      setSearching(false);
      return;
    }

    let cancelled = false;
    cancelRef.current = setTimeout(async () => {
      setSearching(true);
      const result = await fetchMarketSymbolSearch({
        query,
        token: marketApiKey,
        outputsize: 6
      });

      if (cancelled) return;

      const remote = result.results.map(
        (r): ResearchSuggestion => ({ ...r, source: 'search' })
      );
      setSuggestions(dedupeResearchSuggestions([...aliasMatches, ...remote]));
      setSearching(false);
    }, 280);

    return () => {
      cancelled = true;
      if (cancelRef.current) clearTimeout(cancelRef.current);
    };
  }, [value, marketApiKey]);

  function applySelection(identity: ResearchIdentity) {
    onChange(identity.instrumentName || identity.symbol);
    setSuggestions([]);
    onSelect(identity);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = value.trim();
    if (!query) return;

    const aliasMatch = findExactAlias(query);
    if (aliasMatch) {
      applySelection(aliasMatch);
      return;
    }

    const normalizedQuery = normalizeSearchText(query);
    const exactSuggestion =
      suggestions.find(
        (s) =>
          s.symbol.toLowerCase() === normalizeSymbol(query).toLowerCase() ||
          normalizeSearchText(s.instrumentName ?? '') === normalizedQuery
      ) ??
      (!/^[A-Z./-]{1,8}$/.test(normalizeSymbol(query)) ? suggestions[0] : null);

    if (exactSuggestion) {
      applySelection(exactSuggestion);
      return;
    }

    applySelection({
      symbol: normalizeSymbol(query),
      instrumentName: null,
      exchange: null,
      micCode: null,
      exchangeTimezone: null,
      instrumentType: null,
      country: null,
      currency: null
    });
  }

  const hasSuggestions = suggestions.length > 0;

  return (
    <form
      className={`search-bar${!inline ? ' search-bar--research' : ' search-bar--inline'}`}
      onSubmit={handleSubmit}
    >
      <div className="search-bar__stack">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoCapitalize="off"
          autoCorrect="off"
        />

        {hasSuggestions ? (
          <div className="search-results">
            {suggestions.slice(0, 6).map((s) => (
              <button
                key={`${s.symbol}-${s.micCode ?? s.exchange ?? s.source}`}
                className="search-result"
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySelection(s);
                }}
              >
                <div className="search-result__copy">
                  <strong>{s.symbol}</strong>
                  <span>{s.instrumentName ?? 'Unknown company'}</span>
                </div>
                <span className="search-result__meta">
                  {s.exchange ?? s.country ?? s.source}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!inline ? (
        <button className="button button--primary" type="submit">
          {searching ? '…' : submitLabel}
        </button>
      ) : null}
    </form>
  );
}
