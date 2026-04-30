import { useState, useEffect, useRef, useCallback } from "react";
import Icon from "@/components/ui/icon";
import { type Candle } from "@/lib/indicators";

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
  price: number; conf: number; accuracy: number;
  rsiVal: number; macdVal: number; macdSignal: number;
  atr: number; forecastMinutes: number;
  targetPrice: number; targetChangePct: number;
  bull: number; bear: number;
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

// ─── Countdown timer для сигнала ─────────────────────────────────────────────
function SignalCountdown({ minutes, action }: { minutes: number; action: string }) {
  const [secsLeft, setSecsLeft] = useState(minutes * 60);
  useEffect(() => {
    setSecsLeft(minutes * 60);
    const t = setInterval(() => setSecsLeft(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [minutes]);
  const pct  = secsLeft / (minutes * 60);
  const m    = Math.floor(secsLeft / 60);
  const s    = secsLeft % 60;
  const col  = action === "BUY" ? "var(--bot-green)" : action === "SELL" ? "var(--bot-red)" : "var(--bot-yellow)";
  const size = 36;
  const r    = 14;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--bot-border)" strokeWidth={3} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={3}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s linear" }} />
      </svg>
      <span className="mono" style={{ fontSize: 10, color: col, lineHeight: 1 }}>
        {m > 0 ? `${m}м${s.toString().padStart(2, "0")}с` : `${s}с`}
      </span>
      <span style={{ fontSize: 9, color: "var(--bot-muted)" }}>прогноз</span>
    </div>
  );
}

