def calculate_confidence(
    importance,
    source,
    ai_probabilities
):
    """
    Confidence = Source Reliability + Event Importance + AI Certainty
    Max score: 100
    """
    score = 0
    
    # 1. Source Reliability (Max 40)
    source_lower = str(source).lower()
    if "reuters" in source_lower or "bloomberg" in source_lower or "ft" in source_lower:
        score += 40
    elif "bbc" in source_lower or "nyt" in source_lower or "wsj" in source_lower:
        score += 35
    else:
        score += 20

    # 2. Event Importance (Max 30)
    # importance is expected to be 1-10
    score += min(importance * 3, 30)

    # 3. AI Certainty (Max 30)
    # Average probability of affected assets
    if ai_probabilities and len(ai_probabilities) > 0:
        avg_prob = sum(ai_probabilities) / len(ai_probabilities)
        score += min(int(avg_prob * 0.3), 30)
    else:
        score += 15

    return min(score, 100)

