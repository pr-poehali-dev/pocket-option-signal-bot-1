"""
Рыночные данные с Binance: цены, свечи, бэктест уверенности сигналов.
Все запросы идут через бэкенд — Binance доступен с серверов платформы.
"""
import json
import math
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOTUSDT"]


def fetch(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "TradeBot/1.0"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


# ── Индикаторы (Python-версии для бэктеста) ───────────────────────────────────

def ema(data: list, period: int) -> list:
    k = 2 / (period + 1)
    result, prev = [], None
    for i, v in enumerate(data):
        if i < period - 1:
            result.append(None); continue
        if i == period - 1:
            prev = sum(data[:period]) / period
            result.append(prev); continue
        prev = v * k + prev * (1 - k)
        result.append(prev)
    return result


def rsi(data: list, period: int = 14) -> list:
    result = [None] * period
    ag, al = 0.0, 0.0
    for i in range(1, period + 1):
        d = data[i] - data[i - 1]
        ag += max(d, 0); al += max(-d, 0)
    ag /= period; al /= period
    result.append(100 - 100 / (1 + ag / (al or 1e-9)))
    for i in range(period + 1, len(data)):
        d = data[i] - data[i - 1]
        ag = (ag * (period - 1) + max(d, 0)) / period
        al = (al * (period - 1) + max(-d, 0)) / period
        result.append(100 - 100 / (1 + ag / (al or 1e-9)))
    return result


def macd_line(data: list, fast=12, slow=26) -> list:
    ef = ema(data, fast)
    es = ema(data, slow)
    return [
        (f - s) if (f is not None and s is not None) else None
        for f, s in zip(ef, es)
    ]


def backtest_accuracy(closes: list, signal_fn, horizon: int) -> float:
    """
    Запускает signal_fn на каждой свече, проверяет совпадение
    с реальным движением через `horizon` свечей вперёд.
    Возвращает точность 0..100.
    """
    correct, total = 0, 0
    for i in range(30, len(closes) - horizon):
        action = signal_fn(closes[:i + 1])
        if action == "HOLD":
            continue
        future_price = closes[i + horizon]
        current_price = closes[i]
        moved_up = future_price > current_price
        if (action == "BUY" and moved_up) or (action == "SELL" and not moved_up):
            correct += 1
        total += 1
    if total < 5:
        return 50.0
    return round(correct / total * 100, 1)


def make_signal_fn(strategy: str):
    """Возвращает функцию которая по массиву closes возвращает BUY/SELL/HOLD."""
    def fn(closes):
        if len(closes) < 30:
            return "HOLD"
        rsi_v = rsi(closes, 14)
        last_rsi = rsi_v[-1] or 50
        ema9 = ema(closes, 9)
        ema21 = ema(closes, 21)
        e9 = ema9[-1]; e21 = ema21[-1]
        ml = macd_line(closes, 12, 26)
        # MACD signal line
        valid_ml = [v for v in ml if v is not None]
        sig_vals = ema(valid_ml, 9)
        # align
        none_count = sum(1 for v in ml if v is None)
        sig_aligned = [None] * none_count + sig_vals
        ms = sig_aligned[-1] if sig_aligned else None
        mv = ml[-1]

        bull = 0; bear = 0
        if last_rsi < 35: bull += 2
        elif last_rsi < 50: bull += 1
        if last_rsi > 65: bear += 2
        elif last_rsi > 50: bear += 1
        if e9 is not None and e21 is not None:
            if e9 > e21: bull += 1
            else: bear += 1
        if mv is not None and ms is not None:
            if mv > ms: bull += 1
            else: bear += 1

        if bull >= 3: return "BUY"
        if bear >= 3: return "SELL"
        return "HOLD"
    return fn


def calc_signal_for_pair(pair: str, interval: str = "5m", limit: int = 150) -> dict:
    """Вычисляет сигнал + реальную точность по бэктесту."""
    raw = fetch(f"https://api.binance.com/api/v3/klines?symbol={pair}&interval={interval}&limit={limit}")
    closes = [float(c[4]) for c in raw]
    last_candle = raw[-1]

    rsi_v  = rsi(closes, 14)
    ema9   = ema(closes, 9)
    ema21  = ema(closes, 21)
    ml     = macd_line(closes, 12, 26)
    valid_ml = [v for v in ml if v is not None]
    sig_vals = ema(valid_ml, 9)
    none_cnt = sum(1 for v in ml if v is None)
    sig_al   = [None] * none_cnt + sig_vals

    last_rsi = rsi_v[-1] or 50
    e9  = ema9[-1];  e21 = ema21[-1]
    mv  = ml[-1];    ms  = sig_al[-1]

    bull = 0; bear = 0
    if last_rsi < 35: bull += 2
    elif last_rsi < 50: bull += 1
    if last_rsi > 65: bear += 2
    elif last_rsi > 50: bear += 1
    if e9 is not None and e21 is not None:
        if e9 > e21: bull += 1
        else: bear += 1
    if mv is not None and ms is not None:
        if mv > ms: bull += 1
        else: bear += 1

    if bull >= 3:   action = "BUY"
    elif bear >= 3: action = "SELL"
    else:           action = "HOLD"

    # Бэктест на 5-свечовом горизонте (реальная точность)
    fn = make_signal_fn("combo")
    horizon = 5
    acc = backtest_accuracy(closes[:-5], fn, horizon)

    # Интервал прогноза зависит от таймфрейма
    tf_minutes = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240}.get(interval, 5)
    forecast_minutes = horizon * tf_minutes

    # Сила сигнала = насколько индикаторы согласны
    strength = max(bull, bear)  # 0..4
    raw_conf = 40 + strength * 10 + (acc - 50) * 0.4
    conf = max(30, min(97, round(raw_conf)))

    # Ценовой прогноз: ATR-based
    highs  = [float(c[2]) for c in raw]
    lows   = [float(c[3]) for c in raw]
    trs = []
    for i in range(1, len(raw)):
        h, l, pc = highs[i], lows[i], float(raw[i-1][4])
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    atr = sum(trs[-14:]) / 14 if trs else 0

    current_price = closes[-1]
    if action == "BUY":
        target = current_price + 2 * atr
        change_pct = round((target - current_price) / current_price * 100, 2)
    elif action == "SELL":
        target = current_price - 2 * atr
        change_pct = round((target - current_price) / current_price * 100, 2)
    else:
        target = current_price
        change_pct = 0.0

    return {
        "pair": pair,
        "action": action,
        "price": current_price,
        "conf": conf,
        "accuracy": acc,           # реальная историческая точность
        "rsi": round(last_rsi, 1),
        "macd": round(mv or 0, 4),
        "macdSignal": round(ms or 0, 4),
        "ema9":  round(e9 or 0, 4),
        "ema21": round(e21 or 0, 4),
        "atr": round(atr, 4),
        "forecastMinutes": forecast_minutes,   # через сколько минут ждать движения
        "targetPrice": round(target, 4),
        "targetChangePct": change_pct,
        "bull": bull,
        "bear": bear,
        "interval": interval,
    }


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    params = event.get("queryStringParameters") or {}
    action = params.get("action", "signals")
    symbol = params.get("symbol", "BTCUSDT").upper()
    interval = params.get("interval", "5m")

    try:
        if action == "signals":
            # Все пары параллельно — сигналы + бэктест точность
            limit = int(params.get("limit", "150"))

            def job(pair):
                try:
                    return calc_signal_for_pair(pair, interval, limit)
                except Exception as e:
                    return {"pair": pair, "error": str(e)}

            results = []
            with ThreadPoolExecutor(max_workers=7) as ex:
                futures = [ex.submit(job, p) for p in PAIRS]
                for f in as_completed(futures):
                    results.append(f.result())

            results.sort(key=lambda x: x.get("conf", 0), reverse=True)
            return {"statusCode": 200, "headers": CORS, "body": json.dumps(results)}

        elif action == "prices":
            def fetch_price(pair):
                try:
                    t = fetch(f"https://api.binance.com/api/v3/ticker/24hr?symbol={pair}")
                    return pair, {
                        "price":  float(t["lastPrice"]),
                        "change": float(t["priceChangePercent"]),
                        "high":   float(t["highPrice"]),
                        "low":    float(t["lowPrice"]),
                        "volume": float(t["volume"]),
                    }
                except Exception:
                    return pair, None

            results = {}
            with ThreadPoolExecutor(max_workers=7) as ex:
                for pair, data in [f.result() for f in as_completed([ex.submit(fetch_price, p) for p in PAIRS])]:
                    if data:
                        results[pair] = data
            return {"statusCode": 200, "headers": CORS, "body": json.dumps(results)}

        elif action == "klines":
            limit = int(params.get("limit", "100"))
            raw = fetch(f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}")
            candles = [
                {"time": int(c[0]), "open": float(c[1]), "high": float(c[2]),
                 "low": float(c[3]), "close": float(c[4]), "volume": float(c[5])}
                for c in raw
            ]
            return {"statusCode": 200, "headers": CORS, "body": json.dumps(candles)}

        else:
            return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "Unknown action"})}

    except urllib.error.URLError as e:
        return {"statusCode": 502, "headers": CORS, "body": json.dumps({"error": str(e)})}
    except Exception as e:
        return {"statusCode": 500, "headers": CORS, "body": json.dumps({"error": str(e)})}
