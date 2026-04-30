import { useState, useEffect, useRef, useCallback } from "react";
import Icon from "@/components/ui/icon";
import { rsi, macd, ema, bollinger, atr, volatilityPct, trailingStop, detectPattern, type Candle } from "@/lib/indicators";
import { analyzeWithNN, resetNN, type NNResult } from "@/lib/neuralNet";

const API_URL = "https://functions.poehali.dev/4a3e398d-b833-42a0-9726-c5c1a66978c4";

const PAIRS = [
  { id: "BTCUSDT",  label: "BTC/USDT",  color: "#F7931A" },
  { id: "ETHUSDT",  label: "ETH/USDT",  color: "#627EEA" },
  { id: "SOLUSDT",  label: "SOL/USDT",  color: "#9945FF" },
  { id: "BNBUSDT",  label: "BNB/USDT",  color: "#F3BA2F" },
  { id: "XRPUSDT",  label: "XRP/USDT",  color: "#00AAE4" },
  { id: "ADAUSDT",  label: "ADA/USDT",  color: "#0033AD" },
];

const TABS = [
  { id: "dashboard", label: "Панель",      icon: "LayoutDashboard" },
  { id: "signals",   label: "Сигналы",     icon: "Zap"             },
  { id: "ai",        label: "Нейросеть",   icon: "Brain"           },
  { id: "settings",  label: "Настройки",   icon: "Settings"        },
  { id: "portfolio", label: "Портфель",    icon: "Briefcase"       },
  { id: "alerts",    label: "Уведомления", icon: "Bell"            },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface PriceData { price: number; change: number; high: number; low: number; volume: number; }
interface Trade {
  id: string; pair: string; side: "BUY" | "SELL";
  entry: number; amount: number; time: string;
  sl: number; tp: number; trailingActive: boolean; trailingDist: number;
  currentPrice?: number; pnl?: number; pnlPct?: number;
}
interface Signal {
  pair: string; action: "BUY" | "SELL" | "HOLD";
  price: number; conf: number; pattern: string; rsiVal: number; macdVal: number;
}
interface Notification { id: string; icon: string; msg: string; time: Date; color: string; }

// ─── Shared UI ────────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub?: string; color?: string; icon: string;
}) {
  return (
    <div className="glow-card p-4" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: "var(--bot-muted)", fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>{label}</span>
        <Icon name={icon as Parameters<typeof Icon>[0]["name"]} size={14} style={{ color: "var(--bot-muted)" }} />
      </div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 600, color: color || "var(--bot-text)", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--bot-muted)" }}>{sub}</div>}
    </div>
  );
}

function SignalBadge({ action }: { action: string }) {
  const cls = action === "BUY" ? "signal-buy" : action === "SELL" ? "signal-sell" : "signal-hold";
  return <span className={`signal-badge ${cls}`}>{action}</span>;
}

function PriceTag({ change }: { change: number }) {
  const pos = change >= 0;
  return (
    <span className="mono" style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4,
      background: pos ? "rgba(63,185,80,0.12)" : "rgba(248,81,73,0.12)",
      color: pos ? "var(--bot-green)" : "var(--bot-red)" }}>
      {pos ? "+" : ""}{change.toFixed(2)}%
    </span>
  );
}

