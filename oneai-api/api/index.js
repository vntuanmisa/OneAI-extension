// Express API for Vercel with Supabase integration
// - Tối ưu hóa requests với caching và batch operations
// - Xác thực bằng header X-Auth-Token

const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Middlewares
app.use(express.json({ limit: '1mb' }));

// CORS: Hoàn toàn mở cho Chrome Extensions và web origins
app.use((req, res, next) => {
  // Set CORS headers for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Auth-Token');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  
  // Handle preflight OPTIONS requests immediately
  if (req.method === 'OPTIONS') {
    console.log('Preflight OPTIONS request for:', req.url);
    return res.status(200).end();
  }
  
  next();
});

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL || 'https://frgljavyfoqkgxvzfjwj.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZyZ2xqYXZ5Zm9xa2d4dnpmandqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1MDM1MTksImV4cCI6MjA3NDA3OTUxOX0.D09K7nKc2Wqz7mCjV5QOxiNseJAcO1fnPXM8PbZjwCg';

const supabase = createClient(supabaseUrl, supabaseKey);

// In-memory cache để giảm DB calls (TTL 5 phút)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(employeeCode, period) {
  return `${employeeCode}:${period}`;
}

function setCache(key, data) {
  cache.set(key, {
    data,
    timestamp: Date.now()
  });
}

function getCache(key) {
  const cached = cache.get(key);
  if (!cached) return null;
  
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  
  return cached.data;
}

function clearCache(employeeCode, period) {
  const key = getCacheKey(employeeCode, period);
  cache.delete(key);
}

// Helpers
const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

function ensureAuth(req, res, next) {
  const token = req.header('X-Auth-Token');
  const secret = process.env.API_SECRET_KEY;
  if (!secret || !token || token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function validatePeriod(period) {
  return typeof period === 'string' && PERIOD_REGEX.test(period);
}

// Global OPTIONS handler for all routes (backup for preflight)
app.options('*', (req, res) => {
  console.log('Global OPTIONS handler for:', req.url);
  res.status(200).end();
});

// Health check
app.get('/api/health', (_req, res) => res.status(200).json({ ok: true }));

// Debug endpoint - kiểm tra env
app.get('/api/debug', (_req, res) => {
  const hasSecret = !!process.env.API_SECRET_KEY;
  const secretLength = process.env.API_SECRET_KEY ? process.env.API_SECRET_KEY.length : 0;
  const hasSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_ANON_KEY;
  res.status(200).json({ 
    hasSecret, 
    secretLength,
    hasSupabase,
    cacheSize: cache.size,
    env: process.env.NODE_ENV || 'unknown'
  });
});

// Routes
// GET /api/data/:employeeCode?period=YYYY-MM
app.get('/api/data/:employeeCode', ensureAuth, async (req, res) => {
  try {
    const { employeeCode } = req.params;
    const { period } = req.query;
    
    if (!validatePeriod(period)) {
      return res.status(400).json({ error: 'Invalid period. Expected YYYY-MM.' });
    }

    const cacheKey = getCacheKey(employeeCode, period);
    
    // Check cache first
    const cached = getCache(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    // Query Supabase using optimized function (single query)
    const { data, error } = await supabase.rpc('get_monthly_data', {
      p_employee_code: employeeCode,
      p_year_month: period
    });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Database query failed' });
    }

    // Handle empty result
    if (!data || data.length === 0) {
      const emptyResult = { stats: {}, history: {} };
      setCache(cacheKey, emptyResult);
      return res.status(404).json(emptyResult);
    }

    const result = {
      stats: data[0].stats || {},
      history: data[0].history || {}
    };

    // Cache the result
    setCache(cacheKey, result);
    
    return res.status(200).json(result);
  } catch (err) {
    console.error('GET error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/data/:employeeCode?period=YYYY-MM
// Body: JSON to upsert (full replace for the month)
app.post('/api/data/:employeeCode', ensureAuth, async (req, res) => {
  try {
    const { employeeCode } = req.params;
    const { period } = req.query;
    
    if (!validatePeriod(period)) {
      return res.status(400).json({ error: 'Invalid period. Expected YYYY-MM.' });
    }

    const payload = req.body || {};
    const stats = payload.stats || {};
    const history = payload.history || {};

    // Use optimized upsert function (single transaction)
    const { data, error } = await supabase.rpc('upsert_monthly_data', {
      p_employee_code: employeeCode,
      p_year_month: period,
      p_stats: stats,
      p_history: history
    });

    if (error) {
      console.error('Supabase upsert error:', error);
      return res.status(500).json({ error: 'Database upsert failed' });
    }

    // Clear cache for this employee/period
    clearCache(employeeCode, period);
    
    return res.status(200).json({ status: 'success' });
  } catch (err) {
    console.error('POST error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Batch endpoint for multiple periods (optimization)
app.post('/api/batch/:employeeCode', ensureAuth, async (req, res) => {
  try {
    const { employeeCode } = req.params;
    const { periods } = req.body; // Array of {period, stats, history}
    
    if (!Array.isArray(periods)) {
      return res.status(400).json({ error: 'Expected periods array' });
    }

    const results = [];
    
    // Process in parallel with Promise.all
    const promises = periods.map(async (item) => {
      const { period, stats = {}, history = {} } = item;
      
      if (!validatePeriod(period)) {
        return { period, success: false, error: 'Invalid period format' };
      }

      try {
        const { error } = await supabase.rpc('upsert_monthly_data', {
          p_employee_code: employeeCode,
          p_year_month: period,
          p_stats: stats,
          p_history: history
        });

        if (error) {
          return { period, success: false, error: error.message };
        }

        // Clear cache
        clearCache(employeeCode, period);
        
        return { period, success: true };
      } catch (err) {
        return { period, success: false, error: err.message };
      }
    });

    const batchResults = await Promise.all(promises);
    
    return res.status(200).json({ 
      status: 'batch_completed',
      results: batchResults,
      total: batchResults.length,
      successful: batchResults.filter(r => r.success).length
    });
  } catch (err) {
    console.error('Batch error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Cache management endpoints
app.delete('/api/cache/:employeeCode', ensureAuth, (req, res) => {
  const { employeeCode } = req.params;
  const { period } = req.query;
  
  if (period) {
    clearCache(employeeCode, period);
  } else {
    // Clear all cache entries for this employee
    for (const key of cache.keys()) {
      if (key.startsWith(`${employeeCode}:`)) {
        cache.delete(key);
      }
    }
  }
  
  res.status(200).json({ status: 'cache_cleared' });
});

app.get('/api/cache/stats', ensureAuth, (req, res) => {
  const stats = {
    size: cache.size,
    keys: Array.from(cache.keys()),
    ttl_ms: CACHE_TTL
  };
  res.status(200).json(stats);
});

// Export Express app directly for @vercel/node
module.exports = app;