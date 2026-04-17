/** Picks `count` evenly-spaced indices from an array of length `len`. */
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

export function LineChart({
  values,
  timestamps,
  baseline
}: {
  values: number[];
  /** Unix-second timestamps aligned with values */
  timestamps?: number[];
  baseline?: number | null;
}) {
  if (values.length < 2) {
    return <div className="chart-empty">No trend line yet.</div>;
  }

  const width = 340;
  const height = 216;
  const pad = 16;
  const allValues = typeof baseline === 'number' ? [...values, baseline] : values;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / (values.length - 1);
  const scaleY = (v: number) => height - pad - ((v - min) / range) * (height - pad * 2);
  const points = values.map((v, i) => `${pad + stepX * i},${scaleY(v)}`).join(' ');
  const area = `${pad},${height - pad} ${points} ${width - pad},${height - pad}`;
  const baselineY = typeof baseline === 'number' ? scaleY(baseline) : null;

  const tickIndices =
    timestamps && timestamps.length >= 2
      ? pickTickIndices(timestamps.length, 4)
      : null;
  const spanDays =
    tickIndices && timestamps
      ? (timestamps[tickIndices[tickIndices.length - 1]] - timestamps[tickIndices[0]]) / 86_400
      : 90;

  return (
    <div className="chart-wrapper">
      <svg
        className="chart chart--line"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(109, 245, 214, 0.35)" />
            <stop offset="100%" stopColor="rgba(109, 245, 214, 0)" />
          </linearGradient>
        </defs>

        {Array.from({ length: 4 }, (_, i) => {
          const y = pad + ((height - pad * 2) / 3) * i;
          return <line key={y} x1={pad} y1={y} x2={width - pad} y2={y} className="chart__grid" />;
        })}

        {/* Vertical tick lines aligned with x-axis labels */}
        {tickIndices?.map((idx) => {
          const x = pad + stepX * idx;
          return (
            <line key={idx} x1={x} y1={pad} x2={x} y2={height - pad} className="chart__tick" />
          );
        })}

        {baselineY !== null ? (
          <line x1={pad} y1={baselineY} x2={width - pad} y2={baselineY} className="chart__baseline" />
        ) : null}
        <polygon points={area} className="chart__area" />
        <polyline points={points} className="chart__line chart__line--teal" />
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
