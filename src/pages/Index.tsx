import { useState, useEffect } from "react";
import Icon from "@/components/ui/icon";

// ─── Mock data ───────────────────────────────────────────────────────────────
const SIGNALS = [
  { pair: "BTC/USDT", action: "BUY",  price: "67 420.50", conf: "94%", pattern: "Bull Flag",      time: "02:14" },
  { pair: "ETH/USDT", action: "SELL", price: "3 541.20",  conf: "87%", pattern: "Head&Shoulders",  time: "01:58" },
  { pair: "SOL/USDT", action: "BUY",  price: "178.30",    conf: "91%", pattern: "Double Bottom",   time: "01:33" },
  { pair: "BNB/USDT", action: "HOLD", price: "612.80",    conf: "72%", pattern: "Triangle",        time: "01:10" },
  { pair: "XRP/USDT", action: "BUY",  price: "0.6240",    conf: "88%", pattern: "Breakout",        time: "00:47" },
];

const PORTFOLIO = [
  { asset: "BTC",  amount: "0.3420", value: "23 057", pnl: "+12.4%", pos: true  },
  { asset: "ETH",  amount: "4.8100", value: "17 033", pnl: "+8.7%",  pos: true  },
  { asset: "SOL",  amount: "42.000", value: "7 488",  pnl: "+31.2%", pos: true  },
  { asset: "BNB",  amount: "8.5000", value: "5 208",  pnl: "-2.1%",  pos: false },
  { asset: "USDT", amount: "12 450", value: "12 450", pnl: "0.0%",   pos: true  },
];

const HISTORY = [
  { pair: "BTC/USDT", side: "BUY",  entry: "64 100", exit: "67 420", pnl: "+5.2%",  date: "28 апр" },
  { pair: "ETH/USDT", side: "SELL", entry: "3 720",  exit: "3 541",  pnl: "+4.8%",  date: "27 апр" },
  { pair: "SOL/USDT", side: "BUY",  entry: "155.0",  exit: "178.3",  pnl: "+15.0%", date: "26 апр" },
  { pair: "BNB/USDT", side: "BUY",  entry: "625.0",  exit: "612.8",  pnl: "-1.9%",  date: "25 апр" },
  { pair: "ADA/USDT", side: "BUY",  entry: "0.440",  exit: "0.489",  pnl: "+11.1%", date: "24 апр" },
];

const NOTIFICATIONS = [
  { icon: "TrendingUp",   type: "signal", msg: "Новый сигнал BUY по BTC/USDT",         time: "2 мин назад",  color: "#3fb950" },
  { icon: "AlertTriangle",type: "risk",   msg: "Волатильность ETH превысила порог 4%",  time: "14 мин назад", color: "#d29922" },
  { icon: "Zap",          type: "system", msg: "Стратегия RSI+MACD обновлена",          time: "1 час назад",  color: "#58a6ff" },
  { icon: "CheckCircle",  type: "trade",  msg: "Сделка SOL/USDT закрыта +15.0%",       time: "3 час назад",  color: "#3fb950" },
  { icon: "XCircle",      type: "error",  msg: "Ошибка подключения к Binance API",      time: "5 час назад",  color: "#f85149" },
];

const CHART_BARS = [40, 65, 45, 80, 55, 90, 70, 85, 60, 95, 75, 88];

const TABS = [
  { id: "dashboard", label: "Панель",      icon: "LayoutDashboard" },
  { id: "signals",   label: "Сигналы",     icon: "Zap"             },
  { id: "settings",  label: "Настройки",   icon: "Settings"        },
  { id: "stats",     label: "Статистика",  icon: "BarChart2"       },
  { id: "portfolio", label: "Портфель",    icon: "Briefcase"       },
  { id: "alerts",    label: "Уведомления", icon: "Bell"            },
];

// ─── Shared components ────────────────────────────────────────────────────────
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

