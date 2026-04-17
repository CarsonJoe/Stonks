// ── Formatters ────────────────────────────────────────────────────────────────

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2
});

const quantityFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 4
});

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
  signDisplay: 'always'
});

const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1
});

export function formatCurrency(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return currencyFormatter.format(value);
}

export function formatQuantity(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return quantityFormatter.format(value);
}

export function formatPercent(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return percentFormatter.format(value);
}

export function formatSignedCurrency(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${currencyFormatter.format(value)}`;
}

export function formatCompactNumber(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return compactNumberFormatter.format(value);
}

// ── String helpers ─────────────────────────────────────────────────────────────

export function normalizeSymbol(value: string) {
  return value.trim().toUpperCase();
}

export function normalizeSearchText(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

// ── Normal distribution math ───────────────────────────────────────────────────

// Abramowitz & Stegun error function approximation (max error ≈ 1.5e-7)
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x));
  return Math.sign(x) * y;
}

/** Cumulative distribution function for N(mean, std²). */
export function normalCDF(x: number, mean: number, std: number): number {
  if (std <= 0) return x >= mean ? 1 : 0;
  const z = (x - mean) / (std * Math.SQRT2);
  return 0.5 * (1 + erf(z));
}

/** Returns a whole-number percentile (0–100) for value x in N(mean, std²). */
export function normalPercentile(x: number, mean: number, std: number): number {
  return Math.round(normalCDF(x, mean, std) * 100);
}

/**
 * Q1 = mean − 0.6745σ  (25th percentile)
 * Q3 = mean + 0.6745σ  (75th percentile)
 */
export function distributionQuartiles(mean: number, std: number) {
  return {
    q1: mean - 0.6745 * std,
    q3: mean + 0.6745 * std
  };
}

/** Normal probability density function. */
export function normalPDF(x: number, mean: number, std: number): number {
  if (std < 0.0001) return 0;
  return Math.exp(-0.5 * ((x - mean) / std) ** 2) / (std * Math.sqrt(2 * Math.PI));
}

/**
 * Time-evolving thesis distribution.
 * At t=0: distribution is tight near zero (thesis just started).
 * At t=durationDays: mean = destination, std = errorBand.
 *
 * progress is clamped to [0.1, 1] so the distribution is never degenerate.
 */
export function thesisDistributionAtTime(
  destination: number,
  durationDays: number,
  errorBand: number,
  elapsedDays: number
): { mean: number; std: number } {
  const progress = Math.max(0.1, Math.min(1, elapsedDays / durationDays));
  return {
    mean: destination * progress,
    std: errorBand * progress
  };
}
