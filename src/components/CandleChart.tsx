import type { MarketCandle } from '../lib/market';

export function CandleChart({ candles }: { candles: MarketCandle[] }) {
  if (candles.length === 0) {
    return <div className="chart-empty">No candles yet.</div>;
  }

  const width = 340;
  const height = 216;
  const padX = 14;
  const padY = 14;
  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const range = max - min || 1;
  const step = (width - padX * 2) / candles.length;
  const bodyWidth = Math.max(5, step * 0.56);
  const scaleY = (v: number) => height - padY - ((v - min) / range) * (height - padY * 2);

  return (
    <svg
      className="chart chart--candles"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {Array.from({ length: 4 }, (_, i) => {
        const y = padY + ((height - padY * 2) / 3) * i;
        return <line key={y} x1={padX} y1={y} x2={width - padX} y2={y} className="chart__grid" />;
      })}
      {candles.map((candle, i) => {
        const cx = padX + step * i + step / 2;
        const openY = scaleY(candle.open);
        const closeY = scaleY(candle.close);
        const rising = candle.close >= candle.open;
        const bodyY = Math.min(openY, closeY);
        const bodyH = Math.max(3, Math.abs(closeY - openY));

        return (
          <g key={candle.time}>
            <line
              x1={cx} y1={scaleY(candle.high)} x2={cx} y2={scaleY(candle.low)}
              className={rising ? 'chart__wick chart__wick--up' : 'chart__wick chart__wick--down'}
            />
            <rect
              x={cx - bodyWidth / 2} y={bodyY} width={bodyWidth} height={bodyH} rx="3"
              className={rising ? 'chart__body chart__body--up' : 'chart__body chart__body--down'}
            />
          </g>
        );
      })}
    </svg>
  );
}
