import Dexie, { type Table } from 'dexie';
import type { LocalPasskeyCredential } from './lib/webauthn';

export type ThesisStatus = 'watch' | 'active' | 'closed';
export type ThesisDirection = 'long' | 'short';
export type AssumptionStatus = 'holding' | 'weaker' | 'broken' | 'unknown';
export type TradeSide = 'buy' | 'sell';
export type ReviewKind = 'entry' | 'checkin' | 'exit';
export type NotificationKind = 'weekly' | 'quartile';

export interface SettingRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: string;
}

export interface ThesisRecord {
  id: string;
  title: string;
  symbol: string;
  status: ThesisStatus;
  direction: ThesisDirection;
  /** 0–100 confidence in the thesis playing out. */
  conviction: number;
  summary: string;
  invalidation?: string;
  timeHorizon?: string;
  /** Target return at maturity as a decimal, e.g. 0.40 = +40%. */
  destination?: number;
  /** Thesis duration in days, e.g. 365 = 1 year. */
  durationDays?: number;
  /** Std dev of expected return at maturity as a decimal, e.g. 0.20 = ±20%. */
  errorBand?: number;
  /** Symbol used as primary benchmark, e.g. "QQQ", "SPY", "SOXX". */
  benchmarkSymbol: string;
  /** Price of the benchmark at thesis creation time (for alpha calculation). */
  benchmarkEntryPrice?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssumptionRecord {
  id: string;
  thesisId: string;
  statement: string;
  status: AssumptionStatus;
  weight: number;
  createdAt: string;
  updatedAt: string;
}

export interface TradeRecord {
  id: string;
  thesisId?: string;
  symbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  fees: number;
  occurredAt: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRecord {
  id: string;
  thesisId: string;
  kind: ReviewKind;
  summary: string;
  conviction: number;
  createdAt: string;
}

export interface NotificationRuleRecord {
  id: string;
  thesisId: string;
  kind: NotificationKind;
  /** Only set for 'weekly' kind — ISO timestamp of last trigger. */
  lastTriggeredAt?: string;
  createdAt: string;
}

export interface MarketSnapshotRecord {
  id: string;
  symbol: string;
  source: string;
  capturedAt: string;
  payload: unknown;
}

export interface CreateThesisInput {
  title?: string;
  symbol: string;
  status?: ThesisStatus;
  direction?: ThesisDirection;
  conviction?: number;
  summary: string;
  invalidation?: string;
  timeHorizon?: string;
  destination?: number;
  durationDays?: number;
  errorBand?: number;
  benchmarkSymbol?: string;
  benchmarkEntryPrice?: number;
  initialAssumption?: {
    statement: string;
    status: AssumptionStatus;
    weight: number;
  };
  initialTrade?: {
    side: TradeSide;
    quantity: number;
    price: number;
    fees: number;
    occurredAt: string;
    notes?: string;
  };
  initialReview?: {
    kind: ReviewKind;
    summary: string;
    conviction: number;
  };
}

export interface AddTradeInput {
  thesisId: string;
  side: TradeSide;
  quantity: number;
  price: number;
  fees: number;
  occurredAt: string;
  notes?: string;
}

export interface AddAssumptionInput {
  thesisId: string;
  statement: string;
  status: AssumptionStatus;
  weight: number;
}

export interface AddReviewInput {
  thesisId: string;
  kind: ReviewKind;
  summary: string;
  conviction: number;
}

export type ThesisTimelineEvent =
  | { id: string; kind: 'thesis'; occurredAt: string; thesis: ThesisRecord }
  | { id: string; kind: 'assumption'; occurredAt: string; assumption: AssumptionRecord }
  | { id: string; kind: 'trade'; occurredAt: string; trade: TradeRecord }
  | { id: string; kind: 'review'; occurredAt: string; review: ReviewRecord };

export interface ThesisMetrics {
  totalBoughtQuantity: number;
  totalSoldQuantity: number;
  openQuantity: number;
  grossBuyCost: number;
  grossSellProceeds: number;
  totalFees: number;
  averageBuyPrice: number | null;
}

export interface ThesisSnapshot {
  thesis: ThesisRecord;
  assumptions: AssumptionRecord[];
  trades: TradeRecord[];
  reviews: ReviewRecord[];
  timeline: ThesisTimelineEvent[];
  metrics: ThesisMetrics;
}

// ── Database ───────────────────────────────────────────────────────────────────

class StonksDatabase extends Dexie {
  settings!: Table<SettingRecord, string>;
  theses!: Table<ThesisRecord, string>;
  assumptions!: Table<AssumptionRecord, string>;
  trades!: Table<TradeRecord, string>;
  reviews!: Table<ReviewRecord, string>;
  notificationRules!: Table<NotificationRuleRecord, string>;
  marketSnapshots!: Table<MarketSnapshotRecord, string>;

