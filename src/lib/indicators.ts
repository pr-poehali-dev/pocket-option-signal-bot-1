// ─── Technical Indicators (pure functions) ────────────────────────────────────

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Simple Moving Average */
export function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    result.push(data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

/** Exponential Moving Average */
export function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = NaN;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    if (i === period - 1) {
      prev = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
      result.push(prev); continue;
    }
    prev = data[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

/** RSI */
export function rsi(data: number[], period = 14): number[] {
  const result: number[] = new Array(period).fill(NaN);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = data[i] - data[i - 1];
    if (d > 0) avgGain += d; else avgLoss += Math.abs(d);
  }
  avgGain /= period; avgLoss /= period;
  result.push(100 - 100 / (1 + avgGain / (avgLoss || 0.0001)));
  for (let i = period + 1; i < data.length; i++) {
    const d = data[i] - data[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? Math.abs(d) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(100 - 100 / (1 + avgGain / (avgLoss || 0.0001)));
  }
  return result;
}

/** MACD */
export function macd(data: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(data, fast);
  const emaSlow = ema(data, slow);
  const macdLine = emaFast.map((v, i) => isNaN(v) || isNaN(emaSlow[i]) ? NaN : v - emaSlow[i]);
  const validMacd = macdLine.filter(v => !isNaN(v));
  const signalRaw = ema(validMacd, signal);
  const signalLine: number[] = new Array(macdLine.length - validMacd.length).fill(NaN);
  let si = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (!isNaN(macdLine[i])) { signalLine.push(signalRaw[si++] ?? NaN); }
  }
  const histogram = macdLine.map((v, i) => isNaN(v) || isNaN(signalLine[i]) ? NaN : v - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

/** Bollinger Bands */
export function bollinger(data: number[], period = 20, mult = 2) {
  const mid = sma(data, period);
  const upper: number[] = [], lower: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); continue; }
    const slice = data.slice(i - period + 1, i + 1);
    const mean = mid[i];
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    upper.push(mean + mult * std);
    lower.push(mean - mult * std);
  }
  return { mid, upper, lower };
}

/** ATR */
export function atr(candles: Candle[], period = 14): number[] {
  const tr: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const result: number[] = new Array(period).fill(NaN);
  let avg = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  result.push(avg);
  for (let i = period + 1; i < tr.length; i++) {
    avg = (avg * (period - 1) + tr[i]) / period;
    result.push(avg);
  }
  return result;
}

/** Volatility % */
export function volatilityPct(candles: Candle[], period = 14): number {
  if (candles.length < period) return 0;
  const slice = candles.slice(-period);
  const returns = slice.slice(1).map((c, i) => (c.close - slice[i].close) / slice[i].close);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

/** Trailing Stop Calculator */
export function trailingStop(candles: Candle[], atrMult = 2, period = 14): {
  stopLong: number; stopShort: number; trend: "up" | "down";
} {
  const atrVals = atr(candles, period);
  const lastATR = atrVals[atrVals.length - 1] || 0;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] || last;
  const trend = last.close > prev.close ? "up" : "down";
  return {
    stopLong:  last.close - atrMult * lastATR,
    stopShort: last.close + atrMult * lastATR,
    trend,
  };
}

/** Detect simple patterns */
export function detectPattern(candles: Candle[]): string {
  if (candles.length < 5) return "—";
  const last5 = candles.slice(-5);
  const closes = last5.map(c => c.close);
  const opens  = last5.map(c => c.open);

  // Doji
  const lastBody = Math.abs(closes[4] - opens[4]);
  const lastRange = last5[4].high - last5[4].low;
  if (lastBody < lastRange * 0.1) return "Doji";

  // Bullish engulfing
  if (closes[3] < opens[3] && closes[4] > opens[4] &&
      closes[4] > opens[3] && opens[4] < closes[3]) return "Бычье поглощение";

  // Bearish engulfing
  if (closes[3] > opens[3] && closes[4] < opens[4] &&
      closes[4] < opens[3] && opens[4] > closes[3]) return "Медвежье поглощение";

  // Double bottom (approx)
  const lows = last5.map(c => c.low);
  if (lows[1] < lows[0] && lows[1] < lows[2] && lows[3] < lows[2] &&
      Math.abs(lows[1] - lows[3]) < lows[1] * 0.01) return "Двойное дно";

  // Rising trend
  const rising = closes.every((c, i) => i === 0 || c >= closes[i - 1]);
  if (rising) return "Восходящий тренд";
  const falling = closes.every((c, i) => i === 0 || c <= closes[i - 1]);
  if (falling) return "Нисходящий тренд";

  return "Боковик";
}
