"""
Получает реальные рыночные данные с Binance (цены, свечи, объёмы)
для отображения в торговом боте и анализа нейросетью.
"""
import json
import urllib.request
import urllib.error

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOTUSDT"]

def fetch(url: str) -> dict | list:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read().decode())

def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    params = event.get("queryStringParameters") or {}
    action = params.get("action", "prices")
    symbol = params.get("symbol", "BTCUSDT").upper()

    try:
        if action == "prices":
            from concurrent.futures import ThreadPoolExecutor, as_completed

            def fetch_pair(pair: str) -> tuple:
                try:
                    t = fetch(f"https://api.binance.com/api/v3/ticker/24hr?symbol={pair}")
                    return pair, {
                        "price":       float(t["lastPrice"]),
                        "change":      float(t["priceChangePercent"]),
                        "high":        float(t["highPrice"]),
                        "low":         float(t["lowPrice"]),
                        "volume":      float(t["volume"]),
                        "quoteVolume": float(t["quoteVolume"]),
                    }
                except Exception:
                    # Fallback: берём из последней свечи
                    try:
                        kl = fetch(f"https://api.binance.com/api/v3/klines?symbol={pair}&interval=1m&limit=2")
                        p0, p1 = float(kl[0][4]), float(kl[1][4])
                        change = (p1 - p0) / p0 * 100 if p0 else 0
                        return pair, {
                            "price": p1, "change": round(change, 2),
                            "high": float(kl[1][2]), "low": float(kl[1][3]),
                            "volume": float(kl[1][5]), "quoteVolume": 0,
                        }
                    except Exception:
                        return pair, None

            results = {}
            with ThreadPoolExecutor(max_workers=7) as ex:
                futures = {ex.submit(fetch_pair, p): p for p in PAIRS}
                for f in as_completed(futures):
                    pair, data = f.result()
                    if data:
                        results[pair] = data
            return {"statusCode": 200, "headers": CORS, "body": json.dumps(results)}

        elif action == "klines":
            # Свечные данные для графика и нейросети
            interval = params.get("interval", "5m")
            limit = int(params.get("limit", "100"))
            raw = fetch(f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}")
            candles = [
                {
                    "time": int(c[0]),
                    "open": float(c[1]),
                    "high": float(c[2]),
                    "low": float(c[3]),
                    "close": float(c[4]),
                    "volume": float(c[5]),
                }
                for c in raw
            ]
            return {"statusCode": 200, "headers": CORS, "body": json.dumps(candles)}

        elif action == "orderbook":
            # Стакан (для анализа давления покупателей/продавцов)
            raw = fetch(f"https://api.binance.com/api/v3/depth?symbol={symbol}&limit=10")
            bids_vol = sum(float(b[1]) for b in raw["bids"])
            asks_vol = sum(float(a[1]) for a in raw["asks"])
            pressure = round(bids_vol / (bids_vol + asks_vol) * 100, 1) if (bids_vol + asks_vol) > 0 else 50
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({
                "bids": raw["bids"][:5],
                "asks": raw["asks"][:5],
                "buyPressure": pressure,
            })}

        else:
            return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "Unknown action"})}

    except urllib.error.URLError as e:
        return {"statusCode": 502, "headers": CORS, "body": json.dumps({"error": str(e)})}
    except Exception as e:
        return {"statusCode": 500, "headers": CORS, "body": json.dumps({"error": str(e)})}