function MiniChart() {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 48 }}>
      {CHART_BARS.map((h, i) => (
        <div key={i} className="chart-bar" style={{
          width: 8, height: `${h}%`,
          background: i === CHART_BARS.length - 1 ? "var(--bot-blue)" : "var(--bot-green-dim)",
          borderRadius: 2,
          animationDelay: `${i * 0.04}s`,
        }} />
      ))}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ botActive, setBotActive }: { botActive: boolean; setBotActive: (v: boolean) => void }) {
  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Status bar */}
      <div className="glow-card p-4" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="pulse-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: botActive ? "var(--bot-green)" : "var(--bot-red)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--bot-text)" }}>
            TradeBot {botActive ? "активен" : "остановлен"}
          </span>
          <span className="mono" style={{ fontSize: 11, color: "var(--bot-muted)" }}>v2.4.1 · Binance</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setBotActive(!botActive)} style={{
            padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: botActive ? "rgba(248,81,73,0.15)" : "rgba(63,185,80,0.15)",
            color: botActive ? "var(--bot-red)" : "var(--bot-green)",
            border: `1px solid ${botActive ? "rgba(248,81,73,0.3)" : "rgba(63,185,80,0.3)"}`,
            transition: "all 0.2s"
          }}>
            {botActive ? "Остановить" : "Запустить"}
          </button>
          <button style={{
            padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: "var(--bot-surface-2)", color: "var(--bot-muted)",
            border: "1px solid var(--bot-border)"
          }}>Сброс</button>
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <MetricCard label="Баланс"            value="$65 236"  sub="↑ +$2 840 сегодня" color="var(--bot-text)"  icon="Wallet"     />
        <MetricCard label="P&L сегодня"       value="+4.54%"   sub="23 сделки"         color="var(--bot-green)" icon="TrendingUp" />
        <MetricCard label="Активных позиций"  value="7"         sub="макс. риск 2%"     color="var(--bot-blue)"  icon="Activity"   />
        <MetricCard label="Win Rate"          value="73.2%"    sub="за 30 дней"         color="var(--bot-text)"  icon="Target"     />
      </div>

      {/* Chart + signals */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="glow-card p-4">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)" }}>P&L за 12 часов</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--bot-green)" }}>+$2 840</span>
          </div>
          <MiniChart />
        </div>
        <div className="glow-card p-4">
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 12 }}>Последние сигналы</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {SIGNALS.slice(0, 3).map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <SignalBadge action={s.action} />
                  <span className="mono" style={{ fontSize: 12, color: "var(--bot-text)" }}>{s.pair}</span>
                </div>
                <span className="mono" style={{ fontSize: 11, color: "var(--bot-muted)" }}>{s.conf}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Risk bars */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {[
          { label: "Волатильность BTC", value: 72, color: "var(--bot-yellow)" },
          { label: "Риск портфеля",     value: 34, color: "var(--bot-green)"  },
          { label: "Просадка DD",       value: 8,  color: "var(--bot-blue)"   },
        ].map((item, i) => (
          <div key={i} className="glow-card p-4">
            <div style={{ fontSize: 11, color: "var(--bot-muted)", marginBottom: 8 }}>{item.label}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, height: 4, background: "var(--bot-border)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${item.value}%`, height: "100%", background: item.color, borderRadius: 2 }} />
              </div>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: item.color }}>{item.value}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Signals ──────────────────────────────────────────────────────────────────
function Signals() {
  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--bot-text)" }}>Активные сигналы</h2>
        <div className="mono" style={{ fontSize: 11, color: "var(--bot-muted)" }}>Обновлено 2 мин назад</div>
      </div>
      {SIGNALS.map((s, i) => (
        <div key={i} className="glow-card p-4" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <SignalBadge action={s.action} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--bot-text)" }}>{s.pair}</span>
              <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>{s.pattern}</span>
            </div>
          </div>
          <div style={{ textAlign: "right" as const }}>
            <div className="mono" style={{ fontSize: 13, color: "var(--bot-text)" }}>${s.price}</div>
            <div style={{ fontSize: 11, color: "var(--bot-muted)" }}>{s.time} назад</div>
          </div>
          <div style={{ textAlign: "right" as const, minWidth: 40 }}>
            <div style={{ fontSize: 11, color: "var(--bot-muted)" }}>Уверен.</div>
            <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--bot-green)" }}>{s.conf}</div>
          </div>
          <button style={{
            padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
            background: "var(--bot-accent)", color: "#fff", border: "none"
          }}>Исполнить</button>
        </div>
      ))}
    </div>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────