// ─── Mini Candlestick Chart ────────────────────────────────────────────────────
function CandleChart({ candles, height = 80 }: { candles: Candle[]; height?: number }) {
  if (!candles.length) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>Загрузка графика…</span>
    </div>
  );
  const last = Math.min(40, candles.length);
  const slice = candles.slice(-last);
  const allHigh  = Math.max(...slice.map(c => c.high));
  const allLow   = Math.min(...slice.map(c => c.low));
  const range    = allHigh - allLow || 1;
  const toY      = (v: number) => ((allHigh - v) / range) * (height - 4) + 2;
  const w        = 8;
  const gap      = 3;
  const totalW   = last * (w + gap);

  return (
    <svg width={totalW} height={height} style={{ display: "block", overflowX: "auto" }}>
      {slice.map((c, i) => {
        const x     = i * (w + gap) + 1;
        const isUp  = c.close >= c.open;
        const color = isUp ? "#3fb950" : "#f85149";
        const bodyTop = Math.min(toY(c.open), toY(c.close));
        const bodyH   = Math.max(1, Math.abs(toY(c.open) - toY(c.close)));
        return (
          <g key={i}>
            <line x1={x + w / 2} y1={toY(c.high)} x2={x + w / 2} y2={toY(c.low)} stroke={color} strokeWidth={1} />
            <rect x={x} y={bodyTop} width={w} height={bodyH} fill={color} rx={1} />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ prices, candles, activeTrades, balance, botActive, setBotActive, addNotif }: {
  prices: Record<string, PriceData>;
  candles: Candle[];
  activeTrades: Trade[];
  balance: number;
  botActive: boolean;
  setBotActive: (v: boolean) => void;
  addNotif: (msg: string, icon: string, color: string) => void;
}) {
  const totalPnl = activeTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  const btc = prices["BTCUSDT"];
  const eth = prices["ETHUSDT"];

  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Status */}
      <div className="glow-card p-4" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="pulse-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: botActive ? "var(--bot-green)" : "var(--bot-red)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--bot-text)" }}>TradeBot {botActive ? "активен" : "остановлен"}</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--bot-muted)" }}>v2.5 · Binance · Реальные данные</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => {
            setBotActive(!botActive);
            addNotif(botActive ? "Бот остановлен" : "Бот запущен", botActive ? "Square" : "Play", botActive ? "#f85149" : "#3fb950");
          }} style={{
            padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: botActive ? "rgba(248,81,73,0.15)" : "rgba(63,185,80,0.15)",
            color: botActive ? "var(--bot-red)" : "var(--bot-green)",
            border: `1px solid ${botActive ? "rgba(248,81,73,0.3)" : "rgba(63,185,80,0.3)"}`,
          }}>
            {botActive ? "Остановить" : "Запустить"}
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <MetricCard label="Баланс PO" value={`$${balance.toLocaleString()}`} sub="Pocket Option" color="var(--bot-text)" icon="Wallet" />
        <MetricCard label="P&L сделок" value={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`}
          sub={`${activeTrades.length} активных`} color={totalPnl >= 0 ? "var(--bot-green)" : "var(--bot-red)"} icon="TrendingUp" />
        <MetricCard label="BTC" value={btc ? `$${Math.round(btc.price).toLocaleString()}` : "…"} sub={btc ? `${btc.change >= 0 ? "+" : ""}${btc.change.toFixed(2)}%` : ""} color="var(--bot-text)" icon="Bitcoin" />
        <MetricCard label="ETH" value={eth ? `$${eth.price.toFixed(2)}` : "…"} sub={eth ? `${eth.change >= 0 ? "+" : ""}${eth.change.toFixed(2)}%` : ""} color="var(--bot-text)" icon="Activity" />
      </div>

      {/* Chart */}
      <div className="glow-card p-4">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)" }}>BTC/USDT · 5m свечи (реальные)</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--bot-muted)" }}>{candles.length} свечей</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <CandleChart candles={candles} height={90} />
        </div>
      </div>

      {/* Prices grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {PAIRS.slice(0, 6).map(p => {
          const d = prices[p.id];
          return (
            <div key={p.id} className="glow-card p-4" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)" }}>{p.label}</span>
                </div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: "var(--bot-text)", marginTop: 4 }}>
                  {d ? `$${d.price > 100 ? Math.round(d.price).toLocaleString() : d.price.toFixed(4)}` : "…"}
                </div>
              </div>
              {d && <PriceTag change={d.change} />}
            </div>
          );
        })}
      </div>

      {/* Active trades */}
      {activeTrades.length > 0 && (
        <div className="glow-card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--bot-border)", fontSize: 12, fontWeight: 600, color: "var(--bot-text)" }}>
            Открытые позиции
          </div>
          {activeTrades.map(t => (
            <div key={t.id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 1fr 1fr 1fr", padding: "10px 16px", borderBottom: "1px solid var(--bot-border)", alignItems: "center", gap: 8 }}>
              <span className="mono" style={{ fontSize: 12, color: "var(--bot-text)" }}>{t.pair}</span>
              <SignalBadge action={t.side} />
              <span className="mono" style={{ fontSize: 11, color: "var(--bot-muted)" }}>вход ${t.entry.toFixed(2)}</span>
              <span className="mono" style={{ fontSize: 11, color: t.trailingActive ? "var(--bot-blue)" : "var(--bot-muted)" }}>
                {t.trailingActive ? `↳ Trail $${t.sl.toFixed(2)}` : `SL $${t.sl.toFixed(2)}`}
              </span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: (t.pnl || 0) >= 0 ? "var(--bot-green)" : "var(--bot-red)" }}>
                {(t.pnl || 0) >= 0 ? "+" : ""}${(t.pnl || 0).toFixed(2)} ({(t.pnlPct || 0).toFixed(1)}%)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Signals ──────────────────────────────────────────────────────────────────
function Signals({ signals, prices, openTrade, botActive }: {
  signals: Signal[];
  prices: Record<string, PriceData>;
  openTrade: (sig: Signal) => void;
  botActive: boolean;
}) {
  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--bot-text)" }}>Торговые сигналы (реальные)</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--bot-green)" }} />
          <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>Обновление каждые 30с</span>
        </div>
      </div>

      {signals.length === 0 && (
        <div className="glow-card p-8" style={{ textAlign: "center" as const, color: "var(--bot-muted)" }}>
          <div style={{ fontSize: 13 }}>Загружаю данные с биржи…</div>
        </div>
      )}

      {signals.map((s, i) => {
        const p = prices[s.pair.replace("/", "")];
        return (
          <div key={i} className="glow-card p-4" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <SignalBadge action={s.action} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--bot-text)" }}>{s.pair}</span>
                <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>{s.pattern}</span>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>RSI: <span className="mono" style={{ color: s.rsiVal > 70 ? "var(--bot-red)" : s.rsiVal < 30 ? "var(--bot-green)" : "var(--bot-text)" }}>{s.rsiVal.toFixed(1)}</span></span>
                <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>MACD: <span className="mono" style={{ color: s.macdVal > 0 ? "var(--bot-green)" : "var(--bot-red)" }}>{s.macdVal > 0 ? "+" : ""}{s.macdVal.toFixed(2)}</span></span>
              </div>
            </div>
            <div style={{ textAlign: "right" as const, minWidth: 90 }}>
              <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--bot-text)" }}>
                ${p ? (p.price > 100 ? Math.round(p.price).toLocaleString() : p.price.toFixed(4)) : s.price.toFixed(4)}
              </div>
              {p && <PriceTag change={p.change} />}
            </div>
            <div style={{ minWidth: 48, textAlign: "center" as const }}>
              <div style={{ fontSize: 10, color: "var(--bot-muted)" }}>Уверен.</div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 700,
                color: s.conf > 70 ? "var(--bot-green)" : s.conf > 50 ? "var(--bot-yellow)" : "var(--bot-muted)" }}>
                {s.conf}%
              </div>
            </div>
            <button
              disabled={!botActive || s.action === "HOLD"}
              onClick={() => openTrade(s)}
              style={{
                padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: botActive && s.action !== "HOLD" ? "pointer" : "not-allowed",
                background: !botActive || s.action === "HOLD" ? "var(--bot-surface-2)" : "var(--bot-accent)",
                color: !botActive || s.action === "HOLD" ? "var(--bot-muted)" : "#fff",
                border: "none", transition: "all 0.15s"
              }}>
              {s.action === "HOLD" ? "Ожидать" : "Открыть"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── AI Neural Network Tab ────────────────────────────────────────────────────
function AITab({ candles, nnResult, symbol, setSymbol, isTraining }: {
  candles: Candle[]; nnResult: NNResult | null; symbol: string;
  setSymbol: (s: string) => void; isTraining: boolean;
}) {
  if (!candles.length) return (
    <div style={{ padding: 40, textAlign: "center" as const, color: "var(--bot-muted)" }}>Загрузка данных…</div>
  );

  const closes = candles.map(c => c.close);
  const rsiV   = rsi(closes, 14);
  const macdV  = macd(closes, 12, 26, 9);
  const ema9   = ema(closes, 9);
  const ema21  = ema(closes, 21);
  const boll   = bollinger(closes, 20, 2);
  const atrV   = atr(candles, 14);
  const last   = candles.length - 1;
  const ts     = candles.length >= 14 ? trailingStop(candles, 2, 14) : null;
  const vol    = volatilityPct(candles, 14);

  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--bot-text)" }}>Нейросеть — анализ и прогноз</h2>
        <div style={{ display: "flex", gap: 8 }}>
          {PAIRS.map(p => (
            <button key={p.id} onClick={() => setSymbol(p.id)} style={{
              padding: "4px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer",
              background: symbol === p.id ? "var(--bot-accent)" : "var(--bot-surface-2)",
              color: symbol === p.id ? "#fff" : "var(--bot-muted)",
              border: symbol === p.id ? "none" : "1px solid var(--bot-border)"
            }}>{p.label.split("/")[0]}</button>
          ))}
        </div>
      </div>

      {/* NN Result block */}
      <div className="glow-card p-5" style={{ position: "relative" as const, overflow: "hidden" }}>
        {isTraining && (
          <div style={{
            position: "absolute" as const, inset: 0, background: "rgba(8,12,16,0.8)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10, zIndex: 1
          }}>
            <div className="pulse-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--bot-blue)" }} />
            <span style={{ color: "var(--bot-blue)", fontSize: 13 }}>Обучение нейросети…</span>
          </div>
        )}
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 16 }}>
          Прогноз нейросети · {PAIRS.find(p => p.id === symbol)?.label}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
          <div style={{ textAlign: "center" as const }}>
            <div style={{ fontSize: 11, color: "var(--bot-muted)", marginBottom: 6 }}>Направление</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: nnResult?.prediction === "UP" ? "var(--bot-green)" : "var(--bot-red)" }}>
              {nnResult ? (nnResult.prediction === "UP" ? "▲ ВВЕРХ" : "▼ ВНИЗ") : "—"}
            </div>
          </div>
          <div style={{ textAlign: "center" as const }}>
            <div style={{ fontSize: 11, color: "var(--bot-muted)", marginBottom: 6 }}>Уверенность</div>
            <div className="mono" style={{ fontSize: 28, fontWeight: 800, color: "var(--bot-blue)" }}>
              {nnResult ? `${nnResult.confidence}%` : "—"}
            </div>
          </div>
          <div style={{ textAlign: "center" as const }}>
            <div style={{ fontSize: 11, color: "var(--bot-muted)", marginBottom: 6 }}>Точность модели</div>
            <div className="mono" style={{ fontSize: 28, fontWeight: 800, color: "var(--bot-yellow)" }}>
              {nnResult ? `${nnResult.accuracy}%` : "—"}
            </div>
          </div>
          <div style={{ textAlign: "center" as const }}>
            <div style={{ fontSize: 11, color: "var(--bot-muted)", marginBottom: 6 }}>P(UP)</div>
            <div className="mono" style={{ fontSize: 28, fontWeight: 800, color: "var(--bot-text)" }}>
              {nnResult ? `${(nnResult.upProb * 100).toFixed(0)}%` : "—"}
            </div>
          </div>
        </div>

        {/* Probability bar */}
        {nnResult && (
          <div style={{ marginTop: 16 }}>
            <div style={{ height: 6, borderRadius: 3, background: "var(--bot-border)", overflow: "hidden" }}>
              <div style={{ width: `${nnResult.upProb * 100}%`, height: "100%", background: "linear-gradient(90deg, var(--bot-red), var(--bot-green))", transition: "width 0.5s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: 10, color: "var(--bot-red)" }}>ВНИЗ {(100 - nnResult.upProb * 100).toFixed(0)}%</span>
              <span style={{ fontSize: 10, color: "var(--bot-green)" }}>ВВЕРХ {(nnResult.upProb * 100).toFixed(0)}%</span>
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="glow-card p-4">
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 12 }}>График свечей</div>
        <div style={{ overflowX: "auto" }}>
          <CandleChart candles={candles} height={100} />
        </div>
      </div>

      {/* Indicators */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="glow-card p-5">
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 14 }}>Индикаторы</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { name: "RSI (14)",   value: (rsiV[last] ?? 0).toFixed(1),  status: (rsiV[last] ?? 50) > 70 ? "Перекуплен" : (rsiV[last] ?? 50) < 30 ? "Перепродан" : "Нейтральный", color: (rsiV[last] ?? 50) > 70 ? "var(--bot-red)" : (rsiV[last] ?? 50) < 30 ? "var(--bot-green)" : "var(--bot-yellow)" },
              { name: "MACD",       value: (macdV.macdLine[last] ?? 0) > 0 ? "+" + (macdV.macdLine[last] ?? 0).toFixed(1) : (macdV.macdLine[last] ?? 0).toFixed(1), status: (macdV.macdLine[last] ?? 0) > (macdV.signalLine[last] ?? 0) ? "Бычий" : "Медвежий", color: (macdV.macdLine[last] ?? 0) > 0 ? "var(--bot-green)" : "var(--bot-red)" },
              { name: "EMA9/EMA21", value: (ema9[last] ?? 0) > (ema21[last] ?? 0) ? "Выше" : "Ниже", status: (ema9[last] ?? 0) > (ema21[last] ?? 0) ? "Бычий" : "Медвежий", color: (ema9[last] ?? 0) > (ema21[last] ?? 0) ? "var(--bot-green)" : "var(--bot-red)" },
              { name: "Bollinger",  value: boll.upper[last] ? `±${((boll.upper[last] - boll.lower[last]) / closes[last] * 100).toFixed(1)}%` : "—", status: closes[last] > (boll.upper[last] ?? 0) ? "Выше верхней" : closes[last] < (boll.lower[last] ?? 0) ? "Ниже нижней" : "В канале", color: "var(--bot-blue)" },
              { name: "ATR (14)",   value: (atrV[last] ?? 0).toFixed(0), status: "Волатильность", color: "var(--bot-yellow)" },
            ].map((ind, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 8, borderBottom: i < 4 ? "1px solid var(--bot-border)" : "none" }}>
                <span style={{ fontSize: 12, color: "var(--bot-muted)" }}>{ind.name}</span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span className="mono" style={{ fontSize: 12, color: "var(--bot-text)" }}>{ind.value}</span>
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "var(--bot-surface-2)", color: ind.color }}>{ind.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glow-card p-5">
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 14 }}>Трейлинг-стоп</div>
          {ts ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "var(--bot-surface-2)", borderRadius: 6 }}>
                <span style={{ fontSize: 12, color: "var(--bot-muted)" }}>Тренд</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: ts.trend === "up" ? "var(--bot-green)" : "var(--bot-red)" }}>{ts.trend === "up" ? "▲ Восходящий" : "▼ Нисходящий"}</span>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--bot-muted)", marginBottom: 6 }}>Стоп для LONG (2×ATR ниже цены)</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--bot-green)" }}>${ts.stopLong.toFixed(2)}</div>
                <div style={{ fontSize: 11, color: "var(--bot-muted)", marginTop: 2 }}>
                  Отступ: ${(closes[last] - ts.stopLong).toFixed(2)} ({((closes[last] - ts.stopLong) / closes[last] * 100).toFixed(2)}%)
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--bot-muted)", marginBottom: 6 }}>Стоп для SHORT (2×ATR выше цены)</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--bot-red)" }}>${ts.stopShort.toFixed(2)}</div>
                <div style={{ fontSize: 11, color: "var(--bot-muted)", marginTop: 2 }}>
                  Отступ: ${(ts.stopShort - closes[last]).toFixed(2)} ({((ts.stopShort - closes[last]) / closes[last] * 100).toFixed(2)}%)
                </div>
              </div>
              <div style={{ padding: "10px 14px", background: "rgba(88,166,255,0.08)", borderRadius: 6, border: "1px solid rgba(88,166,255,0.2)" }}>
                <div style={{ fontSize: 11, color: "var(--bot-muted)", marginBottom: 4 }}>ATR (14) — волатильность</div>
                <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--bot-blue)" }}>{(atrV[last] ?? 0).toFixed(2)}</div>
                <div style={{ fontSize: 11, color: "var(--bot-muted)" }}>= {((atrV[last] ?? 0) / closes[last] * 100).toFixed(2)}% от цены</div>
              </div>
              <div style={{ padding: "10px 14px", background: "var(--bot-surface-2)", borderRadius: 6 }}>
                <div style={{ fontSize: 11, color: "var(--bot-muted)", marginBottom: 4 }}>Волатильность (14 свечей)</div>
                <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: vol > 2 ? "var(--bot-red)" : "var(--bot-yellow)" }}>{vol.toFixed(2)}%</div>
              </div>
            </div>
          ) : (
            <div style={{ color: "var(--bot-muted)", fontSize: 12 }}>Недостаточно данных</div>
          )}
        </div>
      </div>

      {/* Pattern */}
      <div className="glow-card p-4" style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Icon name="Eye" size={20} style={{ color: "var(--bot-blue)" }} />
        <div>
          <div style={{ fontSize: 11, color: "var(--bot-muted)" }}>Обнаруженный паттерн</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--bot-text)" }}>{detectPattern(candles)}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Portfolio / Trades ───────────────────────────────────────────────────────
function Portfolio({ activeTrades, closeTrade, prices }: {
  activeTrades: Trade[];
  closeTrade: (id: string) => void;
  prices: Record<string, PriceData>;
}) {
  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--bot-text)" }}>Открытые позиции</h2>

      {activeTrades.length === 0 ? (
        <div className="glow-card p-8" style={{ textAlign: "center" as const, color: "var(--bot-muted)", fontSize: 13 }}>
          Нет открытых позиций. Открой сделку во вкладке "Сигналы"
        </div>
      ) : (
        <div className="glow-card" style={{ overflow: "hidden" }}>
          {activeTrades.map((t, i) => {
            const p = prices[t.pair.replace("/", "")];
            const curPrice = p?.price || t.entry;
            const pnl = t.side === "BUY"
              ? (curPrice - t.entry) * t.amount
              : (t.entry - curPrice) * t.amount;
            const pnlPct = t.side === "BUY"
              ? (curPrice - t.entry) / t.entry * 100
              : (t.entry - curPrice) / t.entry * 100;
            return (
              <div key={t.id} style={{
                padding: "14px 16px", borderBottom: i < activeTrades.length - 1 ? "1px solid var(--bot-border)" : "none",
                display: "grid", gridTemplateColumns: "100px 70px 1fr 1fr 1fr 80px", gap: 12, alignItems: "center"
              }}>
                <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)" }}>{t.pair}</span>
                <SignalBadge action={t.side} />
                <div>
                  <div style={{ fontSize: 10, color: "var(--bot-muted)" }}>Вход / Текущая</div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--bot-text)" }}>
                    ${t.entry.toFixed(2)} → <span style={{ color: "var(--bot-blue)" }}>${curPrice.toFixed(2)}</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--bot-muted)" }}>{t.trailingActive ? "Трейлинг-стоп" : "Stop Loss"}</div>
                  <div className="mono" style={{ fontSize: 12, color: t.trailingActive ? "var(--bot-blue)" : "var(--bot-yellow)" }}>
                    ${t.sl.toFixed(2)}{t.trailingActive ? " ↻" : ""}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--bot-muted)" }}>P&L</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: pnl >= 0 ? "var(--bot-green)" : "var(--bot-red)" }}>
                    {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} <span style={{ fontSize: 11 }}>({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)</span>
                  </div>
                </div>
                <button onClick={() => closeTrade(t.id)} style={{
                  padding: "6px 12px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  background: "rgba(248,81,73,0.15)", color: "var(--bot-red)", border: "1px solid rgba(248,81,73,0.3)"
                }}>Закрыть</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────
function Settings({ balance, setBalance, trailMult, setTrailMult, riskPct, setRiskPct, strategy, setStrategy, addNotif }: {
  balance: number; setBalance: (v: number) => void;
  trailMult: number; setTrailMult: (v: number) => void;
  riskPct: number; setRiskPct: (v: number) => void;
  strategy: string; setStrategy: (v: string) => void;
  addNotif: (msg: string, icon: string, color: string) => void;
}) {
  const [inputBalance, setInputBalance] = useState(String(balance));

  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--bot-text)" }}>Настройки</h2>

      {/* Balance from PO */}
      <div className="glow-card p-5">
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 4 }}>Баланс Pocket Option</div>
        <div style={{ fontSize: 11, color: "var(--bot-muted)", marginBottom: 14 }}>Введи свой текущий баланс с Pocket Option — бот будет считать P&L относительно него</div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative" as const, flex: 1 }}>
            <span style={{ position: "absolute" as const, left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--bot-muted)", fontSize: 14 }}>$</span>
            <input
              type="number"
              value={inputBalance}
              onChange={e => setInputBalance(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px 10px 24px", borderRadius: 6, fontSize: 14,
                background: "var(--bot-bg)", border: "1px solid var(--bot-border)",
                color: "var(--bot-text)", outline: "none", fontFamily: "IBM Plex Mono"
              }} />
          </div>
          <button onClick={() => {
            const v = parseFloat(inputBalance);
            if (!isNaN(v) && v > 0) {
              setBalance(v);
              addNotif(`Баланс обновлён: $${v.toLocaleString()}`, "Wallet", "#3fb950");
            }
          }} style={{
            padding: "10px 20px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
            background: "var(--bot-accent)", color: "#fff", border: "none"
          }}>Сохранить</button>
        </div>
      </div>

      {/* Strategy */}
      <div className="glow-card p-5">
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 16 }}>Стратегия для сигналов</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
          {["RSI+MACD", "EMA Cross", "Bollinger", "Нейросеть", "Комбо"].map(s => (
            <button key={s} onClick={() => { setStrategy(s); addNotif(`Стратегия изменена: ${s}`, "Settings", "#58a6ff"); }} style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer",
              background: strategy === s ? "var(--bot-accent)" : "var(--bot-surface-2)",
              color: strategy === s ? "#fff" : "var(--bot-muted)",
              border: strategy === s ? "none" : "1px solid var(--bot-border)"
            }}>{s}</button>
          ))}
        </div>
      </div>

      {/* Risk */}
      <div className="glow-card p-5">
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 16 }}>Риск-менеджмент</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "var(--bot-muted)" }}>Риск на сделку</span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--bot-blue)" }}>{riskPct}% = ${(balance * riskPct / 100).toFixed(2)}</span>
            </div>
            <input type="range" min={0.5} max={10} step={0.5} value={riskPct}
              onChange={e => setRiskPct(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--bot-blue)", cursor: "pointer" }} />
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "var(--bot-muted)" }}>Трейлинг-стоп (множитель ATR)</span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--bot-yellow)" }}>{trailMult}×ATR</span>
            </div>
            <input type="range" min={1} max={5} step={0.5} value={trailMult}
              onChange={e => setTrailMult(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--bot-yellow)", cursor: "pointer" }} />
            <div style={{ fontSize: 11, color: "var(--bot-muted)", marginTop: 6 }}>
              Трейлинг-стоп автоматически подтягивается вслед за ценой на расстоянии {trailMult}×ATR
            </div>
          </div>
        </div>
      </div>

      {/* PO Integration */}
      <div className="glow-card p-5" style={{ border: "1px solid rgba(88,166,255,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Icon name="Info" size={14} style={{ color: "var(--bot-blue)" }} />
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)" }}>Как использовать с Pocket Option</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            "1. Открой Pocket Option в соседней вкладке браузера",
            "2. Смотри сигналы бота во вкладке «Сигналы»",
            "3. При сигнале BUY/SELL с уверенностью >70% — открывай соответствующую сделку на PO",
            "4. Используй трейлинг-стоп из вкладки «Нейросеть» для определения Stop Loss",
            "5. Обновляй баланс PO в этих настройках для точного расчёта P&L",
          ].map((step, i) => (
            <div key={i} style={{ fontSize: 12, color: "var(--bot-muted)", padding: "6px 10px", background: "var(--bot-surface-2)", borderRadius: 5 }}>{step}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Alerts ───────────────────────────────────────────────────────────────────
function AlertsTab({ notifications, clearNotifs }: {
  notifications: Notification[];
  clearNotifs: () => void;
}) {
  const [sw, setSw] = useState([true, true, true, false, false]);
  const fmt = (d: Date) => {
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return `${diff}с назад`;
    if (diff < 3600) return `${Math.floor(diff / 60)}м назад`;
    return `${Math.floor(diff / 3600)}ч назад`;
  };
  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--bot-text)" }}>Уведомления</h2>
        <button onClick={clearNotifs} style={{
          padding: "5px 12px", borderRadius: 5, fontSize: 11, cursor: "pointer",
          background: "transparent", color: "var(--bot-muted)", border: "1px solid var(--bot-border)"
        }}>Очистить все</button>
      </div>

      {notifications.length === 0 && (
        <div className="glow-card p-6" style={{ textAlign: "center" as const, color: "var(--bot-muted)", fontSize: 12 }}>
          Уведомлений пока нет
        </div>
      )}

      {[...notifications].reverse().map((n, i) => (
        <div key={i} className="glow-card p-4" style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: `${n.color}18`, flexShrink: 0 }}>
            <Icon name={n.icon as Parameters<typeof Icon>[0]["name"]} size={15} style={{ color: n.color }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: "var(--bot-text)", marginBottom: 2 }}>{n.msg}</div>
            <div style={{ fontSize: 11, color: "var(--bot-muted)" }}>{fmt(n.time)}</div>
          </div>
        </div>
      ))}

      <div className="glow-card p-5">
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 14 }}>Настройка уведомлений</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {["Новые торговые сигналы", "Превышение уровня риска", "Закрытие сделок", "Ошибки API", "Ночные уведомления"].map((label, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--bot-text)" }}>{label}</span>
              <div onClick={() => setSw(s => s.map((v, j) => j === i ? !v : v))} style={{
                width: 36, height: 20, borderRadius: 10, cursor: "pointer",
                background: sw[i] ? "var(--bot-green-dim)" : "var(--bot-border)",
                position: "relative" as const, transition: "background 0.2s"
              }}>
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute" as const, top: 3, left: sw[i] ? 19 : 3, transition: "left 0.2s" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function Index() {
  const [tab, setTab]                 = useState("dashboard");
  const [botActive, setBotActive]     = useState(true);
  const [time, setTime]               = useState(new Date());
  const [balance, setBalance]         = useState(1000);
  const [riskPct, setRiskPct]         = useState(2);
  const [trailMult, setTrailMult]     = useState(2);
  const [strategy, setStrategy]       = useState("Комбо");
  const [symbol, setSymbol]           = useState("BTCUSDT");

  const [prices, setPrices]           = useState<Record<string, PriceData>>({});
  const [candlesMap, setCandlesMap]   = useState<Record<string, Candle[]>>({});
  const [signals, setSignals]         = useState<Signal[]>([]);
  const [activeTrades, setActiveTrades] = useState<Trade[]>([]);
  const [notifications, setNotifs]    = useState<Notification[]>([]);
  const [nnResult, setNNResult]       = useState<NNResult | null>(null);
  const [isTraining, setIsTraining]   = useState(false);

  const tradesRef = useRef(activeTrades);
  tradesRef.current = activeTrades;

  // ── Helpers ────────────────────────────────────────────────────────────────
  const addNotif = useCallback((msg: string, icon: string, color: string) => {
    setNotifs(prev => [...prev.slice(-19), { id: Date.now().toString(), icon, msg, time: new Date(), color }]);
  }, []);

  // ── Fetch prices — напрямую с Binance (CORS разрешён для браузеров) ────────
  const fetchPrices = useCallback(async () => {
    const results: Record<string, PriceData> = {};
    await Promise.all(
      PAIRS.map(async (pair) => {
        try {
          const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair.id}`);
          if (!res.ok) return;
          const t = await res.json();
          results[pair.id] = {
            price:       parseFloat(t.lastPrice),
            change:      parseFloat(t.priceChangePercent),
            high:        parseFloat(t.highPrice),
            low:         parseFloat(t.lowPrice),
            volume:      parseFloat(t.volume),
          };
        } catch (e) { void e; }
      })
    );
    if (Object.keys(results).length > 0) setPrices(results);
  }, []);

  // ── Fetch candles — через бэкенд (свечи работают) ─────────────────────────
  const fetchCandles = useCallback(async (sym: string) => {
    try {
      // Сначала пробуем напрямую Binance
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=5m&limit=100`);
      if (res.ok) {
        const raw = await res.json();
        const data: Candle[] = raw.map((c: unknown[]) => ({
          time: Number(c[0]), open: parseFloat(c[1] as string),
          high: parseFloat(c[2] as string), low: parseFloat(c[3] as string),
          close: parseFloat(c[4] as string), volume: parseFloat(c[5] as string),
        }));
        setCandlesMap(prev => ({ ...prev, [sym]: data }));
        return data;
      }
    } catch (e) { void e; }
    // Fallback: через бэкенд
    try {
      const res = await fetch(`${API_URL}?action=klines&symbol=${sym}&interval=5m&limit=100`);
      if (!res.ok) return;
      const data: Candle[] = await res.json();
      setCandlesMap(prev => ({ ...prev, [sym]: data }));
      return data;
    } catch (e) { void e; }
  }, []);

  // ── Generate signals from real candles ────────────────────────────────────
  const generateSignals = useCallback((candlesData: Record<string, Candle[]>, pricesData: Record<string, PriceData>) => {
    const sigs: Signal[] = [];
    for (const pair of PAIRS) {
      const cs = candlesData[pair.id];
      if (!cs || cs.length < 30) continue;
      const closes = cs.map(c => c.close);
      const last   = closes.length - 1;
      const rsiV   = rsi(closes, 14);
      const macdV  = macd(closes, 12, 26, 9);
      const ema9   = ema(closes, 9);
      const ema21  = ema(closes, 21);

      const rsiVal  = rsiV[last] ?? 50;
      const macdVal = macdV.macdLine[last] ?? 0;
      const macdSig = macdV.signalLine[last] ?? 0;
      const ema9v   = ema9[last] ?? closes[last];
      const ema21v  = ema21[last] ?? closes[last];

      let action: "BUY" | "SELL" | "HOLD" = "HOLD";
      let conf = 50;

      const bullSignals = [rsiVal < 65, macdVal > macdSig, ema9v > ema21v].filter(Boolean).length;
      const bearSignals = [rsiVal > 55, macdVal < macdSig, ema9v < ema21v].filter(Boolean).length;

      if (rsiVal < 35 && macdVal > macdSig) { action = "BUY";  conf = 85; }
      else if (rsiVal > 65 && macdVal < macdSig) { action = "SELL"; conf = 83; }
      else if (bullSignals >= 2) { action = "BUY";  conf = 55 + bullSignals * 10; }
      else if (bearSignals >= 2) { action = "SELL"; conf = 55 + bearSignals * 10; }

      sigs.push({
        pair: pair.label, action, price: closes[last],
        conf: Math.min(95, conf), pattern: detectPattern(cs),
        rsiVal, macdVal,
      });
    }
    sigs.sort((a, b) => b.conf - a.conf);
    setSignals(sigs);
  }, []);

  // ── Update trailing stops ─────────────────────────────────────────────────
  const updateTrailingStops = useCallback((pricesData: Record<string, PriceData>, candlesData: Record<string, Candle[]>) => {
    setActiveTrades(prev => prev.map(t => {
      const sym = t.pair.replace("/", "");
      const p = pricesData[sym];
      const cs = candlesData[sym];
      if (!p || !cs || cs.length < 14) return t;

      const curPrice = p.price;
      const atrVals  = atr(cs, 14);
      const lastATR  = atrVals[atrVals.length - 1] || 0;
      const newSL    = t.side === "BUY"
        ? curPrice - trailMult * lastATR
        : curPrice + trailMult * lastATR;

      const sl = t.side === "BUY"
        ? Math.max(t.sl, newSL)
        : Math.min(t.sl, newSL);

      const pnl = t.side === "BUY"
        ? (curPrice - t.entry) * t.amount
        : (t.entry - curPrice) * t.amount;
      const pnlPct = t.side === "BUY"
        ? (curPrice - t.entry) / t.entry * 100
        : (t.entry - curPrice) / t.entry * 100;

      // Check if SL hit
      const slHit = t.side === "BUY" ? curPrice <= sl : curPrice >= sl;
      if (slHit) {
        addNotif(`🛑 Трейлинг-стоп: ${t.pair} закрыт по $${curPrice.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`, "AlertTriangle", pnl >= 0 ? "#3fb950" : "#f85149");
        return { ...t, sl, pnl, pnlPct, currentPrice: curPrice, _closed: true } as unknown as Trade;
      }

      return { ...t, sl, pnl, pnlPct, currentPrice: curPrice, trailingActive: true };
    }).filter(t => !(t as unknown as { _closed?: boolean })._closed));
  }, [trailMult, addNotif]);

  // ── Run NN ─────────────────────────────────────────────────────────────────
  const runNN = useCallback(async (cs: Candle[], sym: string) => {
    setIsTraining(true);
    try {
      const result = await analyzeWithNN(cs, sym);
      setNNResult(result);
    } finally {
      setIsTraining(false);
    }
  }, []);

  // ── Open trade ─────────────────────────────────────────────────────────────
  const openTrade = useCallback((sig: Signal) => {
    const sym  = sig.pair.replace("/", "");
    const p    = prices[sym];
    if (!p) return;
    const entry  = p.price;
    const amount = (balance * riskPct / 100) / entry;
    const cs     = candlesMap[sym] || [];
    const atrV   = cs.length >= 14 ? atr(cs, 14) : [entry * 0.01];
    const lastATR = atrV[atrV.length - 1] || entry * 0.01;
    const sl = sig.action === "BUY" ? entry - trailMult * lastATR : entry + trailMult * lastATR;
    const tp = sig.action === "BUY" ? entry + 3 * trailMult * lastATR : entry - 3 * trailMult * lastATR;

    const trade: Trade = {
      id: Date.now().toString(), pair: sig.pair,
      side: sig.action as "BUY" | "SELL",
      entry, amount, sl, tp,
      trailingActive: true,
      trailingDist: trailMult * lastATR,
      time: new Date().toLocaleTimeString("ru-RU"),
      pnl: 0, pnlPct: 0,
    };
    setActiveTrades(prev => [...prev, trade]);
    addNotif(`📈 Открыта ${sig.action} по ${sig.pair} @ $${entry.toFixed(2)} | SL $${sl.toFixed(2)}`, "TrendingUp", sig.action === "BUY" ? "#3fb950" : "#f85149");
  }, [prices, balance, riskPct, candlesMap, trailMult, addNotif]);

  const closeTrade = useCallback((id: string) => {
    setActiveTrades(prev => {
      const t = prev.find(x => x.id === id);
      if (t) addNotif(`Позиция ${t.pair} закрыта вручную. P&L: ${(t.pnl || 0) >= 0 ? "+" : ""}$${(t.pnl || 0).toFixed(2)}`, "CheckCircle", (t.pnl || 0) >= 0 ? "#3fb950" : "#f85149");
      return prev.filter(x => x.id !== id);
    });
  }, [addNotif]);

  // ── Polling ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const clock = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    // Initial load
    fetchPrices();
    PAIRS.forEach(p => fetchCandles(p.id));

    const priceInterval = setInterval(fetchPrices, 10000);
    const candleInterval = setInterval(() => {
      PAIRS.forEach(p => fetchCandles(p.id));
    }, 30000);

    return () => { clearInterval(priceInterval); clearInterval(candleInterval); };
  }, [fetchPrices, fetchCandles, symbol]);

  // ── Regenerate signals когда загрузились свечи (цены опциональны) ─────────
  useEffect(() => {
    if (Object.keys(candlesMap).length > 0) {
      generateSignals(candlesMap, prices);
    }
  }, [prices, candlesMap, generateSignals]);

  // ── Update trailing stops every 10s ──────────────────────────────────────
  useEffect(() => {
    if (Object.keys(prices).length === 0) return;
    updateTrailingStops(prices, candlesMap);
  }, [prices, candlesMap, updateTrailingStops]);

  // ── NN: train when candles or symbol changes ──────────────────────────────
  useEffect(() => {
    const cs = candlesMap[symbol];
    if (cs && cs.length >= 30) {
      resetNN();
      runNN(cs, symbol);
    }
  }, [candlesMap, symbol, runNN]);

  // ── Auto-open trades based on NN ─────────────────────────────────────────
  useEffect(() => {
    if (!botActive || !nnResult || !nnResult.trained) return;
    if (nnResult.confidence < 70) return;
    const sym = PAIRS.find(p => p.id === symbol);
    if (!sym) return;
    const alreadyOpen = activeTrades.some(t => t.pair === sym.label);
    if (alreadyOpen) return;
    const sig = signals.find(s => s.pair === sym.label && s.conf >= 70);
    if (!sig || sig.action === "HOLD") return;
    // Only auto-open if NN agrees with signal
    if ((nnResult.prediction === "UP" && sig.action === "BUY") ||
        (nnResult.prediction === "DOWN" && sig.action === "SELL")) {
      addNotif(`🤖 Авто-сигнал нейросети: ${sig.action} ${sym.label} (уверенность ${nnResult.confidence}%)`, "Brain", "#58a6ff");
    }
  }, [nnResult, botActive, signals, activeTrades, symbol, addNotif]);

  const fmt = (d: Date) => d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const candles = candlesMap[symbol] || [];
  const totalPnl = activeTrades.reduce((s, t) => s + (t.pnl || 0), 0);

  return (
    <div className="bot-app" style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Sidebar */}
      <aside style={{ width: 200, background: "var(--bot-surface)", borderRight: "1px solid var(--bot-border)", display: "flex", flexDirection: "column", padding: "20px 12px", flexShrink: 0 }}>
        <div style={{ padding: "0 4px 24px", borderBottom: "1px solid var(--bot-border)", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--bot-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="Bot" size={16} style={{ color: "#fff" }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--bot-text)", lineHeight: 1 }}>TradeBot</div>
              <div style={{ fontSize: 10, color: "var(--bot-muted)" }}>Pro Terminal</div>
            </div>
          </div>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          {TABS.map(t => (
            <div key={t.id} className={`nav-item ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              <Icon name={t.icon as Parameters<typeof Icon>[0]["name"]} size={15} />
              {t.label}
              {t.id === "alerts" && notifications.length > 0 && (
                <span style={{ marginLeft: "auto", minWidth: 18, height: 18, borderRadius: 9, background: "var(--bot-red)", color: "#fff", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                  {notifications.length > 9 ? "9+" : notifications.length}
                </span>
              )}
            </div>
          ))}
        </nav>
        <div style={{ borderTop: "1px solid var(--bot-border)", paddingTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: botActive ? "var(--bot-green)" : "var(--bot-muted)" }} />
            <span style={{ fontSize: 11, color: botActive ? "var(--bot-green)" : "var(--bot-muted)" }}>{botActive ? "В работе" : "Остановлен"}</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--bot-muted)" }}>{fmt(time)}</div>
          <div className="mono" style={{ fontSize: 10, color: "var(--bot-muted)", marginTop: 2 }}>PO: ${balance.toLocaleString()}</div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, paddingBottom: 16, borderBottom: "1px solid var(--bot-border)" }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--bot-text)", margin: 0 }}>{TABS.find(t => t.id === tab)?.label}</h1>
            <div style={{ fontSize: 11, color: "var(--bot-muted)", marginTop: 2 }}>Binance · реальные данные · {new Date().toLocaleDateString("ru-RU")}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {prices["BTCUSDT"] && (
              <div style={{ textAlign: "right" as const }}>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--bot-text)" }}>BTC ${Math.round(prices["BTCUSDT"].price).toLocaleString()}</div>
                <PriceTag change={prices["BTCUSDT"].change} />
              </div>
            )}
            <div style={{ textAlign: "right" as const }}>
              <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)" }}>PO ${balance.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: totalPnl >= 0 ? "var(--bot-green)" : "var(--bot-red)" }}>
                {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)} P&L
              </div>
            </div>
          </div>
        </div>

        <div key={tab}>
          {tab === "dashboard"  && <Dashboard prices={prices} candles={candles} activeTrades={activeTrades} balance={balance} botActive={botActive} setBotActive={setBotActive} addNotif={addNotif} />}
          {tab === "signals"    && <Signals signals={signals} prices={prices} openTrade={openTrade} botActive={botActive} />}
          {tab === "ai"         && <AITab candles={candles} nnResult={nnResult} symbol={symbol} setSymbol={sym => { setSymbol(sym); fetchCandles(sym); }} isTraining={isTraining} />}
          {tab === "settings"   && <Settings balance={balance} setBalance={setBalance} trailMult={trailMult} setTrailMult={setTrailMult} riskPct={riskPct} setRiskPct={setRiskPct} strategy={strategy} setStrategy={setStrategy} addNotif={addNotif} />}
          {tab === "portfolio"  && <Portfolio activeTrades={activeTrades} closeTrade={closeTrade} prices={prices} />}
          {tab === "alerts"     && <AlertsTab notifications={notifications} clearNotifs={() => setNotifs([])} />}
        </div>
      </main>
    </div>
  );
}