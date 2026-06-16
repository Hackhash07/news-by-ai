def estimate_horizon(
    category,
    importance
):

    if category == "Geopolitics":

        if importance >= 8:
            return "1-7 Days"

        return "1-2 Days"

    if category == "Finance":

        if importance >= 8:
            return "1-3 Days"

        return "Same Day"

    if category == "Technology":
        return "1-5 Days"

    return "Unknown"
