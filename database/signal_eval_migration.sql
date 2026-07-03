-- Migration Script: Signal Evaluation Pipeline Refactor

-- 1. Add new columns to `signal_outcomes`
ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING';
ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS evaluation_time TIMESTAMPTZ;
ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS last_attempt TIMESTAMPTZ;
ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS provider_used TEXT DEFAULT 'yfinance';
ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS price_signal NUMERIC;
ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS price_after NUMERIC;
ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS percentage_change NUMERIC;
ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ;

-- 2. Migrate existing pending rows
-- We ONLY want to migrate rows that have not yet been evaluated (outcome_1h is NULL).
UPDATE signal_outcomes 
SET 
    status = 'PENDING',
    evaluation_time = signal_timestamp + interval '1 hour'
WHERE outcome_1h IS NULL;

-- 3. Update indexes for performance on the new query pattern
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_status_eval_time 
ON signal_outcomes(status, evaluation_time);
