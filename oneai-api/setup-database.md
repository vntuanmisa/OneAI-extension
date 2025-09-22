# Setup Supabase Database

## Bước 1: Truy cập Supabase Dashboard

1. Đăng nhập vào https://supabase.com/dashboard
2. Chọn project: `frgljavyfoqkgxvzfjwj`
3. Vào SQL Editor (biểu tượng SQL bên trái)

## Bước 2: Chạy Schema Setup

Copy và paste nội dung file `supabase-schema.sql` vào SQL Editor và Execute.

Hoặc chạy từng phần:

### 2.1. Tạo Tables
```sql
-- 1. Bảng employees
CREATE TABLE employees (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_code VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Bảng monthly_stats  
CREATE TABLE monthly_stats (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_code VARCHAR(50) NOT NULL,
    year_month VARCHAR(7) NOT NULL,
    total_usage INTEGER DEFAULT 0,
    daily_stats JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(employee_code, year_month),
    FOREIGN KEY (employee_code) REFERENCES employees(employee_code) ON DELETE CASCADE
);

-- 3. Bảng usage_history
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
    
    FOREIGN KEY (employee_code) REFERENCES employees(employee_code) ON DELETE CASCADE,
    FOREIGN KEY (employee_code, year_month) REFERENCES monthly_stats(employee_code, year_month) ON DELETE CASCADE
);
```

### 2.2. Tạo Indexes
```sql
CREATE INDEX idx_monthly_stats_employee_month ON monthly_stats(employee_code, year_month);
CREATE INDEX idx_usage_history_employee_month ON usage_history(employee_code, year_month);
CREATE INDEX idx_usage_history_date ON usage_history(usage_date);
CREATE INDEX idx_usage_history_timestamp ON usage_history(timestamp_ms);
```

### 2.3. Setup RLS (Row Level Security)
```sql
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service role" ON employees FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON monthly_stats FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON usage_history FOR ALL USING (true);
```

### 2.4. Tạo Functions
```sql
-- Function để update monthly_stats tự động
CREATE OR REPLACE FUNCTION update_monthly_stats()
RETURNS TRIGGER AS $$
BEGIN
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

-- Trigger
CREATE TRIGGER trigger_update_monthly_stats
    AFTER INSERT ON usage_history
    FOR EACH ROW
    EXECUTE FUNCTION update_monthly_stats();
```

### 2.5. Tạo Optimized Functions
```sql
-- Function lấy dữ liệu tháng (1 query) - Fixed nested aggregates
CREATE OR REPLACE FUNCTION get_monthly_data(
    p_employee_code VARCHAR(50),
    p_year_month VARCHAR(7)
)
RETURNS TABLE(stats JSONB, history JSONB) AS $$
BEGIN
    RETURN QUERY
    WITH monthly_data AS (
        SELECT COALESCE(ms.daily_stats, '{}'::jsonb) as daily_stats
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

-- Function upsert dữ liệu (batch operation) - Fixed FK constraint
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
    
    -- Clear existing history for this month
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
```

## Bước 3: Verify Setup

Chạy query test:
```sql
-- Test tạo employee
SELECT * FROM employees;

-- Test function
SELECT * FROM get_monthly_data('TEST', '2025-09');

-- Test upsert
SELECT upsert_monthly_data(
    'TEST', 
    '2025-09',
    '{"2025-09-22": 1}'::jsonb,
    '{"2025-09-22": [{"timestamp": 1726953600000, "messageId": "test", "message": "test message", "modelCode": "gpt"}]}'::jsonb
);

-- Verify data
SELECT * FROM monthly_stats WHERE employee_code = 'TEST';
SELECT * FROM usage_history WHERE employee_code = 'TEST';
```

## Bước 4: Test API

Sau khi setup xong database, test API:

```bash
# Test debug endpoint
curl "https://one-ai-extension.vercel.app/api/debug"

# Test GET (empty)
curl -H "X-Auth-Token: b75d8f44f4d54d1abf1d8fc3d1e0b9a3" \
  "https://one-ai-extension.vercel.app/api/data/TEST?period=2025-09"

# Test POST
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: b75d8f44f4d54d1abf1d8fc3d1e0b9a3" \
  -d '{"stats":{"2025-09-22":1},"history":{"2025-09-22":[{"timestamp":1726953600000,"messageId":"test","message":"Hello","modelCode":"gpt"}]}}' \
  "https://one-ai-extension.vercel.app/api/data/TEST?period=2025-09"

# Test GET (with data)
curl -H "X-Auth-Token: b75d8f44f4d54d1abf1d8fc3d1e0b9a3" \
  "https://one-ai-extension.vercel.app/api/data/TEST?period=2025-09"
```

## Tối ưu hóa đã implement

### 1. Single Query Operations
- `get_monthly_data()`: 1 query thay vì multiple SELECT
- `upsert_monthly_data()`: 1 transaction thay vì multiple INSERT/UPDATE

### 2. In-Memory Caching
- Cache GET results trong 5 phút
- Tự động clear cache khi POST
- Cache management endpoints

### 3. Batch Operations
- `/api/batch/:employeeCode` cho multiple periods
- Parallel processing với Promise.all

### 4. Database Optimizations
- Proper indexes cho performance
- JSONB cho flexible schema
- Triggers tự động update aggregations
- Foreign keys với CASCADE delete

### 5. Reduced Network Calls
- Combine stats + history trong 1 response
- Batch upsert thay vì individual calls
- Client-side caching trong extension