function Settings() {
  const [leverage, setLeverage] = useState(3);
  const [maxRisk, setMaxRisk] = useState(2);
  const [strategy, setStrategy] = useState("RSI+MACD");

  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--bot-text)" }}>Настройки бота</h2>

      <div className="glow-card p-5">
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 16 }}>Стратегия</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
          {["RSI+MACD", "Bollinger Bands", "EMA Cross", "Scalping", "Grid"].map(s => (
            <button key={s} onClick={() => setStrategy(s)} style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer",
              background: strategy === s ? "var(--bot-accent)" : "var(--bot-surface-2)",
              color: strategy === s ? "#fff" : "var(--bot-muted)",
              border: strategy === s ? "none" : "1px solid var(--bot-border)",
              transition: "all 0.15s"
            }}>{s}</button>
          ))}
        </div>
      </div>

      <div className="glow-card p-5">
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 16 }}>Риск-менеджмент</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[
            { label: "Кредитное плечо",       value: leverage, set: setLeverage, min: 1, max: 20, unit: "x" },
            { label: "Макс. риск на сделку",  value: maxRisk,  set: setMaxRisk,  min: 1, max: 10, unit: "%" },
          ].map(({ label, value, set, min, max, unit }) => (
            <div key={label}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "var(--bot-muted)" }}>{label}</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--bot-blue)" }}>{value}{unit}</span>
              </div>
              <input type="range" min={min} max={max} value={value}
                onChange={e => set(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--bot-blue)", cursor: "pointer" }} />
            </div>
          ))}
        </div>
      </div>

      <div className="glow-card p-5">
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 16 }}>API Интеграция</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { label: "API Key",    placeholder: "••••••••••••••••••••••••" },
            { label: "Secret Key", placeholder: "••••••••••••••••••••••••" },
          ].map(f => (
            <div key={f.label}>
              <label style={{ fontSize: 11, color: "var(--bot-muted)", display: "block", marginBottom: 4 }}>{f.label}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input placeholder={f.placeholder} type="password" style={{
                  flex: 1, padding: "8px 12px", borderRadius: 6, fontSize: 12,
                  background: "var(--bot-bg)", border: "1px solid var(--bot-border)",
                  color: "var(--bot-text)", outline: "none", fontFamily: "IBM Plex Mono"
                }} />
                <button style={{
                  padding: "8px 14px", borderRadius: 6, fontSize: 11, cursor: "pointer",
                  background: "var(--bot-surface-2)", color: "var(--bot-muted)",
                  border: "1px solid var(--bot-border)"
                }}>Изменить</button>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--bot-green)" }} />
            <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>Binance подключён · Пинг 12ms</span>
          </div>
        </div>
      </div>

      <button style={{
        padding: "10px 24px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
        background: "var(--bot-accent)", color: "#fff", border: "none", alignSelf: "flex-start"
      }}>Сохранить настройки</button>
    </div>
  );
}