// ─── Signals ──────────────────────────────────────────────────────────────────
function Signals({ signals, prices, openTrade, botActive, interval, setInterval: setIntervalProp, loading }: {
  signals: Signal[];
  prices: Record<string, PriceData>;
  openTrade: (sig: Signal) => void;
  botActive: boolean;
  interval: string;
  setInterval: (v: string) => void;
  loading: boolean;
}) {
  const INTERVALS = [
    { value: "1m",  label: "1 мин"  },
    { value: "5m",  label: "5 мин"  },
    { value: "15m", label: "15 мин" },
    { value: "30m", label: "30 мин" },
    { value: "1h",  label: "1 час"  },
  ];

  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--bot-text)" }}>Торговые сигналы · реальные данные</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: loading ? "var(--bot-yellow)" : "var(--bot-green)" }} />
          <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>{loading ? "Загрузка…" : "Обновлено"}</span>
        </div>
      </div>

      {/* Interval selector */}
      <div className="glow-card p-3" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, color: "var(--bot-muted)", whiteSpace: "nowrap" as const }}>Таймфрейм прогноза:</span>
        <div style={{ display: "flex", gap: 6 }}>
          {INTERVALS.map(iv => (
            <button key={iv.value} onClick={() => setIntervalProp(iv.value)} style={{
              padding: "4px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: interval === iv.value ? "var(--bot-accent)" : "var(--bot-surface-2)",
              color: interval === iv.value ? "#fff" : "var(--bot-muted)",
              border: interval === iv.value ? "none" : "1px solid var(--bot-border)",
              transition: "all 0.15s"
            }}>{iv.label}</button>
          ))}
        </div>
        <span style={{ fontSize: 10, color: "var(--bot-muted)", marginLeft: "auto" }}>
          Прогноз = 5 × {interval}
        </span>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, padding: "0 4px" }}>
        {[
          { label: "Уверенность сигнала", desc: "сила индикаторов + бэктест" },
          { label: "Точность", desc: "% верных сигналов исторически" },
          { label: "Таймер", desc: "через сколько ждать движения" },
        ].map((l, i) => (
          <div key={i} style={{ fontSize: 10, color: "var(--bot-muted)" }}>
            <span style={{ fontWeight: 600, color: "var(--bot-text)" }}>{l.label}</span> — {l.desc}
          </div>
        ))}
      </div>

      {/* Loading */}
      {loading && signals.length === 0 && (
        <div className="glow-card p-8" style={{ textAlign: "center" as const }}>
          <div className="pulse-dot" style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--bot-blue)", margin: "0 auto 10px" }} />
          <div style={{ fontSize: 13, color: "var(--bot-muted)" }}>Анализирую рынок, считаю бэктест…</div>
        </div>
      )}

      {/* Signal cards */}
      {signals.map((s, i) => {
        const p = prices[s.pair.replace("/", "")];
        const curPrice = p?.price ?? s.price;
        const isUp = s.action === "BUY";
        const isDown = s.action === "SELL";
        const confColor = s.conf >= 75 ? "var(--bot-green)" : s.conf >= 60 ? "var(--bot-yellow)" : "var(--bot-muted)";
        const accColor  = s.accuracy >= 65 ? "var(--bot-green)" : s.accuracy >= 50 ? "var(--bot-yellow)" : "var(--bot-red)";

        return (
          <div key={i} className="glow-card" style={{
            border: s.action !== "HOLD" && s.conf >= 70
              ? `1px solid ${isUp ? "rgba(63,185,80,0.3)" : "rgba(248,81,73,0.3)"}`
              : "1px solid var(--bot-border)"
          }}>
            {/* Top row */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--bot-border)" }}>
              <SignalBadge action={s.action} />
              <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: "var(--bot-text)" }}>{s.pair}</span>

              {/* Прогноз цены */}
              {s.action !== "HOLD" && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name={isUp ? "TrendingUp" : "TrendingDown"} size={13}
                    style={{ color: isUp ? "var(--bot-green)" : "var(--bot-red)" }} />
                  <span className="mono" style={{ fontSize: 12, color: isUp ? "var(--bot-green)" : "var(--bot-red)" }}>
                    {isUp ? "+" : ""}{s.targetChangePct.toFixed(2)}% → ${s.targetPrice > 100 ? Math.round(s.targetPrice).toLocaleString() : s.targetPrice.toFixed(5)}
                  </span>
                </div>
              )}

              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
                {/* Текущая цена */}
                <div style={{ textAlign: "right" as const }}>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: "var(--bot-text)" }}>
                    ${curPrice > 100 ? Math.round(curPrice).toLocaleString() : curPrice.toFixed(5)}
                  </div>
                  {p && <PriceTag change={p.change} />}
                </div>
                {/* Таймер */}
                {s.action !== "HOLD" && <SignalCountdown minutes={s.forecastMinutes} action={s.action} />}
                {/* Открыть */}
                <button disabled={!botActive || s.action === "HOLD"} onClick={() => openTrade(s)} style={{
                  padding: "8px 18px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                  cursor: botActive && s.action !== "HOLD" ? "pointer" : "not-allowed",
                  background: !botActive || s.action === "HOLD" ? "var(--bot-surface-2)" : "var(--bot-accent)",
                  color: !botActive || s.action === "HOLD" ? "var(--bot-muted)" : "#fff",
                  border: "none", transition: "all 0.15s"
                }}>
                  {s.action === "HOLD" ? "Ожидать" : "Открыть"}
                </button>
              </div>
            </div>

            {/* Bottom row — метрики */}
            <div style={{ display: "flex", gap: 0, padding: "10px 16px" }}>
              {/* Уверенность */}
              <div style={{ flex: 1, borderRight: "1px solid var(--bot-border)", paddingRight: 16 }}>
                <div style={{ fontSize: 10, color: "var(--bot-muted)", marginBottom: 4 }}>Уверенность</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 4, background: "var(--bot-border)", borderRadius: 2 }}>
                    <div style={{ width: `${s.conf}%`, height: "100%", background: confColor, borderRadius: 2, transition: "width 0.5s" }} />
                  </div>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: confColor, minWidth: 36 }}>{s.conf}%</span>
                </div>
              </div>

              {/* Историческая точность */}
              <div style={{ flex: 1, borderRight: "1px solid var(--bot-border)", padding: "0 16px" }}>
                <div style={{ fontSize: 10, color: "var(--bot-muted)", marginBottom: 4 }}>Точность (бэктест)</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 4, background: "var(--bot-border)", borderRadius: 2 }}>
                    <div style={{ width: `${s.accuracy}%`, height: "100%", background: accColor, borderRadius: 2, transition: "width 0.5s" }} />
                  </div>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: accColor, minWidth: 36 }}>{s.accuracy}%</span>
                </div>
              </div>

              {/* Индикаторы */}
              <div style={{ flex: 2, paddingLeft: 16, display: "flex", gap: 16, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>
                  RSI <span className="mono" style={{ color: s.rsiVal > 70 ? "var(--bot-red)" : s.rsiVal < 30 ? "var(--bot-green)" : "var(--bot-text)" }}>{s.rsiVal.toFixed(0)}</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>
                  MACD <span className="mono" style={{ color: s.macdVal > s.macdSignal ? "var(--bot-green)" : "var(--bot-red)" }}>{s.macdVal > 0 ? "+" : ""}{s.macdVal.toFixed(2)}</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>
                  Bull/Bear <span className="mono" style={{ color: "var(--bot-text)" }}>{s.bull}/{s.bear}</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>
                  ATR <span className="mono" style={{ color: "var(--bot-blue)" }}>{s.atr > 1 ? s.atr.toFixed(1) : s.atr.toFixed(4)}</span>
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── AI Neural Network Tab ────────────────────────────────────────────────────
interface NNData {
  pair: string; action: string; price: number;
  conf: number; accuracy: number; nnProb: number; nnConf: number; indConf: number; agreement: string;
  rsi: number; stochRsi: number; williamsR: number; cci: number;
  macd: number; macdSignal: number; ema9: number; ema21: number; atr: number;
  bull: number; bear: number; forecastMinutes: number;
  targetPrice: number; targetChangePct: number;
}

function AITab({ candles, symbol, setSymbol }: {
  candles: Candle[]; symbol: string; setSymbol: (s: string) => void;
}) {
  const [nnData, setNNData]       = useState<NNData | null>(null);
  const [loading, setLoading]     = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(30);
  const [interval, setInterval_]  = useState("5m");

  const fetchNN = useCallback(async (sym: string, iv: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}?action=nn&symbol=${sym}&interval=${iv}&limit=300`);
      if (!res.ok) return;
      const d: NNData = await res.json();
      setNNData(d);
      setLastUpdate(new Date());
      setCountdown(30);
    } catch (e) { void e; }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchNN(symbol, interval);
  }, [symbol, interval, fetchNN]);

  useEffect(() => {
    const poll = setInterval(() => fetchNN(symbol, interval), 30000);
    return () => clearInterval(poll);
  }, [symbol, interval, fetchNN]);

  useEffect(() => {
    const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [lastUpdate]);

  const d = nnData;
  const isUp   = d?.action === "BUY";
  const isDown = d?.action === "SELL";
  const actionColor = isUp ? "var(--bot-green)" : isDown ? "var(--bot-red)" : "var(--bot-yellow)";

  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--bot-text)", margin: 0 }}>Нейросеть · ансамбль 3 MLP</h2>
          <div style={{ fontSize: 10, color: "var(--bot-muted)", marginTop: 2 }}>
            15 признаков · 300 свечей · обновление каждые 30с
            {lastUpdate && <span> · обновлено {lastUpdate.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Countdown */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 6, background: "var(--bot-surface-2)", border: "1px solid var(--bot-border)" }}>
            <div className="pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: loading ? "var(--bot-yellow)" : "var(--bot-green)" }} />
            <span className="mono" style={{ fontSize: 11, color: "var(--bot-muted)" }}>{loading ? "…" : `${countdown}с`}</span>
          </div>
          <button onClick={() => fetchNN(symbol, interval)} disabled={loading} style={{
            padding: "5px 12px", borderRadius: 5, fontSize: 11, cursor: "pointer",
            background: "var(--bot-accent)", color: "#fff", border: "none"
          }}>Обновить</button>
        </div>
      </div>

      {/* Pair + interval selector */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
        {PAIRS.map(p => (
          <button key={p.id} onClick={() => setSymbol(p.id)} style={{
            padding: "5px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: symbol === p.id ? "var(--bot-accent)" : "var(--bot-surface-2)",
            color: symbol === p.id ? "#fff" : "var(--bot-muted)",
            border: symbol === p.id ? "none" : "1px solid var(--bot-border)"
          }}>{p.label}</button>
        ))}
        <div style={{ borderLeft: "1px solid var(--bot-border)", margin: "0 4px" }} />
        {["1m","5m","15m","30m","1h"].map(iv => (
          <button key={iv} onClick={() => setInterval_(iv)} style={{
            padding: "5px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer",
            background: interval === iv ? "var(--bot-surface-2)" : "transparent",
            color: interval === iv ? "var(--bot-text)" : "var(--bot-muted)",
            border: "1px solid var(--bot-border)"
          }}>{iv}</button>
        ))}
      </div>

      {/* Loading overlay */}
      {loading && !d && (
        <div className="glow-card p-10" style={{ textAlign: "center" as const }}>
          <div className="pulse-dot" style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--bot-blue)", margin: "0 auto 12px" }} />
          <div style={{ color: "var(--bot-muted)", fontSize: 13 }}>Обучаю нейросеть на 300 свечах…</div>
          <div style={{ color: "var(--bot-muted)", fontSize: 11, marginTop: 6 }}>Это занимает ~10–15 секунд</div>
        </div>
      )}

      {d && (
        <>
          {/* Main prediction card */}
          <div className="glow-card p-5" style={{
            border: `1px solid ${isUp ? "rgba(63,185,80,0.4)" : isDown ? "rgba(248,81,73,0.4)" : "rgba(210,153,34,0.4)"}`,
            position: "relative" as const
          }}>
            {loading && (
              <div style={{ position: "absolute" as const, top: 10, right: 10, display: "flex", alignItems: "center", gap: 5 }}>
                <div className="pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--bot-yellow)" }} />
                <span style={{ fontSize: 10, color: "var(--bot-yellow)" }}>обновляется</span>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 20, marginBottom: 20 }}>
              {[
                { label: "Сигнал", val: d.action === "BUY" ? "▲ ВВЕРХ" : d.action === "SELL" ? "▼ ВНИЗ" : "— ЖДАТЬ", color: actionColor, size: 24 },
                { label: "Уверенность", val: `${d.conf}%`, color: d.conf >= 75 ? "var(--bot-green)" : "var(--bot-yellow)", size: 28 },
                { label: "Точность NN", val: `${d.accuracy}%`, color: d.accuracy >= 60 ? "var(--bot-green)" : "var(--bot-yellow)", size: 28 },
                { label: "P(ВВЕРХ)", val: `${(d.nnProb * 100).toFixed(0)}%`, color: d.nnProb > 0.55 ? "var(--bot-green)" : d.nnProb < 0.45 ? "var(--bot-red)" : "var(--bot-muted)", size: 28 },
                { label: "Цена", val: `$${d.price > 100 ? Math.round(d.price).toLocaleString() : d.price.toFixed(5)}`, color: "var(--bot-text)", size: 18 },
              ].map((m, i) => (
                <div key={i} style={{ textAlign: "center" as const }}>
                  <div style={{ fontSize: 10, color: "var(--bot-muted)", marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>{m.label}</div>
                  <div className="mono" style={{ fontSize: m.size, fontWeight: 800, color: m.color, lineHeight: 1 }}>{m.val}</div>
                </div>
              ))}
            </div>

            {/* Prob bar */}
            <div>
              <div style={{ height: 8, borderRadius: 4, background: "var(--bot-border)", overflow: "hidden" }}>
                <div style={{ width: `${d.nnProb * 100}%`, height: "100%", borderRadius: 4, transition: "width 0.8s ease",
                  background: `linear-gradient(90deg, var(--bot-red) 0%, var(--bot-yellow) 50%, var(--bot-green) 100%)` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span style={{ fontSize: 10, color: "var(--bot-red)" }}>▼ ВНИЗ {(100 - d.nnProb * 100).toFixed(0)}%</span>
                <span style={{ fontSize: 10, color: "var(--bot-muted)" }}>нейросеть · 3 модели</span>
                <span style={{ fontSize: 10, color: "var(--bot-green)" }}>▲ ВВЕРХ {(d.nnProb * 100).toFixed(0)}%</span>
              </div>
            </div>

            {/* Agreement */}
            <div style={{ marginTop: 12, padding: "8px 14px", borderRadius: 6, background: "var(--bot-surface-2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>Согласие моделей</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: d.agreement === "full" ? "var(--bot-green)" : d.agreement === "none" ? "var(--bot-muted)" : "var(--bot-yellow)" }}>
                {d.agreement === "full" ? "✓ Полное (NN + Индикаторы)" : d.agreement === "indicator" ? "Индикаторы" : d.agreement === "nn" ? "Нейросеть" : "Нет сигнала"}
              </span>
            </div>

            {/* Forecast */}
            {d.action !== "HOLD" && (
              <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
                <div style={{ flex: 1, padding: "10px 14px", borderRadius: 6, background: isUp ? "rgba(63,185,80,0.08)" : "rgba(248,81,73,0.08)", border: `1px solid ${isUp ? "rgba(63,185,80,0.2)" : "rgba(248,81,73,0.2)"}` }}>
                  <div style={{ fontSize: 10, color: "var(--bot-muted)", marginBottom: 4 }}>Цель через {d.forecastMinutes} мин (2×ATR)</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: actionColor }}>
                    ${d.targetPrice > 100 ? Math.round(d.targetPrice).toLocaleString() : d.targetPrice.toFixed(5)}
                    <span style={{ fontSize: 12, marginLeft: 8 }}>{d.targetChangePct > 0 ? "+" : ""}{d.targetChangePct.toFixed(3)}%</span>
                  </div>
                </div>
                <div style={{ flex: 1, padding: "10px 14px", borderRadius: 6, background: "var(--bot-surface-2)" }}>
                  <div style={{ fontSize: 10, color: "var(--bot-muted)", marginBottom: 4 }}>Трейлинг-стоп ({d.action === "BUY" ? "LONG" : "SHORT"})</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--bot-blue)" }}>
                    ${d.action === "BUY"
                      ? (d.price - 2 * d.atr).toFixed(d.price > 100 ? 0 : 5)
                      : (d.price + 2 * d.atr).toFixed(d.price > 100 ? 0 : 5)}
                    <span style={{ fontSize: 11, color: "var(--bot-muted)", marginLeft: 6 }}>2×ATR</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Indicators grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="glow-card p-4">
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--bot-text)", marginBottom: 12 }}>Индикаторы (8 шт.)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {[
                  { name: "RSI (14)",      val: d.rsi.toFixed(1),      status: d.rsi < 30 ? "Перепродан" : d.rsi > 70 ? "Перекуплен" : "Нейтральный", col: d.rsi < 30 ? "var(--bot-green)" : d.rsi > 70 ? "var(--bot-red)" : "var(--bot-yellow)" },
                  { name: "Stoch RSI",     val: d.stochRsi.toFixed(1), status: d.stochRsi < 20 ? "Перепродан" : d.stochRsi > 80 ? "Перекуплен" : "Нейтральный", col: d.stochRsi < 20 ? "var(--bot-green)" : d.stochRsi > 80 ? "var(--bot-red)" : "var(--bot-yellow)" },
                  { name: "Williams %R",   val: d.williamsR.toFixed(1),status: d.williamsR < -80 ? "Перепродан" : d.williamsR > -20 ? "Перекуплен" : "Нейтральный", col: d.williamsR < -80 ? "var(--bot-green)" : d.williamsR > -20 ? "var(--bot-red)" : "var(--bot-yellow)" },
                  { name: "CCI (20)",      val: d.cci.toFixed(0),      status: d.cci < -100 ? "Перепродан" : d.cci > 100 ? "Перекуплен" : "Нейтральный", col: d.cci < -100 ? "var(--bot-green)" : d.cci > 100 ? "var(--bot-red)" : "var(--bot-yellow)" },
                  { name: "MACD",          val: (d.macd > 0 ? "+" : "") + d.macd.toFixed(3), status: d.macd > d.macdSignal ? "Бычий" : "Медвежий", col: d.macd > d.macdSignal ? "var(--bot-green)" : "var(--bot-red)" },
                  { name: "EMA 9 / 21",   val: d.ema9 > d.ema21 ? "Выше" : "Ниже",          status: d.ema9 > d.ema21 ? "Бычий" : "Медвежий",    col: d.ema9 > d.ema21 ? "var(--bot-green)" : "var(--bot-red)" },
                  { name: "ATR (14)",      val: d.atr > 1 ? d.atr.toFixed(1) : d.atr.toFixed(5), status: "Волатильность", col: "var(--bot-blue)" },
                  { name: "Счёт Bull/Bear",val: `${d.bull} / ${d.bear}`, status: d.bull > d.bear ? "Бычий перевес" : "Медвежий перевес", col: d.bull > d.bear ? "var(--bot-green)" : "var(--bot-red)" },
                ].map((ind, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 7, borderBottom: i < 7 ? "1px solid var(--bot-border)" : "none" }}>
                    <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>{ind.name}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className="mono" style={{ fontSize: 11, color: "var(--bot-text)" }}>{ind.val}</span>
                      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "var(--bot-surface-2)", color: ind.col }}>{ind.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glow-card p-4">
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--bot-text)", marginBottom: 12 }}>Разбивка уверенности</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { label: "Нейросеть (ансамбль)", val: d.nnConf, color: "var(--bot-blue)" },
                  { label: "Индикаторы (8 штук)", val: d.indConf, color: "var(--bot-yellow)" },
                  { label: "Итоговая уверенность", val: d.conf, color: actionColor },
                  { label: "Точность (бэктест 300 св.)", val: d.accuracy, color: d.accuracy >= 60 ? "var(--bot-green)" : "var(--bot-red)" },
                ].map((b, i) => (
                  <div key={i}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>{b.label}</span>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: b.color }}>{b.val}%</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: "var(--bot-border)" }}>
                      <div style={{ width: `${b.val}%`, height: "100%", borderRadius: 3, background: b.color, transition: "width 0.6s ease" }} />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 16, padding: "10px 12px", borderRadius: 6, background: "var(--bot-surface-2)" }}>
                <div style={{ fontSize: 10, color: "var(--bot-muted)", marginBottom: 6 }}>Архитектура ансамбля</div>
                {[{ arch: "MLP 32→16→1", seed: 42 }, { arch: "MLP 24→12→1", seed: 123 }, { arch: "MLP 40→20→1", seed: 7 }].map((m, i) => (
                  <div key={i} style={{ fontSize: 10, color: "var(--bot-muted)", marginBottom: 2 }}>
                    <span style={{ color: "var(--bot-blue)" }}>#{i + 1}</span> {m.arch} · momentum SGD · 150 эпох
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="glow-card p-4">
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--bot-text)", marginBottom: 10 }}>График свечей · {PAIRS.find(p => p.id === symbol)?.label}</div>
            <div style={{ overflowX: "auto" }}>
              <CandleChart candles={candles} height={90} />
            </div>
          </div>
        </>
      )}
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

  const [prices, setPrices]             = useState<Record<string, PriceData>>({});
  const [candlesMap, setCandlesMap]     = useState<Record<string, Candle[]>>({});
  const [signals, setSignals]           = useState<Signal[]>([]);
  const [loadingSignals, setLoadingSig] = useState(false);
  const [sigInterval, setSigInterval]   = useState("5m");
  const [activeTrades, setActiveTrades] = useState<Trade[]>([]);
  const [notifications, setNotifs]      = useState<Notification[]>([]);


  const tradesRef = useRef(activeTrades);
  tradesRef.current = activeTrades;

  // ── Helpers ────────────────────────────────────────────────────────────────
  const addNotif = useCallback((msg: string, icon: string, color: string) => {
    setNotifs(prev => [...prev.slice(-19), { id: Date.now().toString(), icon, msg, time: new Date(), color }]);
  }, []);

  // ── Fetch signals — через бэкенд (бэктест + все индикаторы) ───────────────
  const fetchSignals = useCallback(async (iv: string) => {
    setLoadingSig(true);
    try {
      const res = await fetch(`${API_URL}?action=signals&interval=${iv}&limit=150`);
      if (!res.ok) return;
      const raw: Array<{
        pair: string; action: string; price: number; conf: number; accuracy: number;
        rsi: number; macd: number; macdSignal: number; atr: number;
        forecastMinutes: number; targetPrice: number; targetChangePct: number;
        bull: number; bear: number;
      }> = await res.json();
      const sigs: Signal[] = raw
        .filter(r => !("error" in r))
        .map(r => ({
          pair: r.pair.replace("USDT", "/USDT"),
          action: r.action as "BUY" | "SELL" | "HOLD",
          price: r.price, conf: r.conf, accuracy: r.accuracy,
          rsiVal: r.rsi, macdVal: r.macd, macdSignal: r.macdSignal,
          atr: r.atr, forecastMinutes: r.forecastMinutes,
          targetPrice: r.targetPrice, targetChangePct: r.targetChangePct,
          bull: r.bull, bear: r.bear,
        }));
      setSignals(sigs);
      // Обновляем цены из сигналов
      const priceUpdate: Record<string, PriceData> = {};
      raw.forEach(r => {
        priceUpdate[r.pair] = { price: r.price, change: r.targetChangePct, high: r.price, low: r.price, volume: 0 };
      });
      setPrices(prev => ({ ...prev, ...priceUpdate }));
    } catch (e) { void e; }
    finally { setLoadingSig(false); }
  }, []);

  // ── Fetch prices — через бэкенд ────────────────────────────────────────────
  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}?action=prices`);
      if (!res.ok) return;
      const data = await res.json();
      if (Object.keys(data).length > 0) setPrices(data);
    } catch (e) { void e; }
  }, []);

  // ── Fetch candles — через бэкенд ───────────────────────────────────────────
  const fetchCandles = useCallback(async (sym: string) => {
    try {
      const res = await fetch(`${API_URL}?action=klines&symbol=${sym}&interval=5m&limit=100`);
      if (!res.ok) return;
      const data: Candle[] = await res.json();
      setCandlesMap(prev => ({ ...prev, [sym]: data }));
      return data;
    } catch (e) { void e; }
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

  // ── Open trade ─────────────────────────────────────────────────────────────
  const openTrade = useCallback((sig: Signal) => {
    const sym  = sig.pair.replace("/", "");
    const p    = prices[sym];
    const entry  = p?.price ?? sig.price;
    if (!entry) return;
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
    fetchSignals(sigInterval);
    fetchPrices();
    PAIRS.forEach(p => fetchCandles(p.id));

    const signalInterval = setInterval(() => fetchSignals(sigInterval), 60000);
    const priceInterval  = setInterval(fetchPrices, 15000);
    const candleInterval = setInterval(() => PAIRS.forEach(p => fetchCandles(p.id)), 60000);

    return () => { clearInterval(signalInterval); clearInterval(priceInterval); clearInterval(candleInterval); };
  }, [fetchSignals, fetchPrices, fetchCandles, sigInterval]);

  // ── Update trailing stops every 10s ──────────────────────────────────────
  useEffect(() => {
    if (Object.keys(prices).length === 0) return;
    updateTrailingStops(prices, candlesMap);
  }, [prices, candlesMap, updateTrailingStops]);



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
          {tab === "signals"    && <Signals signals={signals} prices={prices} openTrade={openTrade} botActive={botActive} interval={sigInterval} setInterval={iv => { setSigInterval(iv); fetchSignals(iv); }} loading={loadingSignals} />}
          {tab === "ai"         && <AITab candles={candles} symbol={symbol} setSymbol={sym => { setSymbol(sym); fetchCandles(sym); }} />}
          {tab === "settings"   && <Settings balance={balance} setBalance={setBalance} trailMult={trailMult} setTrailMult={setTrailMult} riskPct={riskPct} setRiskPct={setRiskPct} strategy={strategy} setStrategy={setStrategy} addNotif={addNotif} />}
          {tab === "portfolio"  && <Portfolio activeTrades={activeTrades} closeTrade={closeTrade} prices={prices} />}
          {tab === "alerts"     && <AlertsTab notifications={notifications} clearNotifs={() => setNotifs([])} />}
        </div>
      </main>
    </div>
  );
}