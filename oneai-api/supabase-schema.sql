-- OneAI Usage Tracker - Supabase Database Schema
-- Tối ưu cho performance với ít requests nhất

-- 1. Bảng employees (master data)
CREATE TABLE employees (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_code VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Bảng monthly_stats (tổng hợp theo tháng)
CREATE TABLE monthly_stats (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_code VARCHAR(50) NOT NULL,
    year_month VARCHAR(7) NOT NULL, -- YYYY-MM format
    total_usage INTEGER DEFAULT 0,
    daily_stats JSONB DEFAULT '{}', -- {YYYY-MM-DD: count}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Composite unique constraint
    UNIQUE(employee_code, year_month),
    
    -- Foreign key reference
    FOREIGN KEY (employee_code) REFERENCES employees(employee_code) ON DELETE CASCADE
);

-- 3. Bảng usage_history (chi tiết lịch sử)
CREATE TABLE usage_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_code VARCHAR(50) NOT NULL,
    year_month VARCHAR(7) NOT NULL,
    usage_date DATE NOT NULL,
    message_id VARCHAR(100),
    message_content TEXT,
    model_code VARCHAR(50),
    timestamp_ms BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Foreign key references
    FOREIGN KEY (employee_code) REFERENCES employees(employee_code) ON DELETE CASCADE,
    FOREIGN KEY (employee_code, year_month) REFERENCES monthly_stats(employee_code, year_month) ON DELETE CASCADE
);

-- 4. Indexes cho performance
CREATE INDEX idx_monthly_stats_employee_month ON monthly_stats(employee_code, year_month);
CREATE INDEX idx_usage_history_employee_month ON usage_history(employee_code, year_month);
CREATE INDEX idx_usage_history_date ON usage_history(usage_date);
CREATE INDEX idx_usage_history_timestamp ON usage_history(timestamp_ms);

-- 5. RLS (Row Level Security) policies
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_history ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (API key)
CREATE POLICY "Allow all for service role" ON employees FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON monthly_stats FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON usage_history FOR ALL USING (true);

-- 6. Functions for data aggregation
CREATE OR REPLACE FUNCTION update_monthly_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Update daily_stats JSONB and total_usage when history changes
    IF TG_OP = 'INSERT' THEN
        INSERT INTO monthly_stats (employee_code, year_month, total_usage, daily_stats)
        VALUES (
            NEW.employee_code,
            NEW.year_month,
            1,
            jsonb_build_object(NEW.usage_date::text, 1)
        )
        ON CONFLICT (employee_code, year_month)
        DO UPDATE SET
            total_usage = monthly_stats.total_usage + 1,
            daily_stats = jsonb_set(
                COALESCE(monthly_stats.daily_stats, '{}'::jsonb),
                ARRAY[NEW.usage_date::text],
                (COALESCE((monthly_stats.daily_stats->>NEW.usage_date::text)::int, 0) + 1)::text::jsonb
            ),
            updated_at = NOW();
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 7. Trigger to auto-update monthly_stats
CREATE TRIGGER trigger_update_monthly_stats
    AFTER INSERT ON usage_history
    FOR EACH ROW
    EXECUTE FUNCTION update_monthly_stats();

-- 8. Function to get monthly data (fixed nested aggregates)
CREATE OR REPLACE FUNCTION get_monthly_data(
    p_employee_code VARCHAR(50),
    p_year_month VARCHAR(7)
)
RETURNS TABLE(
    stats JSONB,
    history JSONB
) AS $$
BEGIN
    RETURN QUERY
    WITH monthly_data AS (
        SELECT 
            COALESCE(ms.daily_stats, '{}'::jsonb) as daily_stats
        FROM monthly_stats ms
        WHERE ms.employee_code = p_employee_code 
        AND ms.year_month = p_year_month
    ),
    history_grouped AS (
        SELECT 
            uh.usage_date::text as date_key,
            jsonb_agg(
                jsonb_build_object(
                    'timestamp', uh.timestamp_ms,
                    'messageId', uh.message_id,
                    'message', uh.message_content,
                    'modelCode', uh.model_code
                ) ORDER BY uh.timestamp_ms
            ) as date_history
        FROM usage_history uh
        WHERE uh.employee_code = p_employee_code 
        AND uh.year_month = p_year_month
        GROUP BY uh.usage_date
    ),
    history_data AS (
        SELECT 
            CASE 
                WHEN COUNT(*) > 0 THEN jsonb_object_agg(hg.date_key, hg.date_history)
                ELSE '{}'::jsonb
            END as daily_history
        FROM history_grouped hg
    )
    SELECT 
        COALESCE(md.daily_stats, '{}'::jsonb) as stats,
        COALESCE(hd.daily_history, '{}'::jsonb) as history
    FROM monthly_data md
    FULL OUTER JOIN history_data hd ON true;
END;
$$ LANGUAGE plpgsql;

-- 9. Upsert function for batch operations (fixed FK constraint)
CREATE OR REPLACE FUNCTION upsert_monthly_data(
    p_employee_code VARCHAR(50),
    p_year_month VARCHAR(7),
    p_stats JSONB,
    p_history JSONB
)
RETURNS BOOLEAN AS $$
DECLARE
    date_key TEXT;
    history_array JSONB;
    history_item JSONB;
BEGIN
    -- Ensure employee exists
    INSERT INTO employees (employee_code) 
    VALUES (p_employee_code) 
    ON CONFLICT (employee_code) DO NOTHING;
    
    -- Create/update monthly_stats FIRST (required for FK constraint)
    INSERT INTO monthly_stats (employee_code, year_month, daily_stats, total_usage)
    VALUES (
        p_employee_code,
        p_year_month,
        COALESCE(p_stats, '{}'::jsonb),
        COALESCE((SELECT SUM((value)::int) FROM jsonb_each_text(p_stats)), 0)
    )
    ON CONFLICT (employee_code, year_month)
    DO UPDATE SET
        daily_stats = COALESCE(p_stats, '{}'::jsonb),
        total_usage = COALESCE((SELECT SUM((value)::int) FROM jsonb_each_text(p_stats)), 0),
        updated_at = NOW();
    
    -- Clear existing history for this month (full replace)
    DELETE FROM usage_history 
    WHERE employee_code = p_employee_code 
    AND year_month = p_year_month;
    
    -- Insert new history data (only if history is provided)
    IF p_history IS NOT NULL AND jsonb_typeof(p_history) = 'object' THEN
        FOR date_key IN SELECT jsonb_object_keys(p_history)
        LOOP
            history_array := p_history->date_key;
            
            -- Check if history_array is actually an array
            IF jsonb_typeof(history_array) = 'array' THEN
                FOR history_item IN SELECT jsonb_array_elements(history_array)
                LOOP
                    INSERT INTO usage_history (
                        employee_code, year_month, usage_date,
                        message_id, message_content, model_code, timestamp_ms
                    ) VALUES (
                        p_employee_code,
                        p_year_month,
                        date_key::date,
                        history_item->>'messageId',
                        history_item->>'message',
                        history_item->>'modelCode',
                        COALESCE((history_item->>'timestamp')::bigint, extract(epoch from now()) * 1000)
                    );
                END LOOP;
            END IF;
        END LOOP;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
