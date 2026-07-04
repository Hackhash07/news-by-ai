from pydantic import BaseModel, Field
from typing import Literal, List

VALID_CATEGORIES = Literal[
    "Crypto", "Macro", "Equities", "Forex", "Commodities",
    "Fixed Income", "Monetary Policy", "Geopolitics", "Politics"
]

class AffectedAsset(BaseModel):
    asset: str
    ticker: str
    asset_class: Literal["Equity", "Commodity", "Forex", "Crypto", "Fixed Income", "Index", "Unknown"]
    direction: Literal["Bullish", "Bearish", "Neutral"]
    confidence: float = Field(ge=0.0, le=1.0)
    evaluation_window_hours: int = Field(ge=1, le=168)
    reason: str

class ConsensusDeviation(BaseModel):
    direction: str
    magnitude: Literal["None", "Minor", "Moderate", "Major"]
    rationale: str

class TimeHorizon(BaseModel):
    intraday: str
    short_term: str
    medium_term: str

class NewsAnalysis(BaseModel):
    sentiment: Literal["Positive", "Negative", "Neutral"]
    importance: int = Field(ge=1, le=10)
    confidence: float = Field(ge=0.0, le=1.0)
    category: VALID_CATEGORIES
    executive_summary: str
    market_thesis: str
    affected_assets: List[AffectedAsset]
    first_order_effects: List[str]
    second_order_effects: List[str]
    bull_case: str
    bear_case: str
    time_horizon: TimeHorizon
    key_risks: List[str]
    portfolio_tags: List[str]
    watch_next: List[str]
    consensus_deviation: ConsensusDeviation

class MorningBrief(BaseModel):
    headline: str
    summary: str
    top_assets: List[str]
    overall_sentiment: Literal["Bullish", "Bearish", "Mixed", "Cautious"]

class BatchNewsAnalysisItem(NewsAnalysis):
    article_index: int

class BatchNewsResponse(BaseModel):
    analyses: List[BatchNewsAnalysisItem]
