export interface ChartSeries {
  label: string;
  values: number[];
  colorClass: 'teal' | 'blue';
  /** Index within values to use as the 100 baseline in indexed mode. Defaults to 0. */
  baseIndex?: number;
}

export interface ChartProjection {
  /** Unix-second timestamps for projected points (starts at/after last historical candle) */
  timestamps: number[];
  median: number[];
  q1: number[];
  q3: number[];
}

interface PerformanceChartProps {
  series: ChartSeries[];
  /** Unix-second timestamps for the primary series (used for x-axis labels + entry line) */
  timestamps?: number[];
  /** If true, each series is indexed to 100 at its baseIndex point */
  indexed?: boolean;
  /** Horizontal reference line — entry price in price mode, 100 in indexed mode */
  baseline?: number | null;
  /** Unix-second timestamp marking the thesis entry — draws a vertical entry line */
  entryTimestamp?: number;
  /** Forward projection band drawn to the right of the last candle */
  projection?: ChartProjection;
}

function pickTickIndices(len: number, count = 4): number[] {
  if (len <= count) return Array.from({ length: len }, (_, i) => i);
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    result.push(Math.round((i / (count - 1)) * (len - 1)));
  }
  return result;
}

function formatAxisDate(timestamp: number, spanDays: number): string {
  const d = new Date(timestamp * 1000);
  if (spanDays <= 90) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export function PerformanceChart({
  series,
  timestamps,
  indexed = false,
  baseline,
  entryTimestamp,
  projection
}: PerformanceChartProps) {
  const validSeries = series.filter((s) => s.values.length >= 2);

  if (validSeries.length === 0) {
    return <div className="chart-empty">No data yet.</div>;
  }

  const normalized = validSeries.map((s) => {
    if (!indexed) return s.values;
    const baseIdx = s.baseIndex ?? 0;
    const base = s.values[baseIdx];
    if (!base) return s.values;
    return s.values.map((v) => (v / base) * 100);
  });

  const allValues = [...normalized.flat()];
  if (baseline !== null && baseline !== undefined) allValues.push(baseline);
  if (projection) {
    allValues.push(...projection.median, ...projection.q1, ...projection.q3);
  }

  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const width = 340;
  const height = 200;
  const padX = 12;
  const padY = 14;

  const scaleY = (v: number) =>
    height - padY - ((v - min) / range) * (height - padY * 2);

  // Total x-span includes both historical candles and projection points
  const histLen = Math.max(...normalized.map((n) => n.length));
  const projLen = projection ? projection.timestamps.length : 0;
  // Projection shares the last historical point — subtract 1 overlap
  const totalLen = histLen + Math.max(0, projLen - 1);
  const maxLen = histLen; // used for historical series offset calculation
  const stepX = (width - padX * 2) / Math.max(totalLen - 1, 1);

  function buildPoints(values: number[]) {
    const offset = maxLen - values.length;
    return values.map((v, i) => `${padX + (i + offset) * stepX},${scaleY(v)}`).join(' ');
  }

  function buildArea(values: number[]) {
    const offset = maxLen - values.length;
    const pts = values.map((v, i) => `${padX + (i + offset) * stepX},${scaleY(v)}`).join(' ');
    const firstX = padX + offset * stepX;
    const lastX = padX + (offset + values.length - 1) * stepX;
    // Anchor fill at the baseline (0 line) when present, otherwise the chart bottom
    const anchorY = baselineY !== null ? baselineY : height - padY;
    return `${firstX},${anchorY} ${pts} ${lastX},${anchorY}`;
  }

  // Projection x starts at the index of the last historical candle
  const projStartIdx = histLen - 1;
  function projX(i: number) {
    return padX + (projStartIdx + i) * stepX;
  }
  const projMedianPoints = projection
    ? projection.median.map((v, i) => `${projX(i)},${scaleY(v)}`).join(' ')
    : null;
  const projQ1Points = projection
    ? projection.q1.map((v, i) => `${projX(i)},${scaleY(v)}`).join(' ')
    : null;
  const projQ3Points = projection
    ? projection.q3.map((v, i) => `${projX(i)},${scaleY(v)}`).join(' ')
    : null;
  // Band polygon between Q3 and Q1
  const projBandPoints = projection
    ? [
        ...projection.q3.map((v, i) => `${projX(i)},${scaleY(v)}`),
        ...[...projection.q1].reverse().map((v, i) => `${projX(projection.q1.length - 1 - i)},${scaleY(v)}`)
      ].join(' ')
    : null;
  // "Now" divider x
  const nowX = projLen > 0 ? projX(0) : null;

  const baselineY =
    baseline !== null && baseline !== undefined ? scaleY(baseline) : null;

  // X-axis ticks
  const primaryLen = normalized[0]?.length ?? 0;
  const tickIndices =
    timestamps && timestamps.length >= 2 && primaryLen >= 2
      ? pickTickIndices(primaryLen, 4)
      : null;
  const spanDays =
    tickIndices && timestamps
      ? (timestamps[tickIndices[tickIndices.length - 1]] - timestamps[tickIndices[0]]) / 86_400
      : 90;

  // Entry vertical line — find index of closest timestamp to entryTimestamp
  let entryX: number | null = null;
  if (entryTimestamp && timestamps && timestamps.length >= 2) {
    let best = 0;
    let bestDiff = Infinity;
    timestamps.forEach((ts, i) => {
      const d = Math.abs(ts - entryTimestamp);
      if (d < bestDiff) { bestDiff = d; best = i; }
    });
    entryX = padX + best * stepX;
  }

  return (
    <div className="chart-wrapper">
      <svg
        className="chart chart--line"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="pf-fill-teal" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(109, 245, 214, 0.28)" />
            <stop offset="100%" stopColor="rgba(109, 245, 214, 0)" />
          </linearGradient>
          <linearGradient id="pf-fill-blue" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(134, 215, 255, 0.18)" />
            <stop offset="100%" stopColor="rgba(134, 215, 255, 0)" />
          </linearGradient>
        </defs>

        {Array.from({ length: 4 }, (_, i) => {
          const y = padY + ((height - padY * 2) / 3) * i;
          return <line key={y} x1={padX} y1={y} x2={width - padX} y2={y} className="chart__grid" />;
        })}

        {/* Faint vertical tick lines */}
        {tickIndices?.map((idx) => {
          const x = padX + idx * stepX;
          return (
            <line key={idx} x1={x} y1={padY} x2={x} y2={height - padY} className="chart__tick" />
          );
        })}

        {/* Entry line — solid, brighter */}
        {entryX !== null ? (
          <line x1={entryX} y1={0} x2={entryX} y2={height} className="chart__entry" />
        ) : null}

        {baselineY !== null ? (
          <line x1={padX} y1={baselineY} x2={width - padX} y2={baselineY} className="chart__baseline" />
        ) : null}

        {validSeries.map((s, idx) => {
          const vals = normalized[idx];
          const isFirst = idx === 0;
          const gradId = s.colorClass === 'teal' ? 'pf-fill-teal' : 'pf-fill-blue';
          return (
            <g key={s.label}>
              {isFirst ? (
                <polygon points={buildArea(vals)} fill={`url(#${gradId})`} />
              ) : null}
              <polyline
                points={buildPoints(vals)}
                fill="none"
                className={`chart__line chart__line--${s.colorClass}`}
              />
            </g>
          );
        })}

        {/* Forward projection band */}
        {projection && projBandPoints ? (
          <g className="chart__projection">
            <polygon points={projBandPoints} className="chart__proj-band" />
            <polyline points={projQ1Points!} className="chart__proj-quartile" />
            <polyline points={projQ3Points!} className="chart__proj-quartile" />
            <polyline points={projMedianPoints!} className="chart__proj-median" />
          </g>
        ) : null}

        {/* "Now" divider */}
        {nowX !== null ? (
          <line x1={nowX} y1={padY} x2={nowX} y2={height - padY} className="chart__now" />
        ) : null}
      </svg>

      {tickIndices && timestamps ? (
        <div className="chart-x-axis">
          {tickIndices.map((idx) => (
            <span key={idx}>{formatAxisDate(timestamps[idx], spanDays)}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
