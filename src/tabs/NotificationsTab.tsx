import { useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import {
  deleteNotificationRule,
  listNotificationRules,
  markNotificationTriggered,
  upsertNotificationRule,
  type NotificationRuleRecord,
  type ThesisSnapshot
} from '../db';
import {
  distributionQuartiles,
  formatCurrency,
  formatPercent,
  normalPercentile,
  thesisDistributionAtTime
} from '../lib/utils';

interface NotificationsTabProps {
  snapshots: ThesisSnapshot[];
  benchmarkCurrentPrice: number | null;
  onNavigateToNew: () => void;
  onNavigateToPositions: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Best available current return for a thesis (uses most recent trade price as proxy). */
function estimateCurrentReturn(snapshot: ThesisSnapshot): number | null {
  const { metrics, trades } = snapshot;
  if (metrics.averageBuyPrice === null || metrics.averageBuyPrice === 0) return null;
  if (trades.length === 0) return null;
  const sorted = [...trades].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const latestPrice = sorted[0].price;
  return (latestPrice - metrics.averageBuyPrice) / metrics.averageBuyPrice;
}

function daysSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
}

// ── Notification card ─────────────────────────────────────────────────────────

function NotificationCard({
  title,
  subtitle,
  detail,
  kind,
  onDismiss
}: {
  title: string;
  subtitle: string;
  detail: string;
  kind: 'alert' | 'review' | 'info';
  onDismiss?: () => void;
}) {
  return (
    <div className={`notification-card notification-card--${kind}`}>
      <div className="notification-card__body">
        <strong>{title}</strong>
        <span>{subtitle}</span>
        <p>{detail}</p>
      </div>
      {onDismiss ? (
        <button className="notification-card__dismiss" type="button" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      ) : null}
    </div>
  );
}

// ── Position summary card ─────────────────────────────────────────────────────

function PositionSummaryCard({
  snapshot,
  rules,
  benchmarkCurrentPrice,
  onAddWeeklyRule,
  onRemoveRule
}: {
  snapshot: ThesisSnapshot;
  rules: NotificationRuleRecord[];
  benchmarkCurrentPrice: number | null;
  onAddWeeklyRule: () => void;
  onRemoveRule: (id: string) => void;
}) {
  const { thesis, metrics } = snapshot;
  const currentReturn = estimateCurrentReturn(snapshot);

  const hasDistribution =
    typeof thesis.destination === 'number' &&
    typeof thesis.durationDays === 'number' &&
    typeof thesis.errorBand === 'number';

  const elapsedDays = (Date.now() - new Date(thesis.createdAt).getTime()) / 86_400_000;

  const dist = hasDistribution
    ? thesisDistributionAtTime(
        thesis.destination!, thesis.durationDays!, thesis.errorBand!, elapsedDays
      )
    : null;

  const percentile =
    dist && currentReturn !== null
      ? normalPercentile(currentReturn, dist.mean, dist.std)
      : null;

  const { q1, q3 } = dist
    ? distributionQuartiles(dist.mean, dist.std)
    : { q1: null, q3: null };

  const belowQ1 = dist !== null && currentReturn !== null && q1 !== null && currentReturn < q1;
  const aboveQ3 = dist !== null && currentReturn !== null && q3 !== null && currentReturn > q3;

  const benchmarkReturn =
    thesis.benchmarkEntryPrice && benchmarkCurrentPrice !== null
      ? (benchmarkCurrentPrice - thesis.benchmarkEntryPrice) / thesis.benchmarkEntryPrice
      : null;

  const alpha =
    currentReturn !== null && benchmarkReturn !== null
      ? currentReturn - benchmarkReturn
      : null;

  const weeklyRule = rules.find((r) => r.thesisId === thesis.id && r.kind === 'weekly');

  return (
    <article className="position-summary-card">
      <div className="position-summary-card__header">
        <div>
          <span className="eyebrow">{thesis.symbol}</span>
          <span className={`direction-badge direction-badge--${thesis.direction}`}>
            {thesis.direction === 'long' ? '↑ Long' : '↓ Short'}
          </span>
        </div>
        <div className="position-summary-card__conviction">
          <span className="subtle">{thesis.conviction}%</span>
          <div className="conviction-mini-track">
            <div className="conviction-mini-fill" style={{ width: `${thesis.conviction}%` }} />
          </div>
        </div>
      </div>

      <p className="thesis-summary-snippet">{thesis.summary}</p>

      <div className="summary-stats">
        {currentReturn !== null ? (
          <div className="summary-stat">
            <span>Return</span>
            <strong className={currentReturn >= 0 ? 'color-up' : 'color-down'}>
              {formatPercent(currentReturn)}
            </strong>
          </div>
        ) : null}
        {alpha !== null ? (
          <div className="summary-stat">
            <span>vs {thesis.benchmarkSymbol}</span>
            <strong className={alpha >= 0 ? 'color-up' : 'color-down'}>
              {alpha >= 0 ? '+' : ''}{formatPercent(alpha)}
            </strong>
          </div>
        ) : null}
        {percentile !== null ? (
          <div className="summary-stat">
            <span>Distribution</span>
            <strong
              className={
                belowQ1 ? 'color-down' : aboveQ3 ? 'color-up' : ''
              }
            >
              {percentile}th pct
            </strong>
          </div>
        ) : null}
        {metrics.averageBuyPrice !== null ? (
          <div className="summary-stat">
            <span>Avg cost</span>
            <strong>{formatCurrency(metrics.averageBuyPrice)}</strong>
          </div>
        ) : null}
      </div>

      {(belowQ1 || aboveQ3) ? (
        <div className={`distribution-alert${belowQ1 ? ' distribution-alert--low' : ' distribution-alert--high'}`}>
          {belowQ1
            ? `Below Q1 (${formatPercent(q1)}) — consider revisiting the thesis`
            : `Above Q3 (${formatPercent(q3)}) — exceeding expected range`}
        </div>
      ) : null}

      <div className="summary-card-footer">
        {weeklyRule ? (
          <button
            className="chip chip--active"
            type="button"
            onClick={() => onRemoveRule(weeklyRule.id)}
          >
            ✓ Weekly review
          </button>
        ) : (
          <button className="chip" type="button" onClick={onAddWeeklyRule}>
            + Weekly review
          </button>
        )}
      </div>
    </article>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function NotificationsTab({
  snapshots,
  benchmarkCurrentPrice,
  onNavigateToNew,
  onNavigateToPositions
}: NotificationsTabProps) {
  const [rules, setRules] = useState<NotificationRuleRecord[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void listNotificationRules().then(setRules);
  }, [snapshots]);

  async function handleAddWeeklyRule(thesisId: string) {
    await upsertNotificationRule(thesisId, 'weekly');
    const updated = await listNotificationRules();
    setRules(updated);
  }

  async function handleRemoveRule(id: string) {
    await deleteNotificationRule(id);
    const updated = await listNotificationRules();
    setRules(updated);
  }

  async function handleDismissReview(ruleId: string) {
    await markNotificationTriggered(ruleId);
    const updated = await listNotificationRules();
    setRules(updated);
    setDismissedIds((prev) => new Set([...prev, ruleId]));
  }

  if (snapshots.length === 0) {
    return (
      <EmptyState
        title="No positions yet"
        copy="Create your first thesis to start tracking reminders."
        actionLabel="Create thesis"
        onAction={onNavigateToNew}
      />
    );
  }

  // Build triggered notifications
  const triggeredNotifications: Array<{
    id: string;
    thesisSymbol: string;
    title: string;
    subtitle: string;
    detail: string;
    kind: 'alert' | 'review' | 'info';
    ruleId?: string;
  }> = [];

  for (const snapshot of snapshots) {
    const { thesis } = snapshot;
    const thesisRules = rules.filter((r) => r.thesisId === thesis.id);
    const currentReturn = estimateCurrentReturn(snapshot);

    // Weekly review check
    const weeklyRule = thesisRules.find((r) => r.kind === 'weekly');
    if (weeklyRule && !dismissedIds.has(weeklyRule.id)) {
      const daysSinceLastTrigger = weeklyRule.lastTriggeredAt
        ? daysSince(weeklyRule.lastTriggeredAt)
        : daysSince(thesis.createdAt);

      if (daysSinceLastTrigger >= 7) {
        triggeredNotifications.push({
          id: `weekly-${thesis.id}`,
          thesisSymbol: thesis.symbol,
          title: `${thesis.symbol} weekly review due`,
          subtitle: `${Math.floor(daysSinceLastTrigger)} days since last review`,
          detail: thesis.summary.slice(0, 120) + (thesis.summary.length > 120 ? '…' : ''),
          kind: 'review',
          ruleId: weeklyRule.id
        });
      }
    }

    // Quartile breach check against time-evolved distribution
    if (
      typeof thesis.destination === 'number' &&
      typeof thesis.durationDays === 'number' &&
      typeof thesis.errorBand === 'number' &&
      currentReturn !== null
    ) {
      const elapsed = (Date.now() - new Date(thesis.createdAt).getTime()) / 86_400_000;
      const { mean: dMean, std: dStd } = thesisDistributionAtTime(
        thesis.destination, thesis.durationDays, thesis.errorBand, elapsed
      );
      const { q1, q3 } = distributionQuartiles(dMean, dStd);
      if (currentReturn < q1) {
        triggeredNotifications.push({
          id: `q1-${thesis.id}`,
          thesisSymbol: thesis.symbol,
          title: `${thesis.symbol} below Q1`,
          subtitle: `At ${formatPercent(currentReturn)}, expected Q1 at ${formatPercent(q1)}`,
          detail: 'Position is below the 25th percentile of your expected distribution.',
          kind: 'alert'
        });
      } else if (currentReturn > q3) {
        triggeredNotifications.push({
          id: `q3-${thesis.id}`,
          thesisSymbol: thesis.symbol,
          title: `${thesis.symbol} above Q3`,
          subtitle: `At ${formatPercent(currentReturn)}, expected Q3 at ${formatPercent(q3)}`,
          detail: 'Position is exceeding the 75th percentile of your expected distribution.',
          kind: 'info'
        });
      }
    }
  }

  const activeNotifications = triggeredNotifications.filter((n) => !dismissedIds.has(n.id));

  return (
    <section className="screen">
      {activeNotifications.length > 0 ? (
        <div className="notifications-section">
          <div className="section-header">
            <span className="eyebrow">Alerts</span>
            <span className="subtle">{activeNotifications.length}</span>
          </div>
          {activeNotifications.map((n) => (
            <NotificationCard
              key={n.id}
              title={n.title}
              subtitle={n.subtitle}
              detail={n.detail}
              kind={n.kind}
              onDismiss={
                n.ruleId
                  ? () => void handleDismissReview(n.ruleId!)
                  : () => setDismissedIds((prev) => new Set([...prev, n.id]))
              }
            />
          ))}
        </div>
      ) : null}

      <div className="section-header">
        <span className="eyebrow">Positions</span>
        <span className="subtle">{snapshots.length}</span>
      </div>

      {snapshots.map((snapshot) => (
        <PositionSummaryCard
          key={snapshot.thesis.id}
          snapshot={snapshot}
          rules={rules.filter((r) => r.thesisId === snapshot.thesis.id)}
          benchmarkCurrentPrice={benchmarkCurrentPrice}
          onAddWeeklyRule={() => void handleAddWeeklyRule(snapshot.thesis.id)}
          onRemoveRule={(id) => void handleRemoveRule(id)}
        />
      ))}
    </section>
  );
}
