-- 查询缓存表
CREATE TABLE IF NOT EXISTS query_cache (
  uuid VARCHAR(36) PRIMARY KEY,
  data JSONB NOT NULL,
  "cachedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "type" VARCHAR(50),
  "name" VARCHAR(255)
);

-- 创建索引加速查询
CREATE INDEX IF NOT EXISTS idx_query_cache_type ON query_cache("type");
CREATE INDEX IF NOT EXISTS idx_query_cache_name ON query_cache("name");
CREATE INDEX IF NOT EXISTS idx_query_cache_cachedAt ON query_cache("cachedAt");

-- 清理过期数据（手动执行或定时任务）
-- DELETE FROM query_cache WHERE "cachedAt" < NOW() - INTERVAL '7 days';
