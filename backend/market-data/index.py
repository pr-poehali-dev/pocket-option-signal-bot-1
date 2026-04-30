"""
TradeBot backend v2.1: рыночные данные + нейросеть-ансамбль на Python.
Всё через Binance API — CORS-ограничений нет на серверной стороне.
15 признаков, 3 MLP, momentum SGD, 8 индикаторов.
"""
import json, math, random
import urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}
PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOTUSDT"]

# ─── HTTP ────────────────────────────────────────────────────────────────────
def fetch(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "TradeBot/2.0"})
    with urllib.request.urlopen(req, timeout=12) as r:
        return json.loads(r.read().decode())

# ─── Математика ──────────────────────────────────────────────────────────────
def sigmoid(x): return 1 / (1 + math.exp(-max(-30, min(30, x))))
def relu(x):    return max(0.0, x)
def tanh(x):    return math.tanh(max(-20, min(20, x)))
def dot(a, b):  return sum(x * y for x, y in zip(a, b))

def mat_mul(inp, weights, bias, act):
    return [act(dot(inp, w) + b) for w, b in zip(weights, bias)]

# ─── Технические индикаторы ───────────────────────────────────────────────────
def ema_calc(data, period):
    k, result, prev = 2 / (period + 1), [], None
    for i, v in enumerate(data):
        if i < period - 1: result.append(None); continue
        if i == period - 1:
            prev = sum(data[:period]) / period
            result.append(prev); continue
        prev = v * k + prev * (1 - k)
        result.append(prev)
    return result

def rsi_calc(data, period=14):
    result = [None] * period
    ag = al = 0.0
    for i in range(1, period + 1):
        d = data[i] - data[i-1]
        ag += max(d, 0); al += max(-d, 0)
    ag /= period; al /= period
    result.append(100 - 100 / (1 + ag / (al or 1e-9)))
    for i in range(period + 1, len(data)):
        d = data[i] - data[i-1]
        ag = (ag * (period-1) + max(d, 0)) / period
        al = (al * (period-1) + max(-d, 0)) / period
        result.append(100 - 100 / (1 + ag / (al or 1e-9)))
    return result

def macd_calc(data, fast=12, slow=26, signal=9):
    ef, es = ema_calc(data, fast), ema_calc(data, slow)
    ml = [(f - s) if f is not None and s is not None else None for f, s in zip(ef, es)]
    valid = [v for v in ml if v is not None]
    sig_raw = ema_calc(valid, signal)
    nones = sum(1 for v in ml if v is None)
    sig = [None] * nones + sig_raw
    hist = [(m - s) if m is not None and s is not None else None for m, s in zip(ml, sig)]
    return ml, sig, hist

def bollinger_calc(data, period=20, mult=2.0):
    sma_v = ema_calc(data, period)  # используем SMA через простую сумму
    upper, lower, mid = [], [], []
    for i in range(len(data)):
        if i < period - 1:
            upper.append(None); lower.append(None); mid.append(None); continue
        sl = data[i-period+1:i+1]
        m = sum(sl) / period
        std = math.sqrt(sum((x - m)**2 for x in sl) / period)
        mid.append(m); upper.append(m + mult*std); lower.append(m - mult*std)
    return mid, upper, lower

def atr_calc(highs, lows, closes, period=14):
    if len(closes) < period + 1:
        return [None] * len(closes)
    trs = [highs[0] - lows[0]]
    for i in range(1, len(closes)):
        trs.append(max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1])))
    result = [None] * period
    init_slice = trs[1:period+1]
    if not init_slice:
        return [None] * len(closes)
    avg = sum(init_slice) / len(init_slice)
    result.append(avg)
    for i in range(period+1, len(trs)):
        avg = (avg * (period-1) + trs[i]) / period
        result.append(avg)
    # pad to match length
    while len(result) < len(closes):
        result.append(result[-1])
    return result

def stoch_rsi(closes, rsi_period=14, stoch_period=14):
    """Stochastic RSI — перекупленность/перепроданность точнее RSI."""
    rsi_v = rsi_calc(closes, rsi_period)
    result = []
    for i in range(len(rsi_v)):
        if rsi_v[i] is None or i < rsi_period + stoch_period - 2:
            result.append(None); continue
        window = [v for v in rsi_v[i-stoch_period+1:i+1] if v is not None]
        if len(window) < stoch_period:
            result.append(None); continue
        lo, hi = min(window), max(window)
        result.append((rsi_v[i] - lo) / (hi - lo + 1e-9) * 100)
    return result

