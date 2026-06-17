import requests
import os

FMP_API_KEY = os.getenv("FMP_API_KEY")


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

        sp500 = requests.get(
            f"https://financialmodelingprep.com/api/v3/quote/%5EGSPC?apikey={FMP_API_KEY}"
        ).json()

        nasdaq = requests.get(
            f"https://financialmodelingprep.com/api/v3/quote/%5EIXIC?apikey={FMP_API_KEY}"
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
            },

            "SP500": {
                "price": round(
                    sp500[0]["price"],
                    2
                ),
                "change": round(
                    sp500[0]["changesPercentage"],
                    2
                )
            },

            "NASDAQ": {
                "price": round(
                    nasdaq[0]["price"],
                    2
                ),
                "change": round(
                    nasdaq[0]["changesPercentage"],
                    2
                )
            }
        }

    except Exception as e:

        print("Market Data Error:", e)

        return {}
