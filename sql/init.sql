-- 查询缓存表（共享数据）
CREATE TABLE IF NOT EXISTS query_cache (
  uuid VARCHAR(36) PRIMARY KEY,
  data JSONB NOT NULL,
  "cachedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "type" VARCHAR(50),
  "name" VARCHAR(255),
  "queryCount" INTEGER DEFAULT 1
);

-- 创建索引加速查询
CREATE INDEX IF NOT EXISTS idx_query_cache_type ON query_cache("type");
CREATE INDEX IF NOT EXISTS idx_query_cache_name ON query_cache("name");
CREATE INDEX IF NOT EXISTS idx_query_cache_cachedAt ON query_cache("cachedAt");
CREATE INDEX IF NOT EXISTS idx_query_cache_queryCount ON query_cache("queryCount" DESC);

-- 查看统计
SELECT 
  COUNT(*) as total_records,
  COUNT(DISTINCT "type") as types,
  SUM("queryCount") as total_queries
FROM query_cache;

-- 查看热门角色
SELECT "name", "type", "queryCount", "cachedAt"
FROM query_cache
ORDER BY "queryCount" DESC
LIMIT 20;

-- 清理过期数据（手动执行或定时任务）
DELETE FROM query_cache 
WHERE "cachedAt" < NOW() - INTERVAL '7 days';

-- 查看今天新增
SELECT COUNT(*) as today_added
FROM query_cache
WHERE "cachedAt" > NOW() - INTERVAL '1 day';
