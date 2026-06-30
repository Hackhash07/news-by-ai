-- Supabase Migration Script for Institutional-Grade Upgrade
-- Run this in the Supabase SQL Editor

-- 1. Add new columns to the existing `news` table
ALTER TABLE news ADD COLUMN IF NOT EXISTS source_weight FLOAT DEFAULT 1.0;
ALTER TABLE news ADD COLUMN IF NOT EXISTS source_tier TEXT DEFAULT 'secondary';
ALTER TABLE news ADD COLUMN IF NOT EXISTS analysis_source TEXT DEFAULT 'headline_only';
ALTER TABLE news ADD COLUMN IF NOT EXISTS content_signature JSONB;

-- 2. Create the `job_log` table to track APScheduler runs
CREATE TABLE IF NOT EXISTS job_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_name TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    articles_processed INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    status TEXT NOT NULL
);

-- 3. Create the `signal_outcomes` table for the quant backtester
CREATE TABLE IF NOT EXISTS signal_outcomes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    news_id BIGINT NOT NULL REFERENCES news(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    signal_direction TEXT NOT NULL,
    confidence FLOAT NOT NULL,
    signal_timestamp TIMESTAMPTZ NOT NULL,
    price_at_signal FLOAT,
    price_1h_after FLOAT,
    price_24h_after FLOAT,
    price_7d_after FLOAT,
    outcome_1h TEXT,
    outcome_24h TEXT,
    outcome_7d TEXT
);

-- 4. Add some basic indexes for performance on the new tables
CREATE INDEX IF NOT EXISTS idx_job_log_started_at ON job_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_news_id ON signal_outcomes(news_id);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_ticker ON signal_outcomes(ticker);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_timestamp ON signal_outcomes(signal_timestamp DESC);
