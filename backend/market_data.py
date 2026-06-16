import requests

def get_market_data():

    try:
        url = "https://api.coingecko.com/api/v3/simple/price"

        params = {
            "ids": "bitcoin",
            "vs_currencies": "usd",
            "include_24hr_change": "true"
        }

        data = requests.get(url, params=params).json()

        return {
            "BTC": {
                "price": data["bitcoin"]["usd"],
                "change": round(
                    data["bitcoin"]["usd_24h_change"], 2
                )
            }
        }

    except Exception as e:

        print(e)

        return {}