  constructor() {
    super('stonks');

    this.version(1).stores({
      settings: 'key, updatedAt',
      theses: 'id, symbol, status, updatedAt',
      assumptions: 'id, thesisId, status, updatedAt',
      trades: 'id, thesisId, symbol, occurredAt',
      reviews: 'id, thesisId, createdAt',
      marketSnapshots: 'id, symbol, source, capturedAt'
    });

    this.version(2).stores({
      settings: 'key, updatedAt',
      theses: 'id, symbol, status, stance, updatedAt, createdAt',
      assumptions: 'id, thesisId, status, updatedAt, createdAt',
      trades: 'id, thesisId, symbol, side, occurredAt',
      reviews: 'id, thesisId, kind, createdAt',
      marketSnapshots: 'id, symbol, source, capturedAt'
    });

    this.version(3)
      .stores({
        settings: 'key, updatedAt',
        theses: 'id, symbol, status, direction, updatedAt, createdAt',
        assumptions: 'id, thesisId, status, updatedAt, createdAt',
        trades: 'id, thesisId, symbol, side, occurredAt',
        reviews: 'id, thesisId, kind, createdAt',
        notificationRules: 'id, thesisId, kind, createdAt',
        marketSnapshots: 'id, symbol, source, capturedAt'
      })
      .upgrade((tx) => {
        // Migrate existing theses: add direction field (default long), conviction (default 50)
        return tx
          .table('theses')
          .toCollection()
          .modify((thesis: ThesisRecord & { stance?: string }) => {
            if (!thesis.direction) {
              thesis.direction = (thesis.stance as ThesisDirection) === 'short' ? 'short' : 'long';
            }
            if (thesis.conviction === undefined || thesis.conviction === null) {
              thesis.conviction = 50;
            }
            if (!thesis.benchmarkSymbol) {
              thesis.benchmarkSymbol = 'SPY';
            }
          });
      });

    this.version(4)
      .stores({
        settings: 'key, updatedAt',
        theses: 'id, symbol, status, direction, updatedAt, createdAt',
        assumptions: 'id, thesisId, status, updatedAt, createdAt',
        trades: 'id, thesisId, symbol, side, occurredAt',
        reviews: 'id, thesisId, kind, createdAt',
        notificationRules: 'id, thesisId, kind, createdAt',
        marketSnapshots: 'id, symbol, source, capturedAt'
      })
      .upgrade((tx) => {
        // Migrate: targetReturn → destination, errorMargin → errorBand, default durationDays
        type OldThesis = ThesisRecord & { targetReturn?: number; errorMargin?: number };
        return tx
          .table('theses')
          .toCollection()
          .modify((thesis: OldThesis) => {
            if (thesis.destination === undefined && typeof thesis.targetReturn === 'number') {
              thesis.destination = thesis.targetReturn;
            }
            if (thesis.errorBand === undefined && typeof thesis.errorMargin === 'number') {
              thesis.errorBand = thesis.errorMargin;
            }
            if (thesis.durationDays === undefined && thesis.destination !== undefined) {
              thesis.durationDays = 365;
            }
          });
      });
  }
}

export const db = new StonksDatabase();

// ── Helpers ────────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

function compactText(value?: string | null) {
  const next = value?.trim();
  return next ? next : undefined;
}

function sortByNewest<T extends { occurredAt?: string; createdAt?: string; updatedAt?: string }>(
  items: T[]
) {
  return [...items].sort((a, b) => {
    const aDate = a.occurredAt ?? a.createdAt ?? a.updatedAt ?? '';
    const bDate = b.occurredAt ?? b.createdAt ?? b.updatedAt ?? '';
    return bDate.localeCompare(aDate);
  });
}

function sanitizeThesis(record: ThesisRecord & { stance?: string }): ThesisRecord {
  return {
    ...record,
    direction: record.direction ?? ((record.stance as ThesisDirection) === 'short' ? 'short' : 'long'),
    conviction: record.conviction ?? 50,
    benchmarkSymbol: record.benchmarkSymbol ?? 'QQQ',
    summary: record.summary ?? '',
    invalidation: record.invalidation ?? '',
    timeHorizon: record.timeHorizon ?? ''
  };
}

function buildMetrics(trades: TradeRecord[]): ThesisMetrics {
  let totalBoughtQuantity = 0;
  let totalSoldQuantity = 0;
  let grossBuyCost = 0;
  let grossSellProceeds = 0;
  let totalFees = 0;

  for (const trade of trades) {
    const grossValue = trade.quantity * trade.price;
    totalFees += trade.fees;

    if (trade.side === 'buy') {
      totalBoughtQuantity += trade.quantity;
      grossBuyCost += grossValue + trade.fees;
    } else {
      totalSoldQuantity += trade.quantity;
      grossSellProceeds += grossValue - trade.fees;
    }
  }

  return {
    totalBoughtQuantity,
    totalSoldQuantity,
    openQuantity: totalBoughtQuantity - totalSoldQuantity,
    grossBuyCost,
    grossSellProceeds,
    totalFees,
    averageBuyPrice: totalBoughtQuantity > 0 ? grossBuyCost / totalBoughtQuantity : null
  };
}

// ── Settings ───────────────────────────────────────────────────────────────────

export async function getSetting<T>(key: string) {
  const setting = await db.settings.get(key);
  return setting?.value as T | undefined;
}

export async function setSetting<T>(key: string, value: T) {
  await db.settings.put({ key, value, updatedAt: now() });
}

// ── Thesis CRUD ────────────────────────────────────────────────────────────────

export async function createThesisEntry(input: CreateThesisInput) {
  const thesisId = crypto.randomUUID();
  const createdAt = now();
  const symbol = input.symbol.trim().toUpperCase();
  const summary = input.summary.trim();
  const title = compactText(input.title) ?? `${symbol} thesis`;

  const thesis: ThesisRecord = {
    id: thesisId,
    title,
    symbol,
    status: input.status ?? 'active',
    direction: input.direction ?? 'long',
    conviction: input.conviction ?? 50,
    summary,
    benchmarkSymbol: input.benchmarkSymbol ?? 'QQQ',
    createdAt,
    updatedAt: createdAt,
    ...(compactText(input.invalidation) ? { invalidation: compactText(input.invalidation) } : {}),
    ...(compactText(input.timeHorizon) ? { timeHorizon: compactText(input.timeHorizon) } : {}),
    ...(typeof input.destination === 'number' ? { destination: input.destination } : {}),
    ...(typeof input.durationDays === 'number' ? { durationDays: input.durationDays } : {}),
    ...(typeof input.errorBand === 'number' ? { errorBand: input.errorBand } : {}),
    ...(typeof input.benchmarkEntryPrice === 'number'
      ? { benchmarkEntryPrice: input.benchmarkEntryPrice }
      : {})
  };

  await db.transaction('rw', db.theses, db.assumptions, db.trades, db.reviews, async () => {
    await db.theses.add(thesis);

    if (input.initialAssumption?.statement.trim()) {
      await db.assumptions.add({
        id: crypto.randomUUID(),
        thesisId,
        statement: input.initialAssumption.statement.trim(),
        status: input.initialAssumption.status,
        weight: input.initialAssumption.weight,
        createdAt,
        updatedAt: createdAt
      });
    }

    if (input.initialTrade) {
      const notes = compactText(input.initialTrade.notes);
      await db.trades.add({
        id: crypto.randomUUID(),
        thesisId,
        symbol: thesis.symbol,
        side: input.initialTrade.side,
        quantity: input.initialTrade.quantity,
        price: input.initialTrade.price,
        fees: input.initialTrade.fees,
        occurredAt: input.initialTrade.occurredAt,
        createdAt,
        updatedAt: createdAt,
        ...(notes ? { notes } : {})
      });
    }

    if (input.initialReview?.summary.trim()) {
      await db.reviews.add({
        id: crypto.randomUUID(),
        thesisId,
        kind: input.initialReview.kind,
        summary: input.initialReview.summary.trim(),
        conviction: input.initialReview.conviction,
        createdAt
      });
    }
  });

  return thesisId;
}

export async function addTradeToThesis(input: AddTradeInput) {
  const createdAt = now();
  const thesis = await db.theses.get(input.thesisId);
  if (!thesis) throw new Error('The thesis no longer exists.');

  await db.transaction('rw', db.theses, db.trades, async () => {
    const notes = compactText(input.notes);
    await db.trades.add({
      id: crypto.randomUUID(),
      thesisId: input.thesisId,
      symbol: thesis.symbol,
      side: input.side,
      quantity: input.quantity,
      price: input.price,
      fees: input.fees,
      occurredAt: input.occurredAt,
      createdAt,
      updatedAt: createdAt,
      ...(notes ? { notes } : {})
    });
    await db.theses.update(input.thesisId, { updatedAt: createdAt });
  });
}

export async function addAssumptionToThesis(input: AddAssumptionInput) {
  const createdAt = now();
  const thesis = await db.theses.get(input.thesisId);
  if (!thesis) throw new Error('The thesis no longer exists.');

  await db.transaction('rw', db.theses, db.assumptions, async () => {
    await db.assumptions.add({
      id: crypto.randomUUID(),
      thesisId: input.thesisId,
      statement: input.statement.trim(),
      status: input.status,
      weight: input.weight,
      createdAt,
      updatedAt: createdAt
    });
    await db.theses.update(input.thesisId, { updatedAt: createdAt });
  });
}

export async function addReviewToThesis(input: AddReviewInput) {
  const createdAt = now();
  const thesis = await db.theses.get(input.thesisId);
  if (!thesis) throw new Error('The thesis no longer exists.');

  await db.transaction('rw', db.theses, db.reviews, async () => {
    await db.reviews.add({
      id: crypto.randomUUID(),
      thesisId: input.thesisId,
      kind: input.kind,
      summary: input.summary.trim(),
      conviction: input.conviction,
      createdAt
    });
    await db.theses.update(input.thesisId, { updatedAt: createdAt });
  });
}

export async function listThesisSnapshots(): Promise<ThesisSnapshot[]> {
  const theses = (await db.theses.orderBy('updatedAt').reverse().toArray()).map(sanitizeThesis);
  if (theses.length === 0) return [];

  const thesisIds = theses.map((t) => t.id);
  const [assumptions, trades, reviews] = await Promise.all([
    db.assumptions.where('thesisId').anyOf(thesisIds).toArray(),
    db.trades.where('thesisId').anyOf(thesisIds).toArray(),
    db.reviews.where('thesisId').anyOf(thesisIds).toArray()
  ]);

  return theses.map((thesis) => {
    const thesisAssumptions = sortByNewest(
      assumptions.filter((a) => a.thesisId === thesis.id)
    );
    const thesisTrades = sortByNewest(trades.filter((t) => t.thesisId === thesis.id));
    const thesisReviews = sortByNewest(reviews.filter((r) => r.thesisId === thesis.id));

    const timeline: ThesisTimelineEvent[] = [
      { id: `thesis-${thesis.id}`, kind: 'thesis' as const, occurredAt: thesis.createdAt, thesis },
      ...thesisAssumptions.map((a) => ({
        id: a.id, kind: 'assumption' as const, occurredAt: a.updatedAt, assumption: a
      })),
      ...thesisTrades.map((t) => ({
        id: t.id, kind: 'trade' as const, occurredAt: t.occurredAt, trade: t
      })),
      ...thesisReviews.map((r) => ({
        id: r.id, kind: 'review' as const, occurredAt: r.createdAt, review: r
      }))
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

    return {
      thesis,
      assumptions: thesisAssumptions,
      trades: thesisTrades,
      reviews: thesisReviews,
      timeline,
      metrics: buildMetrics(thesisTrades)
    };
  });
}

// ── Notification rules ─────────────────────────────────────────────────────────

export async function listNotificationRules(): Promise<NotificationRuleRecord[]> {
  return db.notificationRules.toArray();
}

export async function upsertNotificationRule(
  thesisId: string,
  kind: NotificationKind
): Promise<void> {
  const existing = await db.notificationRules
    .where('thesisId').equals(thesisId)
    .filter((r) => r.kind === kind)
    .first();

  if (!existing) {
    await db.notificationRules.add({
      id: crypto.randomUUID(),
      thesisId,
      kind,
      createdAt: now()
    });
  }
}

export async function deleteNotificationRule(id: string): Promise<void> {
  await db.notificationRules.delete(id);
}

export async function markNotificationTriggered(id: string): Promise<void> {
  await db.notificationRules.update(id, { lastTriggeredAt: now() });
}

// ── Passkey helpers ────────────────────────────────────────────────────────────

export async function getLocalPasskeyCredential() {
  return (await getSetting<LocalPasskeyCredential>('security.localPasskey')) ?? null;
}

export async function saveLocalPasskeyCredential(record: LocalPasskeyCredential) {
  await setSetting('security.localPasskey', record);
}

// ── Market snapshots ───────────────────────────────────────────────────────────

export async function saveMarketSnapshot(symbol: string, source: string, payload: unknown) {
  await db.marketSnapshots.put({
    id: crypto.randomUUID(),
    symbol,
    source,
    payload,
    capturedAt: now()
  });
}
