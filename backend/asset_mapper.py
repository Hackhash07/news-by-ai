def map_assets(category, market_impact):

    assets = []

    if category == "Geopolitics":
        assets.extend([
            "Crude Oil",
            "Gold",
            "Defense Stocks"
        ])

    elif category == "Finance":
        assets.extend([
            "NIFTY",
            "BANKNIFTY",
            "USDINR"
        ])

    elif category == "Technology":
        assets.extend([
            "NASDAQ",
            "Tech Stocks"
        ])

    return assets
