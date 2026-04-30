/**
 * Лёгкая нейросеть (MLP) для предсказания направления цены.
 * Обучается прямо в браузере на исторических свечах без внешних библиотек.
 * Архитектура: 10 признаков → 16 нейронов → 8 нейронов → 1 выход (0=DOWN, 1=UP)
 */
import { Candle, rsi, macd, ema, bollinger, atr } from "./indicators";

// ─── Math helpers ─────────────────────────────────────────────────────────────
const sigmoid = (x: number) => 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, x))));
const relu    = (x: number) => Math.max(0, x);
const dot     = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

function matMul(input: number[], weights: number[][], bias: number[], act: (x: number) => number): number[] {
  return weights.map((row, i) => act(dot(input, row) + bias[i]));
}

// ─── Feature extraction from candles ─────────────────────────────────────────
export function extractFeatures(candles: Candle[]): number[] | null {
  if (candles.length < 30) return null;
  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const rsiVals   = rsi(closes, 14);
  const macdVals  = macd(closes, 12, 26, 9);
  const ema9      = ema(closes, 9);
  const ema21     = ema(closes, 21);
  const boll      = bollinger(closes, 20, 2);
  const atrVals   = atr(candles, 14);

  const last = candles.length - 1;
  const c = closes[last];

  const rsiN    = ((rsiVals[last] ?? 50) - 50) / 50;                         // [-1, 1]
  const macdN   = Math.tanh((macdVals.macdLine[last] ?? 0) / (c * 0.001));   // tanh norm
  const macdSig = Math.tanh(((macdVals.macdLine[last] ?? 0) - (macdVals.signalLine[last] ?? 0)) / (c * 0.001));
  const emaRatio = ((ema9[last] ?? c) - (ema21[last] ?? c)) / c;              // pct diff
  const bollPos  = boll.upper[last] - boll.lower[last] > 0
    ? (c - boll.lower[last]) / (boll.upper[last] - boll.lower[last]) * 2 - 1 : 0; // [-1, 1]
  const atrN    = Math.tanh((atrVals[last] ?? 0) / (c * 0.01));
  const priceChg1 = (closes[last] - closes[last - 1]) / closes[last - 1];
  const priceChg5 = (closes[last] - closes[last - 5]) / closes[last - 5];
  const volChg  = volumes[last] > 0 && volumes[last - 1] > 0
    ? Math.tanh((volumes[last] - volumes[last - 1]) / volumes[last - 1]) : 0;
  const bodyRatio = candles[last].open !== 0
    ? (c - candles[last].open) / (candles[last].high - candles[last].low || 1) : 0;

  return [rsiN, macdN, macdSig, emaRatio, bollPos, atrN, priceChg1, priceChg5, volChg, bodyRatio];
}

// ─── Network weights (Xavier init, then trained) ─────────────────────────────
interface NNWeights {
  w1: number[][]; b1: number[];
  w2: number[][]; b2: number[];
  w3: number[];   b3: number;
}

function initWeights(seed: number): NNWeights {
  let s = seed;
  const rand = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s / 0x100000000 + 0.5) * 2 - 1; };
  const layer = (inp: number, out: number): number[][] =>
    Array.from({ length: out }, () => Array.from({ length: inp }, () => rand() * Math.sqrt(2 / inp)));

  return {
    w1: layer(10, 16), b1: new Array(16).fill(0),
    w2: layer(16, 8),  b2: new Array(8).fill(0),
    w3: Array.from({ length: 8 }, () => rand() * Math.sqrt(2 / 8)), b3: 0,
  };
}

// ─── Forward pass ─────────────────────────────────────────────────────────────
function forward(x: number[], w: NNWeights): number {
  const h1 = matMul(x, w.w1, w.b1, relu);
  const h2 = matMul(h1, w.w2, w.b2, relu);
  return sigmoid(dot(h2, w.w3) + w.b3);
}

// ─── Mini SGD training ────────────────────────────────────────────────────────
function train(w: NNWeights, candles: Candle[], epochs = 80, lr = 0.04): NNWeights {
  const samples: { x: number[]; y: number }[] = [];
  for (let i = 30; i < candles.length - 1; i++) {
    const feat = extractFeatures(candles.slice(0, i + 1));
    if (!feat) continue;
    const y = candles[i + 1].close > candles[i].close ? 1 : 0;
    samples.push({ x: feat, y });
  }
  if (samples.length === 0) return w;

  for (let ep = 0; ep < epochs; ep++) {
    for (const { x, y } of samples) {
      const h1 = matMul(x, w.w1, w.b1, relu);
      const h2 = matMul(h1, w.w2, w.b2, relu);
      const out = sigmoid(dot(h2, w.w3) + w.b3);
      const err = out - y;

      // Output layer grad
      const db3 = err * lr;
      const dw3 = h2.map(v => v * err * lr);

      // Hidden2 grad
      const dh2 = w.w3.map((wj, j) => err * wj * (h2[j] > 0 ? 1 : 0));
      for (let j = 0; j < 8; j++) {
        w.b2[j] -= dh2[j] * lr;
        for (let k = 0; k < 16; k++) w.w2[j][k] -= dh2[j] * h1[k] * lr;
      }

      // Hidden1 grad
      const dh1 = w.w1.map((_, i) => w.w2.reduce((s, row, j) => s + dh2[j] * row[i], 0) * (h1[i] > 0 ? 1 : 0));
      for (let i = 0; i < 16; i++) {
        w.b1[i] -= dh1[i] * lr;
        for (let k = 0; k < 10; k++) w.w1[i][k] -= dh1[i] * x[k] * lr;
      }

      // Apply output grads
      w.b3 -= db3;
      for (let j = 0; j < 8; j++) w.w3[j] -= dw3[j];
    }
  }
  return w;
}

// ─── Public API ───────────────────────────────────────────────────────────────
export interface NNResult {
  prediction: "UP" | "DOWN";
  confidence: number;   // 0–100
  upProb: number;       // 0–1
  trained: boolean;
  accuracy: number;     // 0–100 on training data
}

let cachedWeights: NNWeights | null = null;
let lastTrainedSymbol = "";

export async function analyzeWithNN(candles: Candle[], symbol: string): Promise<NNResult> {
  // Re-train when symbol changes or first run
  if (!cachedWeights || lastTrainedSymbol !== symbol) {
    cachedWeights = initWeights(42);
    await new Promise<void>(resolve => {
      setTimeout(() => {
        cachedWeights = train(cachedWeights!, candles, 80, 0.04);
        lastTrainedSymbol = symbol;
        resolve();
      }, 0);
    });
  }

  const feat = extractFeatures(candles);
  if (!feat || !cachedWeights) {
    return { prediction: "UP", confidence: 50, upProb: 0.5, trained: false, accuracy: 0 };
  }

  const prob = forward(feat, cachedWeights);

  // Calculate training accuracy
  let correct = 0, total = 0;
  for (let i = 30; i < Math.min(candles.length - 1, 80); i++) {
    const f = extractFeatures(candles.slice(0, i + 1));
    if (!f) continue;
    const p = forward(f, cachedWeights!);
    const actual = candles[i + 1].close > candles[i].close ? 1 : 0;
    if ((p > 0.5 ? 1 : 0) === actual) correct++;
    total++;
  }

  return {
    prediction: prob > 0.5 ? "UP" : "DOWN",
    confidence: Math.round(Math.abs(prob - 0.5) * 200),
    upProb: prob,
    trained: true,
    accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
  };
}

export function resetNN() {
  cachedWeights = null;
  lastTrainedSymbol = "";
}
