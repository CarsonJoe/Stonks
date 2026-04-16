import Dexie, { type Table } from 'dexie';
import type { LocalPasskeyCredential } from './lib/webauthn';

export type ThesisStatus = 'watch' | 'active' | 'closed';
export type ThesisStance = 'long' | 'short' | 'pair';
export type AssumptionStatus = 'holding' | 'weaker' | 'broken' | 'unknown';
export type TradeSide = 'buy' | 'sell';
export type ReviewKind = 'entry' | 'checkin' | 'exit';

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
  stance: ThesisStance;
  summary: string;
  invalidation: string;
  timeHorizon: string;
  benchmark: string;
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

export interface MarketSnapshotRecord {
  id: string;
  symbol: string;
  source: string;
  capturedAt: string;
  payload: unknown;
}

export interface FoundationCounts {
  theses: number;
  assumptions: number;
  trades: number;
  reviews: number;
  marketSnapshots: number;
}

export interface CreateThesisInput {
  title: string;
  symbol: string;
  status: ThesisStatus;
  stance: ThesisStance;
  summary: string;
  invalidation: string;
  timeHorizon: string;
  benchmark: string;
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
  | {
      id: string;
      kind: 'thesis';
      occurredAt: string;
      thesis: ThesisRecord;
    }
  | {
      id: string;
      kind: 'assumption';
      occurredAt: string;
      assumption: AssumptionRecord;
    }
  | {
      id: string;
      kind: 'trade';
      occurredAt: string;
      trade: TradeRecord;
    }
  | {
      id: string;
      kind: 'review';
      occurredAt: string;
      review: ReviewRecord;
    };

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

class StonksDatabase extends Dexie {
  settings!: Table<SettingRecord, string>;
  theses!: Table<ThesisRecord, string>;
  assumptions!: Table<AssumptionRecord, string>;
  trades!: Table<TradeRecord, string>;
  reviews!: Table<ReviewRecord, string>;
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
  }
}

export const db = new StonksDatabase();

const now = () => new Date().toISOString();

function sortByNewest<T extends { occurredAt?: string; createdAt?: string; updatedAt?: string }>(
  items: T[]
) {
  return [...items].sort((left, right) => {
    const leftDate = left.occurredAt ?? left.createdAt ?? left.updatedAt ?? '';
    const rightDate = right.occurredAt ?? right.createdAt ?? right.updatedAt ?? '';
    return rightDate.localeCompare(leftDate);
  });
}

function sanitizeThesis(record: ThesisRecord): ThesisRecord {
  return {
    ...record,
    stance: record.stance ?? 'long',
    summary: record.summary ?? '',
    invalidation: record.invalidation ?? '',
    timeHorizon: record.timeHorizon ?? '',
    benchmark: record.benchmark ?? ''
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
      continue;
    }

    totalSoldQuantity += trade.quantity;
    grossSellProceeds += grossValue - trade.fees;
  }

  return {
    totalBoughtQuantity,
    totalSoldQuantity,
    openQuantity: totalBoughtQuantity - totalSoldQuantity,
    grossBuyCost,
    grossSellProceeds,
    totalFees,
    averageBuyPrice:
      totalBoughtQuantity > 0 ? grossBuyCost / totalBoughtQuantity : null
  };
}

export async function getSetting<T>(key: string) {
  const setting = await db.settings.get(key);
  return setting?.value as T | undefined;
}

export async function setSetting<T>(key: string, value: T) {
  await db.settings.put({
    key,
    value,
    updatedAt: now()
  });
}

export async function getFoundationCounts(): Promise<FoundationCounts> {
  const [theses, assumptions, trades, reviews, marketSnapshots] = await Promise.all([
    db.theses.count(),
    db.assumptions.count(),
    db.trades.count(),
    db.reviews.count(),
    db.marketSnapshots.count()
  ]);

  return {
    theses,
    assumptions,
    trades,
    reviews,
    marketSnapshots
  };
}

export async function createThesisEntry(input: CreateThesisInput) {
  const thesisId = crypto.randomUUID();
  const createdAt = now();

  const thesis: ThesisRecord = {
    id: thesisId,
    title: input.title.trim(),
    symbol: input.symbol.trim().toUpperCase(),
    status: input.status,
    stance: input.stance,
    summary: input.summary.trim(),
    invalidation: input.invalidation.trim(),
    timeHorizon: input.timeHorizon.trim(),
    benchmark: input.benchmark.trim(),
    createdAt,
    updatedAt: createdAt
  };

  await db.transaction(
    'rw',
    db.theses,
    db.assumptions,
    db.trades,
    db.reviews,
    async () => {
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
        await db.trades.add({
          id: crypto.randomUUID(),
          thesisId,
          symbol: thesis.symbol,
          side: input.initialTrade.side,
          quantity: input.initialTrade.quantity,
          price: input.initialTrade.price,
          fees: input.initialTrade.fees,
          occurredAt: input.initialTrade.occurredAt,
          notes: input.initialTrade.notes?.trim(),
          createdAt,
          updatedAt: createdAt
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
    }
  );

  return thesisId;
}

export async function addTradeToThesis(input: AddTradeInput) {
  const createdAt = now();
  const thesis = await db.theses.get(input.thesisId);

  if (!thesis) {
    throw new Error('The thesis no longer exists.');
  }

  await db.transaction('rw', db.theses, db.trades, async () => {
    await db.trades.add({
      id: crypto.randomUUID(),
      thesisId: input.thesisId,
      symbol: thesis.symbol,
      side: input.side,
      quantity: input.quantity,
      price: input.price,
      fees: input.fees,
      occurredAt: input.occurredAt,
      notes: input.notes?.trim(),
      createdAt,
      updatedAt: createdAt
    });

    await db.theses.update(input.thesisId, {
      updatedAt: createdAt
    });
  });
}

export async function addAssumptionToThesis(input: AddAssumptionInput) {
  const createdAt = now();
  const thesis = await db.theses.get(input.thesisId);

  if (!thesis) {
    throw new Error('The thesis no longer exists.');
  }

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

    await db.theses.update(input.thesisId, {
      updatedAt: createdAt
    });
  });
}

