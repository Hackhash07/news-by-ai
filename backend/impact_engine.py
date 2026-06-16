def determine_direction(category, sentiment):

    if category == "Geopolitics":

        if sentiment == "Negative":
            return {
                "Crude Oil": "Bullish",
                "Gold": "Bullish",
                "Defense Stocks": "Bullish"
            }

        return {
            "Crude Oil": "Neutral",
            "Gold": "Neutral",
            "Defense Stocks": "Neutral"
        }

    if category == "Finance":

        if sentiment == "Positive":
            return {
                "NIFTY": "Bullish",
                "BANKNIFTY": "Bullish"
            }

        if sentiment == "Negative":
            return {
                "NIFTY": "Bearish",
                "BANKNIFTY": "Bearish"
            }

    return {}
