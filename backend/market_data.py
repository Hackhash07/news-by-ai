import requests

def get_market_data():

    try:

        btc = requests.get(
            "https://api.coingecko.com/api/v3/simple/price",
            params={
                "ids": "bitcoin",
                "vs_currencies": "usd",
                "include_24hr_change": "true"
            },
            timeout=10
        ).json()

        usdinr = requests.get(
            "https://open.er-api.com/v6/latest/USD",
            timeout=10
        ).json()

        return {

            "BTC": {
                "price": btc["bitcoin"]["usd"],
                "change": round(
                    btc["bitcoin"]["usd_24h_change"],
                    2
                )
            },

            "USDINR": {
                "price": round(
                    usdinr["rates"]["INR"],
                    2
                ),
                "change": 0
            }
        }

    except Exception as e:

        print("Market Data Error:", e)

        return {}

