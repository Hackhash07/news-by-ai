def calculate_confidence(
    importance,
    sentiment,
    category
):

    score = 50

    score += importance * 3

    if sentiment != "Neutral":
        score += 10

    if category == "Geopolitics":
        score += 10

    if category == "Finance":
        score += 15

    if score > 100:
        score = 100

    return score
