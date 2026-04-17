import { normalPDF } from '../lib/utils';

interface BellCurveChartProps {
  /** Expected center of distribution (decimal, e.g. 0.30 = 30%) */
  mean: number;
  /** Standard deviation (decimal, e.g. 0.15 = 15%) */
  std: number;
  /** User's destination target — drawn as a reference line */
  destination?: number;
  /** Actual current return marker (decimal) */
  current?: number;
}

const SAMPLES = 80;

export function BellCurveChart({ mean, std, destination, current }: BellCurveChartProps) {
  const safeStd = Math.max(std, 0.005);
  const spread = 3.2 * safeStd;

  // Ensure 0, mean, and destination are all visible
  const candidates = [mean - spread, mean + spread, 0 - safeStd * 0.5];
  if (destination !== undefined) candidates.push(destination + safeStd * 0.5, destination - safeStd * 0.2);
  if (current !== undefined) candidates.push(current);
  const xMin = Math.min(...candidates);
  const xMax = Math.max(...candidates);
  const xRange = xMax - xMin || 0.01;

  const width = 320;
  const height = 100;
  const padX = 8;
  const padY = 10;

  // Sample the PDF
  const xs: number[] = [];
  const pdfs: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const x = xMin + (i / (SAMPLES - 1)) * xRange;
    xs.push(x);
    pdfs.push(normalPDF(x, mean, safeStd));
  }
  const maxPDF = Math.max(...pdfs, 0.001);

  const toSvgX = (x: number) =>
    padX + ((x - xMin) / xRange) * (width - padX * 2);
  const toSvgY = (y: number) =>
    height - padY - (y / maxPDF) * (height - padY * 1.6);

  const curvePoints = xs
    .map((x, i) => `${toSvgX(x).toFixed(1)},${toSvgY(pdfs[i]).toFixed(1)}`)
    .join(' ');
  const areaPoints =
    `${toSvgX(xMin)},${height - padY} ${curvePoints} ${toSvgX(xMax)},${height - padY}`;

  // Label positions as % of rendered width (for CSS absolute positioning)
  const toPct = (x: number) => ((toSvgX(x) / width) * 100).toFixed(1);

  const clampedCurrent =
    current !== undefined ? Math.max(xMin, Math.min(xMax, current)) : undefined;

  return (
    <div className="bell-curve-wrapper">
      <svg
        className="bell-curve"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="bell-area-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(109,245,214,0.3)" />
            <stop offset="100%" stopColor="rgba(109,245,214,0.03)" />
          </linearGradient>
        </defs>

        {/* Filled area under curve */}
        <polygon points={areaPoints} fill="url(#bell-area-fill)" />

        {/* Curve line */}
        <polyline points={curvePoints} className="bell-curve__line" fill="none" />

        {/* Zero reference */}
        <line
          x1={toSvgX(0)} y1={padY}
          x2={toSvgX(0)} y2={height - padY}
          className="bell-curve__zero"
        />

        {/* Destination target */}
        {destination !== undefined ? (
          <line
            x1={toSvgX(destination)} y1={padY * 0.4}
            x2={toSvgX(destination)} y2={height - padY}
            className="bell-curve__dest"
          />
        ) : null}

        {/* Expected mean (center of bell) */}
        <line
          x1={toSvgX(mean)} y1={padY * 0.4}
          x2={toSvgX(mean)} y2={height - padY}
          className="bell-curve__mean"
        />

        {/* Actual current return */}
        {clampedCurrent !== undefined ? (
          <line
            x1={toSvgX(clampedCurrent)} y1={0}
            x2={toSvgX(clampedCurrent)} y2={height}
            className="bell-curve__current"
          />
        ) : null}
      </svg>

      {/* Axis labels — absolutely positioned by % to align with SVG */}
      <div className="bell-curve-labels">
        <span className="bell-curve-labels__zero" style={{ left: `${toPct(0)}%` }}>
          0%
        </span>
        <span className="bell-curve-labels__mean" style={{ left: `${toPct(mean)}%` }}>
          {(mean * 100).toFixed(0)}%
        </span>
        {destination !== undefined ? (
          <span className="bell-curve-labels__dest" style={{ left: `${toPct(destination)}%` }}>
            {(destination * 100).toFixed(0)}%
          </span>
        ) : null}
        {current !== undefined ? (
          <span className="bell-curve-labels__current" style={{ left: `${toPct(current)}%` }}>
            now
          </span>
        ) : null}
      </div>
    </div>
  );
}
