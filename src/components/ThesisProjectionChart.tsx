import { thesisDistributionAtTime } from '../lib/utils';

interface ThesisProjectionChartProps {
  destination: number;      // decimal, e.g. 0.25 = +25%
  errorBand: number;        // decimal std dev at maturity
  durationDays: number;
  /** Historical alpha (stock % − benchmark %), old→new. Last point is "today". */
  historicalAlpha?: number[];
}

const PROJ_STEPS = 24;

function maturityLabel(durationDays: number): string {
  const d = new Date(Date.now() + durationDays * 86_400_000);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function yTicks(minVal: number, maxVal: number): number[] {
  const range = maxVal - minVal || 1;
  const rawStep = range / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = Math.ceil(rawStep / magnitude) * magnitude;
  const first = Math.ceil(minVal / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= maxVal + 0.001; v += step) {
    ticks.push(Math.round(v * 10) / 10);
  }
  // Always include 0
  if (!ticks.includes(0) && minVal <= 0 && maxVal >= 0) ticks.push(0);
  return ticks.sort((a, b) => a - b);
}

export function ThesisProjectionChart({
  destination,
  errorBand,
  durationDays,
  historicalAlpha
}: ThesisProjectionChartProps) {
  const hasHist = !!historicalAlpha && historicalAlpha.length >= 2;

  const width  = 360;
  const height = 155;
  const padLeft  = 36;   // y-axis label area
  const padRight = 8;
  const padY     = 14;

  const chartLeft  = padLeft;
  const chartRight = width - padRight;
  const chartW     = chartRight - chartLeft;
  const chartH     = height - padY * 2;

  // Proportions — history gets 1/4 of chart if present
  const histFrac = hasHist ? 0.27 : 0;
  const projFrac = 1 - histFrac;
  const nowX     = chartLeft + histFrac * chartW;

  // ── Historical alpha normalized so last point = 0 (they meet at today) ─────
  const normHist = hasHist
    ? historicalAlpha!.map((v) => v - historicalAlpha![historicalAlpha!.length - 1])
    : [];

  const histStep = hasHist ? (histFrac * chartW) / (normHist.length - 1) : 0;
  const hx = (i: number) => chartLeft + i * histStep;

  // ── Projection points ─────────────────────────────────────────────────────
  const projPoints = Array.from({ length: PROJ_STEPS + 1 }, (_, i) => {
    if (i === 0) return { mean: 0, q1: 0, q3: 0 };
    const elapsed = (i / PROJ_STEPS) * durationDays;
    const { mean, std } = thesisDistributionAtTime(destination, durationDays, errorBand, elapsed);
    const halfIqr = 0.6745 * std;
    return { mean: mean * 100, q1: (mean - halfIqr) * 100, q3: (mean + halfIqr) * 100 };
  });

  const projStep = (projFrac * chartW) / PROJ_STEPS;
  const px = (i: number) => nowX + i * projStep;

  // ── Y range ───────────────────────────────────────────────────────────────
  const allVals = [
    0,
    ...normHist,
    ...projPoints.flatMap((p) => [p.q1, p.q3])
  ];
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const range  = maxVal - minVal || 1;
  // Add 8% headroom
  const displayMin = minVal - range * 0.08;
  const displayMax = maxVal + range * 0.08;
  const displayRange = displayMax - displayMin;

  const sy = (v: number) =>
    height - padY - ((v - displayMin) / displayRange) * chartH;

  const baselineY = sy(0);
  const ticks     = yTicks(displayMin, displayMax);

  // ── SVG path strings ──────────────────────────────────────────────────────
  const histPts = normHist.map((v, i) => `${hx(i)},${sy(v)}`).join(' ');

  const medianPts = projPoints.map((p, i) => `${px(i)},${sy(p.mean)}`).join(' ');
  const q1Pts     = projPoints.map((p, i) => `${px(i)},${sy(p.q1)}`).join(' ');
  const q3Pts     = projPoints.map((p, i) => `${px(i)},${sy(p.q3)}`).join(' ');
  const bandPts   = [
    ...projPoints.map((p, i) => `${px(i)},${sy(p.q3)}`),
    ...[...projPoints].reverse().map((p, i) => `${px(PROJ_STEPS - i)},${sy(p.q1)}`)
  ].join(' ');

  return (
    <div className="chart-wrapper">
      <svg
        className="chart chart--line"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        {/* Horizontal grid + y-axis labels */}
        {ticks.map((t) => {
          const y = sy(t);
          return (
            <g key={t}>
              <line x1={chartLeft} y1={y} x2={chartRight} y2={y} className="chart__grid" />
              <text
                x={chartLeft - 4}
                y={y + 3.5}
                textAnchor="end"
                className="chart__yaxis-label"
              >
                {t > 0 ? `+${t}` : `${t}`}%
              </text>
            </g>
          );
        })}

        {/* Zero baseline (brighter) */}
        <line x1={chartLeft} y1={baselineY} x2={chartRight} y2={baselineY} className="chart__baseline" />

        {/* Historical alpha line */}
        {hasHist ? (
          <polyline points={histPts} fill="none" className="chart__line chart__line--teal" />
        ) : null}

        {/* "Now" divider */}
        {hasHist ? (
          <line x1={nowX} y1={padY} x2={nowX} y2={height - padY} className="chart__now" />
        ) : null}

        {/* Projection band + lines */}
        <polygon points={bandPts} className="chart__proj-band" />
        <polyline points={q1Pts}     fill="none" className="chart__proj-quartile" />
        <polyline points={q3Pts}     fill="none" className="chart__proj-quartile" />
        <polyline points={medianPts} fill="none" className="chart__proj-median" />
      </svg>

      <div className="chart-x-axis" style={{ paddingLeft: padLeft }}>
        {hasHist ? <span>90d ago</span> : null}
        <span>Now</span>
        <span>{maturityLabel(durationDays)}</span>
      </div>
    </div>
  );
}