export async function addReviewToThesis(input: AddReviewInput) {
  const createdAt = now();
  const thesis = await db.theses.get(input.thesisId);

  if (!thesis) {
    throw new Error('The thesis no longer exists.');
  }

  await db.transaction('rw', db.theses, db.reviews, async () => {
    await db.reviews.add({
      id: crypto.randomUUID(),
      thesisId: input.thesisId,
      kind: input.kind,
      summary: input.summary.trim(),
      conviction: input.conviction,
      createdAt
    });

    await db.theses.update(input.thesisId, {
      updatedAt: createdAt
    });
  });
}

export async function listThesisSnapshots(): Promise<ThesisSnapshot[]> {
  const theses = (await db.theses.orderBy('updatedAt').reverse().toArray()).map(sanitizeThesis);

  if (theses.length === 0) {
    return [];
  }

  const thesisIds = theses.map((thesis) => thesis.id);

  const [assumptions, trades, reviews] = await Promise.all([
    db.assumptions.where('thesisId').anyOf(thesisIds).toArray(),
    db.trades.where('thesisId').anyOf(thesisIds).toArray(),
    db.reviews.where('thesisId').anyOf(thesisIds).toArray()
  ]);

  return theses.map((thesis) => {
    const thesisAssumptions = sortByNewest(
      assumptions.filter((assumption) => assumption.thesisId === thesis.id)
    );
    const thesisTrades = sortByNewest(
      trades.filter((trade) => trade.thesisId === thesis.id)
    );
    const thesisReviews = sortByNewest(
      reviews.filter((review) => review.thesisId === thesis.id)
    );

    const timeline = [
      {
        id: `thesis-${thesis.id}`,
        kind: 'thesis',
        occurredAt: thesis.createdAt,
        thesis
      } satisfies ThesisTimelineEvent,
      ...thesisAssumptions.map(
        (assumption) =>
          ({
            id: assumption.id,
            kind: 'assumption',
            occurredAt: assumption.updatedAt,
            assumption
          }) satisfies ThesisTimelineEvent
      ),
      ...thesisTrades.map(
        (trade) =>
          ({
            id: trade.id,
            kind: 'trade',
            occurredAt: trade.occurredAt,
            trade
          }) satisfies ThesisTimelineEvent
      ),
      ...thesisReviews.map(
        (review) =>
          ({
            id: review.id,
            kind: 'review',
            occurredAt: review.createdAt,
            review
          }) satisfies ThesisTimelineEvent
      )
    ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

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

export async function seedFoundationEntries() {
  const thesisId = await createThesisEntry({
    title: 'Risk sleeve momentum thesis',
    symbol: 'AAPL',
    status: 'active',
    stance: 'long',
    summary:
      'Using a starter position to validate the local thesis pipeline before real trade logging starts.',
    invalidation: 'Cut the setup if revisions stall and the thesis turns into pure hope.',
    timeHorizon: '6-12 months',
    benchmark: 'SPY + CPIAUCSL',
    initialAssumption: {
      statement:
        'Consumer demand remains resilient enough to support upside revisions.',
      status: 'holding',
      weight: 8
    },
    initialTrade: {
      side: 'buy',
      quantity: 8,
      price: 196.32,
      fees: 0,
      occurredAt: now(),
      notes: 'Seed record for the local data pipeline.'
    },
    initialReview: {
      kind: 'entry',
      summary: 'Initial thesis entry created to validate storage and timelines.',
      conviction: 63
    }
  });

  return thesisId;
}

export async function saveMarketSnapshot(
  symbol: string,
  source: string,
  payload: unknown
) {
  await db.marketSnapshots.put({
    id: crypto.randomUUID(),
    symbol,
    source,
    payload,
    capturedAt: now()
  });
}

export async function getLocalPasskeyCredential() {
  return (await getSetting<LocalPasskeyCredential>('security.localPasskey')) ?? null;
}

export async function saveLocalPasskeyCredential(record: LocalPasskeyCredential) {
  await setSetting('security.localPasskey', record);
}
