# 捏 Ta API 代理（带缓存）

Vercel 云函数代理，解决跨域问题 + 缓存查询结果。

## 🚀 部署步骤

### 1️⃣ 安装依赖

```bash
cd /home/node/.openclaw/workspace/_tools/nieta-proxy
npm install
```

### 2️⃣ 配置 Vercel Postgres

1. 访问 https://vercel.com/dashboard
2. 创建或选择项目
3. 点击 **Storage** → **Add Database** → **Postgres**
4. 创建数据库 `nieta-proxy`
5. 复制 `.env.local` 配置

### 3️⃣ 创建数据库表

```bash
# 方法 1：Vercel 网页执行 SQL
# 访问 https://vercel.com/dashboard/postgres
# 选择数据库 → SQL → 执行 sql/init.sql

# 方法 2：命令行执行
vercel env pull
psql $POSTGRES_URL -f sql/init.sql
```

### 4️⃣ 部署到 Vercel

```bash
# 登录 Vercel
vercel login

# 部署
vercel --prod
```

### 5️⃣ 配置环境变量

在 Vercel 项目设置中添加：
- `POSTGRES_URL` - 数据库连接字符串（自动创建）

---

## 📡 API 使用

### 代理请求

```bash
GET https://your-project.vercel.app/api/proxy?target=/v2/travel/parent/parent-favor/list?page_size=100
```

**参数：**
- `target` - 捏 Ta API 路径（必填）
- `cache` - 是否启用缓存（默认 `true`）

**请求头：**
- `x-token` - 捏 Ta Token（可选）

**响应头：**
- `X-Cache: HIT` - 缓存命中
- `X-Cache: MISS` - 缓存未命中

---

## 🗄️ 数据库表结构

```sql
CREATE TABLE query_cache (
  uuid VARCHAR(36) PRIMARY KEY,
  data JSONB NOT NULL,
  "cachedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "type" VARCHAR(50),
  "name" VARCHAR(255)
);
```

**字段说明：**
- `uuid` - 角色/元素 UUID
- `data` - 完整的 API 响应数据（JSON）
- `cachedAt` - 缓存时间
- `type` - 类型（character/elementum）
- `name` - 名字（方便搜索）

---

## 📊 缓存策略

| 场景 | 行为 |
|------|------|
| **首次查询** | API 请求 → 保存缓存 → 返回 |
| **7 天内再查** | 读取缓存 → 直接返回（HIT） |
| **超过 7 天** | 自动过期 → API 请求 → 更新缓存 |
| **cache=false** | 跳过缓存 → 直接 API 请求 |

---

## 🔧 管理缓存

### 查看所有缓存

```sql
SELECT uuid, name, type, "cachedAt" 
FROM query_cache 
ORDER BY "cachedAt" DESC;
```

### 删除指定缓存

```sql
DELETE FROM query_cache WHERE uuid = 'xxxx-xxxx-xxxx';
```

### 清空所有缓存

```sql
TRUNCATE TABLE query_cache;
```

### 清理过期缓存

```sql
DELETE FROM query_cache 
WHERE "cachedAt" < NOW() - INTERVAL '7 days';
```

---

## 💰 Vercel 免费额度

| 资源 | 额度 | 说明 |
|------|------|------|
| **函数调用** | 100GB-小时/月 | 足够用 |
| **Postgres** | 256MB 存储 | 约 10 万条缓存 |
| **带宽** | 100GB/月 | 足够用 |

---

## 🎯 前端集成

修改 unbox 的 API 地址：

```javascript
const API = 'https://your-project.vercel.app/api/proxy';

async function apiGet(path, retry=true){
  const url = `${API}?target=${encodeURIComponent(path)}`;
  const response = await fetch(url, {
    headers: { 'x-token': token }
  });
  return await response.json();
}
```

---

## ⚠️ 注意事项

1. **首次部署** - 需要先创建数据库表
2. **环境变量** - `POSTGRES_URL` 必须配置
3. **缓存大小** - 定期清理过期数据
4. **Token 安全** - 云函数隐藏 Token，用户看不到

---

## 📝 License

MIT