def williams_r(highs, lows, closes, period=14):
    """Williams %R — классика для бинарных опционов."""
    result = []
    for i in range(len(closes)):
        if i < period - 1: result.append(None); continue
        h = max(highs[i-period+1:i+1])
        l = min(lows[i-period+1:i+1])
        result.append(-100 * (h - closes[i]) / (h - l + 1e-9))
    return result

def cci_calc(highs, lows, closes, period=20):
    """CCI — Commodity Channel Index."""
    result = []
    for i in range(len(closes)):
        if i < period - 1: result.append(None); continue
        tp_slice = [(highs[j]+lows[j]+closes[j])/3 for j in range(i-period+1, i+1)]
        m = sum(tp_slice) / period
        md = sum(abs(x - m) for x in tp_slice) / period
        tp = (highs[i]+lows[i]+closes[i]) / 3
        result.append((tp - m) / (0.015 * md + 1e-9))
    return result

# ─── Извлечение 15 признаков из свечей ───────────────────────────────────────
def extract_features(raw_candles):  # noqa: C901
    try:
        return _extract_features_inner(raw_candles)
    except Exception:
        return None

def _extract_features_inner(raw_candles):
    closes = [float(c[4]) for c in raw_candles]
    highs  = [float(c[2]) for c in raw_candles]
    lows   = [float(c[3]) for c in raw_candles]
    vols   = [float(c[5]) for c in raw_candles]
    n = len(closes)
    if n < 35: return None

    rsi_v               = rsi_calc(closes, 14)
    macd_v, macd_s, _   = macd_calc(closes, 12, 26, 9)
    ema9                = ema_calc(closes, 9)
    ema21               = ema_calc(closes, 21)
    ema50               = ema_calc(closes, 50)
    mid_b, up_b, lo_b   = bollinger_calc(closes, 20, 2.0)
    atr_v               = atr_calc(highs, lows, closes, 14)
    srsi                = stoch_rsi(closes, 14, 14)
    wr                  = williams_r(highs, lows, closes, 14)
    cci                 = cci_calc(highs, lows, closes, 20)

    i = n - 1
    c = closes[i]

    def safe(v, default=0.0): return v if v is not None else default
    def norm(v, lo, hi): return max(-1.0, min(1.0, (v - lo) / (hi - lo + 1e-9) * 2 - 1))

    rsi_n    = norm(safe(rsi_v[i], 50), 0, 100)                        # RSI нормализованный
    macd_n   = tanh(safe(macd_v[i]) / (c * 0.002 + 1e-9))             # MACD / цена
    macd_d   = tanh((safe(macd_v[i]) - safe(macd_s[i])) / (c * 0.001 + 1e-9))  # расхождение
    ema_r    = tanh((safe(ema9[i], c) - safe(ema21[i], c)) / (c * 0.005 + 1e-9))  # EMA9 vs EMA21
    ema50_r  = tanh((c - safe(ema50[i], c)) / (c * 0.01 + 1e-9))      # цена vs EMA50
    boll_pos = norm(c, safe(lo_b[i], c - 1), safe(up_b[i], c + 1))    # позиция в Боллинджере
    atr_n    = tanh(safe(atr_v[i]) / (c * 0.02 + 1e-9))               # ATR нормализованный
    srsi_n   = norm(safe(srsi[i], 50), 0, 100)                         # Stochastic RSI
    wr_n     = norm(safe(wr[i], -50), -100, 0)                         # Williams %R
    cci_n    = tanh(safe(cci[i]) / 150)                                # CCI
    ret1     = tanh((closes[i] - closes[i-1]) / (closes[i-1] * 0.01 + 1e-9))   # доходность 1 свеча
    ret5     = tanh((closes[i] - closes[i-5]) / (closes[i-5] * 0.02 + 1e-9))   # доходность 5 свечей
    ret10    = tanh((closes[i] - closes[max(0,i-10)]) / (closes[max(0,i-10)] * 0.03 + 1e-9))
    vol_r    = tanh((vols[i] - (sum(vols[max(0,i-5):i]) / 5 + 1e-9)) / (vols[i] + 1e-9))  # всплеск объёма
    open_p   = float(raw_candles[i][1]) if hasattr(raw_candles[i], "__getitem__") else closes[max(0,i-1)]
    body     = (closes[i] - open_p) / (highs[i] - lows[i] + 1e-9)  # тело свечи

    return [rsi_n, macd_n, macd_d, ema_r, ema50_r, boll_pos, atr_n,
            srsi_n, wr_n, cci_n, ret1, ret5, ret10, vol_r, body]