// ─── Statistics ───────────────────────────────────────────────────────────────
function Statistics() {
  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--bot-text)" }}>Статистика</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <MetricCard label="Всего сделок"   value="1 247" icon="Activity"    color="var(--bot-blue)"   />
        <MetricCard label="Win Rate"        value="73.2%" icon="Target"      color="var(--bot-green)"  />
        <MetricCard label="Profit Factor"   value="2.41"  icon="TrendingUp"  color="var(--bot-green)"  />
        <MetricCard label="Макс. просадка"  value="8.3%"  icon="TrendingDown"color="var(--bot-yellow)" />
        <MetricCard label="Ср. сделка"      value="+1.8%" icon="BarChart2"   color="var(--bot-text)"   />
        <MetricCard label="Шарп"            value="1.94"  icon="Zap"         color="var(--bot-blue)"   />
      </div>

      <div className="glow-card p-5">
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 14 }}>Индикаторы</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            { name: "RSI (14)",  value: "58.3",  status: "Нейтральный", color: "var(--bot-yellow)" },
            { name: "MACD",      value: "+0.42", status: "Бычий",       color: "var(--bot-green)"  },
            { name: "Bollinger", value: "0.72",  status: "Сжатие",      color: "var(--bot-blue)"   },
            { name: "ATR (14)",  value: "1 240", status: "Высокий",     color: "var(--bot-red)"    },
            { name: "Volume",    value: "2.1B",  status: "Выше нормы",  color: "var(--bot-green)"  },
          ].map((ind, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              paddingBottom: 10, borderBottom: i < 4 ? "1px solid var(--bot-border)" : "none"
            }}>
              <span style={{ fontSize: 12, color: "var(--bot-muted)" }}>{ind.name}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--bot-text)" }}>{ind.value}</span>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--bot-surface-2)", color: ind.color }}>{ind.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="glow-card p-5">
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 14 }}>Волатильность по парам</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { pair: "BTC/USDT", vol: 82 },
            { pair: "ETH/USDT", vol: 65 },
            { pair: "SOL/USDT", vol: 91 },
            { pair: "BNB/USDT", vol: 44 },
          ].map((v, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="mono" style={{ fontSize: 12, color: "var(--bot-muted)", minWidth: 80 }}>{v.pair}</span>
              <div style={{ flex: 1, height: 4, background: "var(--bot-border)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  width: `${v.vol}%`, height: "100%", borderRadius: 2,
                  background: v.vol > 80 ? "var(--bot-red)" : v.vol > 60 ? "var(--bot-yellow)" : "var(--bot-green)"
                }} />
              </div>
              <span className="mono" style={{ fontSize: 12, color: "var(--bot-text)", minWidth: 32, textAlign: "right" as const }}>{v.vol}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Portfolio ────────────────────────────────────────────────────────────────
function Portfolio() {
  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--bot-text)" }}>Портфель</h2>
        <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--bot-text)" }}>$65 236</span>
      </div>

      <div className="glow-card" style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 80px", padding: "10px 16px", borderBottom: "1px solid var(--bot-border)" }}>
          {["Актив", "Количество", "Стоимость", "P&L", ""].map((h, i) => (
            <div key={i} style={{ fontSize: 10, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "var(--bot-muted)" }}>{h}</div>
          ))}
        </div>
        {PORTFOLIO.map((p, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 80px",
            padding: "12px 16px", borderBottom: i < PORTFOLIO.length - 1 ? "1px solid var(--bot-border)" : "none",
            transition: "background 0.15s", cursor: "default"
          }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bot-surface-2)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 6, background: "var(--bot-surface-2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 700, color: "var(--bot-blue)", fontFamily: "IBM Plex Mono"
              }}>{p.asset.slice(0, 2)}</div>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--bot-text)" }}>{p.asset}</span>
            </div>
            <span className="mono" style={{ fontSize: 12, color: "var(--bot-muted)", alignSelf: "center" }}>{p.amount}</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--bot-text)", alignSelf: "center" }}>${p.value}</span>
            <span className="mono" style={{ fontSize: 12, fontWeight: 600, alignSelf: "center", color: p.pos ? "var(--bot-green)" : "var(--bot-red)" }}>{p.pnl}</span>
            <button style={{
              padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer", alignSelf: "center",
              background: "var(--bot-surface-2)", color: "var(--bot-muted)", border: "1px solid var(--bot-border)"
            }}>Закрыть</button>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--bot-text)" }}>История сделок</h3>
      <div className="glow-card" style={{ overflow: "hidden" }}>
        {HISTORY.map((h, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "1fr 60px 1fr 1fr 60px 60px",
            padding: "12px 16px", borderBottom: i < HISTORY.length - 1 ? "1px solid var(--bot-border)" : "none",
            gap: 8, alignItems: "center"
          }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--bot-text)" }}>{h.pair}</span>
            <SignalBadge action={h.side} />
            <span className="mono" style={{ fontSize: 11, color: "var(--bot-muted)" }}>вход ${h.entry}</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--bot-muted)" }}>выход ${h.exit}</span>
            <span className="mono" style={{
              fontSize: 12, fontWeight: 600,
              color: h.pnl.startsWith("+") ? "var(--bot-green)" : "var(--bot-red)"
            }}>{h.pnl}</span>
            <span style={{ fontSize: 11, color: "var(--bot-muted)" }}>{h.date}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Alerts ───────────────────────────────────────────────────────────────────
