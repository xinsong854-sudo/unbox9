# 捏 Ta API 代理（带共享缓存）

Vercel 云函数代理，**共享查询结果，减少 API 请求**。

---

## 🚀 核心功能

| 功能 | 说明 |
|------|------|
| **共享缓存** | 所有用户共享查询结果 |
| **减少请求** | 查过的角色不再调 API |
| **避免限流** | 多人使用也不容易触发 429 |
| **自动过期** | 7 天自动清理 |
| **统计功能** | 查看热门角色/查询次数 |

---

## 📡 API 使用

### 基础代理

```javascript
const API = 'https://unbox9-mz7e.vercel.app/api/proxy';

// GET 请求
const url = `${API}?target=${encodeURIComponent('/v2/travel/parent/parent-favor/list?page_size=100')}`;
const response = await fetch(url, {
  headers: { 'x-token': 'YOUR_TOKEN' }
});
const data = await response.json();
```

### 查询缓存统计

```javascript
const stats = await fetch(`${API}?target=/stats`);
const data = await stats.json();

// 返回：
{
  "total": 1234,      // 总缓存数
  "today": 56,        // 今天新增
  "popular": [        // 热门角色 TOP10
    {"name": "角色名", "type": "character", "queryCount": 123},
    ...
  ]
}
```

### 搜索缓存

```javascript
const results = await fetch(`${API}?target=/search-cache&keyword=角色名`);
const data = await results.json();

// 返回匹配的角色列表
[
  {"uuid": "xxx", "name": "角色名", "type": "character", "queryCount": 10},
  ...
]
```

### 获取热门查询

```javascript
const popular = await fetch(`${API}?target=/popular&limit=20`);
const data = await popular.json();

// 返回最热门的角色/元素
[
  {"uuid": "xxx", "name": "角色名", "type": "character", "queryCount": 100},
  ...
]
```

---

## 🗄️ 数据库表结构

```sql
CREATE TABLE query_cache (
  uuid VARCHAR(36) PRIMARY KEY,
  data JSONB NOT NULL,          -- 完整 API 响应
  "cachedAt" TIMESTAMP DEFAULT NOW(),
  "type" VARCHAR(50),            -- character/elementum
  "name" VARCHAR(255),           -- 角色/元素名
  "queryCount" INTEGER DEFAULT 1  -- 被查询次数
);
```

---

## 📊 数据共享逻辑

```
用户 A 查询角色 X
       ↓
保存到数据库（queryCount=1）
       ↓
用户 B 查询角色 X
       ↓
从数据库返回（queryCount=2）
       ↓
用户 C 查询角色 X
       ↓
从数据库返回（queryCount=3）
```

**好处：**
- ✅ 第 1 个人消耗 API 请求
- ✅ 后面的人都不消耗
- ✅ 避免限流
- ✅ 加快速度

---

## 🔧 部署步骤

### 1️⃣ 安装依赖

```bash
cd /home/node/.openclaw/workspace/_tools/nieta-proxy
npm install
```

### 2️⃣ 创建数据库

1. Vercel Dashboard → Storage → Add Database → Postgres
2. 创建数据库 `nieta-proxy`

### 3️⃣ 执行 SQL

```sql
-- 在 Vercel Postgres SQL 标签执行
CREATE TABLE IF NOT EXISTS query_cache (
  uuid VARCHAR(36) PRIMARY KEY,
  data JSONB NOT NULL,
  "cachedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "type" VARCHAR(50),
  "name" VARCHAR(255),
  "queryCount" INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_query_cache_name ON query_cache("name");
CREATE INDEX IF NOT EXISTS idx_query_cache_queryCount ON query_cache("queryCount" DESC);
```

### 4️⃣ 部署到 Vercel

```bash
vercel --prod
```

---

## 📈 管理缓存

### 查看统计

```sql
SELECT 
  COUNT(*) as total,
  SUM("queryCount") as total_queries,
  COUNT(DISTINCT "type") as types
FROM query_cache;
```

### 查看热门

```sql
SELECT "name", "type", "queryCount"
FROM query_cache
ORDER BY "queryCount" DESC
LIMIT 20;
```

### 清理过期

```sql
DELETE FROM query_cache 
WHERE "cachedAt" < NOW() - INTERVAL '7 days';
```

### 清空缓存

```sql
TRUNCATE TABLE query_cache;
```

---

## 🎯 前端集成示例

```javascript
class NietaClient {
  constructor(proxyUrl) {
    this.api = proxyUrl;
  }
  
  async request(path, token = null) {
    const url = `${this.api}?target=${encodeURIComponent(path)}`;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-token'] = token;
    
    const response = await fetch(url, { headers });
    const data = await response.json();
    
    // 检查是否来自缓存
    const isCache = response.headers.get('X-Cache') === 'HIT';
    console.log(isCache ? '✅ 缓存命中' : '📡 API 请求');
    
    return data;
  }
  
  // 获取统计
  async getStats() {
    return await this.request('/stats');
  }
  
  // 搜索缓存
  async searchCache(keyword) {
    return await this.request(`/search-cache&keyword=${encodeURIComponent(keyword)}`);
  }
  
  // 获取热门
  async getPopular(limit = 20) {
    return await this.request(`/popular&limit=${limit}`);
  }
}

// 使用
const client = new NietaClient('https://unbox9-mz7e.vercel.app/api/proxy');

// 查询角色（自动缓存）
const character = await client.request('/v2/travel/parent/parent-favor/list?page_size=100', token);

// 查看统计
const stats = await client.getStats();
console.log(`总缓存：${stats.total}, 今天：${stats.today}`);

// 搜索缓存
const results = await client.searchCache('角色名');
console.log('找到:', results);
```

---

## 💰 Vercel 免费额度

| 资源 | 额度 | 说明 |
|------|------|------|
| 函数调用 | 100GB-小时/月 | 足够用 |
| Postgres | 256MB 存储 | 约 10 万条缓存 |
| 带宽 | 100GB/月 | 足够用 |

---

## ⚠️ 注意事项

1. **隐私** - 不收集用户 Token、IP 等隐私数据
2. **数据** - 只缓存角色/元素的公开数据
3. **过期** - 7 天自动清理
4. **限流** - 每人独立限流，缓存共享

---

## 🔗 相关链接

- **API 地址**: https://unbox9-mz7e.vercel.app/api/proxy
- **GitHub**: https://github.com/xinsong854-sudo/unbox9
- **Vercel**: https://vercel.com/xinsong854-sudo/unbox9

---

**共享缓存，减少请求，避免限流！** ✧⁺(●˙▾˙●)⸝⁺✧