# ─── MLP нейросеть ────────────────────────────────────────────────────────────
def make_weights(n_in, n_h1, n_h2, seed):
    """Xavier-инициализация весов."""
    rng = random.Random(seed)
    def layer(ni, no):
        scale = math.sqrt(2.0 / ni)
        return [[rng.gauss(0, scale) for _ in range(ni)] for _ in range(no)], [0.0] * no
    w1, b1 = layer(n_in, n_h1)
    w2, b2 = layer(n_h1, n_h2)
    w3, b3 = layer(n_h2, 1)
    return {"w1": w1, "b1": b1, "w2": w2, "b2": b2, "w3": w3[0], "b3": b3}

def forward(x, w):
    h1 = mat_mul(x,  w["w1"], w["b1"], relu)
    h2 = mat_mul(h1, w["w2"], w["b2"], relu)
    return sigmoid(dot(h2, w["w3"]) + w["b3"][0])

def train_mlp(w, samples, epochs=120, lr=0.02, wd=1e-4):
    """SGD с momentum и weight decay."""
    # momentum buffers
    vw1 = [[0.0]*len(w["w1"][0]) for _ in w["w1"]]
    vw2 = [[0.0]*len(w["w2"][0]) for _ in w["w2"]]
    vw3 = [0.0]*len(w["w3"])
    vb1 = [0.0]*len(w["b1"])
    vb2 = [0.0]*len(w["b2"])
    mu  = 0.9

    for ep in range(epochs):
        lr_e = lr * (0.95 ** (ep // 20))   # decay learning rate
        random.shuffle(samples)
        for x, y in samples:
            h1 = mat_mul(x, w["w1"], w["b1"], relu)
            h2 = mat_mul(h1, w["w2"], w["b2"], relu)
            out = sigmoid(dot(h2, w["w3"]) + w["b3"][0])
            err = out - y

            # grad output
            dw3 = [h2[j] * err for j in range(len(h2))]
            db3 = err

            # grad h2
            dh2 = [w["w3"][j] * err * (1 if h2[j] > 0 else 0) for j in range(len(h2))]
            dw2 = [[dh2[j] * h1[k] for k in range(len(h1))] for j in range(len(dh2))]
            db2 = list(dh2)

            # grad h1
            dh1 = [sum(w["w2"][j][i] * dh2[j] for j in range(len(dh2))) * (1 if h1[i] > 0 else 0)
                   for i in range(len(h1))]
            dw1 = [[dh1[i] * x[k] for k in range(len(x))] for i in range(len(dh1))]
            db1 = list(dh1)

            # momentum update
            for j in range(len(w["w3"])):
                vw3[j] = mu * vw3[j] - lr_e * (dw3[j] + wd * w["w3"][j])
                w["w3"][j] += vw3[j]
            vb3_v = mu * 0.0 - lr_e * db3
            w["b3"][0] += vb3_v

            for j in range(len(w["w2"])):
                vb2[j] = mu * vb2[j] - lr_e * db2[j]
                w["b2"][j] += vb2[j]
                for k in range(len(w["w2"][j])):
                    vw2[j][k] = mu * vw2[j][k] - lr_e * (dw2[j][k] + wd * w["w2"][j][k])
                    w["w2"][j][k] += vw2[j][k]

            for i in range(len(w["w1"])):
                vb1[i] = mu * vb1[i] - lr_e * db1[i]
                w["b1"][i] += vb1[i]
                for k in range(len(w["w1"][i])):
                    vw1[i][k] = mu * vw1[i][k] - lr_e * (dw1[i][k] + wd * w["w1"][i][k])
                    w["w1"][i][k] += vw1[i][k]
    return w

# ─── Ансамбль из 3 MLP с разными архитектурами ───────────────────────────────
def train_ensemble(raw_candles, horizon=5):
    """Обучает 3 сети и возвращает усреднённый прогноз."""
    samples = []
    for i in range(35, len(raw_candles) - horizon):
        feat = extract_features(raw_candles[:i+1])
        if feat is None: continue
        future = float(raw_candles[i+horizon][4])
        current = float(raw_candles[i][4])
        y = 1.0 if future > current * 1.001 else (0.0 if future < current * 0.999 else None)
        if y is None: continue
        samples.append((feat, y))

    if len(samples) < 20:
        return None, 50.0

    # Разбивка train/val
    random.shuffle(samples)
    split = int(len(samples) * 0.8)
    train_s, val_s = samples[:split], samples[split:]

    nets = []
    configs = [(32, 16, 42), (24, 12, 123), (40, 20, 7)]   # разные архитектуры и seeds
    for h1, h2, seed in configs:
        w = make_weights(15, h1, h2, seed)
        w = train_mlp(w, train_s, epochs=150, lr=0.015, wd=1e-4)
        nets.append(w)

    # Точность ансамбля на val
    correct = 0
    for x, y in val_s:
        probs = [forward(x, w) for w in nets]
        p = sum(probs) / len(probs)
        pred = 1 if p > 0.5 else 0
        if pred == int(y): correct += 1
    accuracy = round(correct / len(val_s) * 100, 1) if val_s else 50.0

    return nets, accuracy

def predict_ensemble(nets, raw_candles):
    feat = extract_features(raw_candles)
    if feat is None or nets is None:
        return 0.5
    probs = [forward(feat, w) for w in nets]
    return sum(probs) / len(probs)

# ─── Сигнал + NN для одной пары ───────────────────────────────────────────────
def analyze_pair(pair: str, interval: str = "5m", limit: int = 300) -> dict:
    raw = fetch(f"https://api.binance.com/api/v3/klines?symbol={pair}&interval={interval}&limit={limit}")
    closes = [float(c[4]) for c in raw]
    highs  = [float(c[2]) for c in raw]
    lows   = [float(c[3]) for c in raw]
    n = len(closes)

    # ── Индикаторы ──
    rsi_v             = rsi_calc(closes, 14)
    macd_v, macd_s, _ = macd_calc(closes, 12, 26, 9)
    ema9              = ema_calc(closes, 9)
    ema21             = ema_calc(closes, 21)
    ema50             = ema_calc(closes, 50)
    _, up_b, lo_b     = bollinger_calc(closes, 20, 2.0)
    atr_v             = atr_calc(highs, lows, closes, 14)
    srsi              = stoch_rsi(closes, 14, 14)
    wr                = williams_r(highs, lows, closes, 14)
    cci               = cci_calc(highs, lows, closes, 20)

    i = n - 1
    def s(v, d=50.0): return v if v is not None else d

    last_rsi  = s(rsi_v[i])
    last_srsi = s(srsi[i])
    last_wr   = s(wr[i], -50)
    last_cci  = s(cci[i], 0)
    last_macd = s(macd_v[i], 0)
    last_ms   = s(macd_s[i], 0)
    last_e9   = s(ema9[i], closes[i])
    last_e21  = s(ema21[i], closes[i])
    last_e50  = s(ema50[i], closes[i])
    last_atr  = s(atr_v[i], 0)
    price     = closes[i]

    # ── Балльная система из 8 индикаторов ──
    bull = bear = 0

    # 1. RSI
    if last_rsi < 30: bull += 2
    elif last_rsi < 45: bull += 1
    elif last_rsi > 70: bear += 2
    elif last_rsi > 55: bear += 1

    # 2. Stoch RSI
    if last_srsi < 20: bull += 2
    elif last_srsi < 40: bull += 1
    elif last_srsi > 80: bear += 2
    elif last_srsi > 60: bear += 1

    # 3. MACD crossover
    if last_macd > last_ms: bull += 1
    else: bear += 1

    # 4. MACD histogram trend
    if last_macd > 0 and last_macd > last_ms: bull += 1
    elif last_macd < 0 and last_macd < last_ms: bear += 1

    # 5. EMA9 vs EMA21
    if last_e9 > last_e21: bull += 1
    else: bear += 1

    # 6. Цена vs EMA50 (тренд)
    if price > last_e50 * 1.001: bull += 1
    elif price < last_e50 * 0.999: bear += 1

    # 7. Williams %R
    if last_wr < -80: bull += 2
    elif last_wr < -60: bull += 1
    elif last_wr > -20: bear += 2
    elif last_wr > -40: bear += 1

    # 8. CCI
    if last_cci < -100: bull += 1
    elif last_cci > 100: bear += 1

    # ── Классический сигнал (порог >= 5 из 12 возможных) ──
    if bull >= 5:   ind_action = "BUY"
    elif bear >= 5: ind_action = "SELL"
    else:           ind_action = "HOLD"

    # ── Нейросеть (обучается на 300 свечах) ──
    horizon = 5
    nets, nn_acc = train_ensemble(raw, horizon)
    nn_prob = predict_ensemble(nets, raw)
    nn_action = "BUY" if nn_prob > 0.55 else ("SELL" if nn_prob < 0.45 else "HOLD")
    nn_conf = round(abs(nn_prob - 0.5) * 200)   # 0–100

    # ── Финальный сигнал: ансамбль индикаторов + нейросеть ──
    # Если оба согласны — высокая уверенность
    if ind_action != "HOLD" and nn_action == ind_action:
        final_action = ind_action
        agreement = "full"
    elif ind_action != "HOLD":
        final_action = ind_action
        agreement = "indicator"
    elif nn_action != "HOLD":
        final_action = nn_action
        agreement = "nn"
    else:
        final_action = "HOLD"
        agreement = "none"

    # ── Уверенность ──
    ind_strength = max(bull, bear)  # 0..12
    ind_conf = round(40 + ind_strength * 4)   # 40–88
    if agreement == "full":
        conf = round((ind_conf * 0.5 + nn_conf * 0.5) * 1.1)   # буст за согласие
    elif agreement == "indicator":
        conf = ind_conf
    elif agreement == "nn":
        conf = nn_conf
    else:
        conf = max(30, round((ind_conf + nn_conf) / 2))
    conf = max(30, min(95, conf))

    # ── Целевая цена через ATR ──
    tf_min = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240}.get(interval, 5)
    forecast_min = horizon * tf_min
    if final_action == "BUY":
        target = price + 2 * last_atr
        change_pct = round((target - price) / price * 100, 3)
    elif final_action == "SELL":
        target = price - 2 * last_atr
        change_pct = round((target - price) / price * 100, 3)
    else:
        target = price; change_pct = 0.0

    return {
        "pair": pair,
        "action": final_action,
        "price": price,
        "conf": conf,
        "accuracy": nn_acc,
        "nnProb": round(nn_prob, 4),
        "nnConf": nn_conf,
        "indConf": ind_conf,
        "agreement": agreement,
        "rsi": round(last_rsi, 1),
        "stochRsi": round(last_srsi, 1),
        "williamsR": round(last_wr, 1),
        "cci": round(last_cci, 1),
        "macd": round(last_macd, 5),
        "macdSignal": round(last_ms, 5),
        "ema9": round(last_e9, 5),
        "ema21": round(last_e21, 5),
        "atr": round(last_atr, 5),
        "bull": bull,
        "bear": bear,
        "forecastMinutes": forecast_min,
        "targetPrice": round(target, 5),
        "targetChangePct": change_pct,
        "interval": interval,
    }

# ─── Handler ──────────────────────────────────────────────────────────────────
def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    params   = event.get("queryStringParameters") or {}
    action   = params.get("action", "signals")
    symbol   = params.get("symbol", "BTCUSDT").upper()
    interval = params.get("interval", "5m")

    try:
        # ── Сигналы всех пар (сигналы + нейросеть) ──
        if action == "signals":
            limit = int(params.get("limit", "300"))

            def job(pair):
                try:    return analyze_pair(pair, interval, limit)
                except Exception as e: return {"pair": pair, "error": str(e), "action": "HOLD", "conf": 0}

            results = []
            with ThreadPoolExecutor(max_workers=7) as ex:
                for f in as_completed([ex.submit(job, p) for p in PAIRS]):
                    results.append(f.result())

            results.sort(key=lambda x: x.get("conf", 0), reverse=True)
            return {"statusCode": 200, "headers": CORS, "body": json.dumps(results)}

        # ── Одна пара детально (для вкладки Нейросеть) ──
        elif action == "nn":
            limit = int(params.get("limit", "300"))
            result = analyze_pair(symbol, interval, limit)
            return {"statusCode": 200, "headers": CORS, "body": json.dumps(result)}

        # ── Свечи ──
        elif action == "klines":
            limit = int(params.get("limit", "100"))
            raw = fetch(f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}")
            candles = [{"time": int(c[0]), "open": float(c[1]), "high": float(c[2]),
                        "low": float(c[3]), "close": float(c[4]), "volume": float(c[5])} for c in raw]
            return {"statusCode": 200, "headers": CORS, "body": json.dumps(candles)}

        # ── Цены ──
        elif action == "prices":
            def fp(pair):
                try:
                    t = fetch(f"https://api.binance.com/api/v3/ticker/24hr?symbol={pair}")
                    return pair, {"price": float(t["lastPrice"]), "change": float(t["priceChangePercent"]),
                                  "high": float(t["highPrice"]), "low": float(t["lowPrice"]), "volume": float(t["volume"])}
                except: return pair, None
            out = {}
            with ThreadPoolExecutor(max_workers=7) as ex:
                for p, d in [f.result() for f in as_completed([ex.submit(fp, p) for p in PAIRS])]:
                    if d: out[p] = d
            return {"statusCode": 200, "headers": CORS, "body": json.dumps(out)}

        else:
            return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "unknown action"})}

    except urllib.error.URLError as e:
        return {"statusCode": 502, "headers": CORS, "body": json.dumps({"error": str(e)})}
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        return {"statusCode": 500, "headers": CORS, "body": json.dumps({"error": str(e), "tb": tb[-1200:]})}