function Alerts() {
  const [switches, setSwitches] = useState([true, true, true, false, false]);

  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--bot-text)" }}>Уведомления</h2>
        <button style={{
          padding: "5px 12px", borderRadius: 5, fontSize: 11, cursor: "pointer",
          background: "transparent", color: "var(--bot-muted)", border: "1px solid var(--bot-border)"
        }}>Очистить все</button>
      </div>

      {NOTIFICATIONS.map((n, i) => (
        <div key={i} className="glow-card p-4" style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
            background: `${n.color}18`, flexShrink: 0
          }}>
            <Icon name={n.icon as Parameters<typeof Icon>[0]["name"]} size={15} style={{ color: n.color }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: "var(--bot-text)", marginBottom: 2 }}>{n.msg}</div>
            <div style={{ fontSize: 11, color: "var(--bot-muted)" }}>{n.time}</div>
          </div>
          <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--bot-muted)", padding: 4 }}>
            <Icon name="X" size={13} />
          </button>
        </div>
      ))}

      <div className="glow-card p-5">
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bot-text)", marginBottom: 14 }}>Настройка уведомлений</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            "Новые торговые сигналы",
            "Превышение уровня риска",
            "Закрытие сделок",
            "Ошибки API",
            "Ночные уведомления",
          ].map((label, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--bot-text)" }}>{label}</span>
              <div onClick={() => setSwitches(s => s.map((v, j) => j === i ? !v : v))} style={{
                width: 36, height: 20, borderRadius: 10, cursor: "pointer",
                background: switches[i] ? "var(--bot-green-dim)" : "var(--bot-border)",
                position: "relative", transition: "background 0.2s"
              }}>
                <div style={{
                  width: 14, height: 14, borderRadius: "50%", background: "#fff",
                  position: "absolute", top: 3, left: switches[i] ? 19 : 3, transition: "left 0.2s"
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function Index() {
  const [tab, setTab] = useState("dashboard");
  const [botActive, setBotActive] = useState(true);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const fmt = (d: Date) =>
    d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="bot-app" style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Sidebar */}
      <aside style={{
        width: 200, background: "var(--bot-surface)", borderRight: "1px solid var(--bot-border)",
        display: "flex", flexDirection: "column", padding: "20px 12px", flexShrink: 0
      }}>
        {/* Logo */}
        <div style={{ padding: "0 4px 24px", borderBottom: "1px solid var(--bot-border)", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8, background: "var(--bot-accent)",
              display: "flex", alignItems: "center", justifyContent: "center"
            }}>
              <Icon name="Bot" size={16} style={{ color: "#fff" }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--bot-text)", lineHeight: 1 }}>TradeBot</div>
              <div style={{ fontSize: 10, color: "var(--bot-muted)" }}>Pro Terminal</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          {TABS.map(t => (
            <div key={t.id} className={`nav-item ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}>
              <Icon name={t.icon as Parameters<typeof Icon>[0]["name"]} size={15} />
              {t.label}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ borderTop: "1px solid var(--bot-border)", paddingTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <div className="pulse-dot" style={{
              width: 6, height: 6, borderRadius: "50%",
              background: botActive ? "var(--bot-green)" : "var(--bot-muted)"
            }} />
            <span style={{ fontSize: 11, color: botActive ? "var(--bot-green)" : "var(--bot-muted)" }}>
              {botActive ? "В работе" : "Остановлен"}
            </span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--bot-muted)" }}>{fmt(time)}</div>
        </div>
      </aside>

      {/* Main area */}
      <main style={{ flex: 1, overflow: "auto", padding: 24 }}>
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 24, paddingBottom: 16, borderBottom: "1px solid var(--bot-border)"
        }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--bot-text)", margin: 0 }}>
              {TABS.find(t => t.id === tab)?.label}
            </h1>
            <div style={{ fontSize: 11, color: "var(--bot-muted)", marginTop: 2 }}>30 апреля 2026</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ textAlign: "right" as const }}>
              <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--bot-text)" }}>$65 236.40</div>
              <div style={{ fontSize: 11, color: "var(--bot-green)" }}>↑ +4.54% сегодня</div>
            </div>
            <div style={{
              width: 32, height: 32, borderRadius: 8, background: "var(--bot-surface-2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              border: "1px solid var(--bot-border)", cursor: "pointer"
            }}>
              <Icon name="Bell" size={15} style={{ color: "var(--bot-muted)" }} />
            </div>
          </div>
        </div>

        {/* Content */}
        <div key={tab}>
          {tab === "dashboard" && <Dashboard botActive={botActive} setBotActive={setBotActive} />}
          {tab === "signals"   && <Signals />}
          {tab === "settings"  && <Settings />}
          {tab === "stats"     && <Statistics />}
          {tab === "portfolio" && <Portfolio />}
          {tab === "alerts"    && <Alerts />}
        </div>
      </main>
    </div>
  );
}