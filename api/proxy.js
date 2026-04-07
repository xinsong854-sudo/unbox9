// Vercel Edge Function - 捏 Ta API 代理（带共享缓存）
// 解决跨域问题，隐藏 Token，共享查询结果

import { sql } from '@vercel/postgres';

export const config = {
  runtime: 'edge',
};

// 缓存配置
const CACHE_EXPIRE_DAYS = 7; // 7 天有效期

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-token, Authorization',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const targetPath = url.searchParams.get('target') || '';
    const useCache = url.searchParams.get('cache') !== 'false';
    
    // 特殊接口：查询缓存统计
    if (targetPath === '/stats') {
      return handleStats(corsHeaders);
    }
    
    // 特殊接口：搜索缓存的角色/元素
    if (targetPath === '/search-cache') {
      const keyword = url.searchParams.get('keyword') || '';
      return handleSearchCache(keyword, corsHeaders);
    }
    
    // 特殊接口：获取热门查询
    if (targetPath === '/popular') {
      const limit = parseInt(url.searchParams.get('limit') || '20');
      return handlePopular(limit, corsHeaders);
    }

    if (!targetPath) {
      return new Response(JSON.stringify({ error: '缺少 target 参数' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 提取 UUID
    const uuidMatch = targetPath.match(/uuid=([0-9a-f-]{36})/i);
    const uuid = uuidMatch ? uuidMatch[1] : null;

    // 查缓存
    if (req.method === 'GET' && uuid && useCache) {
      try {
        const cached = await sql`
          SELECT data, "cachedAt", "type", "name", "queryCount" FROM query_cache 
          WHERE uuid = ${uuid} 
          AND "cachedAt" > NOW() - INTERVAL '${CACHE_EXPIRE_DAYS} days'
          ORDER BY "cachedAt" DESC 
          LIMIT 1
        `;
        
        if (cached.rows.length > 0) {
          console.log('[Cache] 命中:', uuid);
          
          // 增加查询次数
          await sql`
            UPDATE query_cache 
            SET "queryCount" = "queryCount" + 1 
            WHERE uuid = ${uuid}
          `;
          
          return new Response(JSON.stringify(cached.rows[0].data), {
            status: 200,
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json',
              'X-Cache': 'HIT'
            }
          });
        }
        console.log('[Cache] 未命中:', uuid);
      } catch (e) {
        console.error('[Cache] 查询失败:', e.message);
      }
    }

    // 转发到捏 Ta API
    const targetUrl = 'https://api.talesofai.cn' + targetPath;
    const headers = new Headers({ 'Content-Type': 'application/json' });
    
    const token = req.headers.get('x-token');
    if (token) headers.set('x-token', token);

    let body = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        body = JSON.stringify(await req.json());
      } catch (e) {
        body = await req.text();
      }
    }

    console.log('[Proxy] 请求:', req.method, targetUrl);

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    console.log('[Proxy] 响应:', response.status);

    const data = await response.text();

    // 保存到缓存
    if (response.status === 200 && req.method === 'GET' && uuid) {
      try {
        const jsonData = JSON.parse(data);
        await sql`
          INSERT INTO query_cache (uuid, data, "cachedAt", "type", "name", "queryCount")
          VALUES (
            ${uuid},
            ${JSON.stringify(jsonData)},
            NOW(),
            ${jsonData.type || 'unknown'},
            ${jsonData.item?.name || jsonData.name || 'Unknown'},
            1
          )
          ON CONFLICT (uuid) 
          DO UPDATE SET 
            data = EXCLUDED.data,
            "cachedAt" = NOW(),
            "type" = EXCLUDED."type",
            "name" = EXCLUDED."name",
            "queryCount" = query_cache."queryCount" + 1
        `;
        console.log('[Cache] 已保存:', uuid);
      } catch (e) {
        console.error('[Cache] 保存失败:', e.message);
      }
    }

    return new Response(data, {
      status: response.status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'X-Cache': response.status === 200 && uuid ? 'MISS' : undefined
      }
    });

  } catch (error) {
    console.error('[Proxy] 错误:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// 处理统计接口
async function handleStats(corsHeaders) {
  try {
    const total = await sql`SELECT COUNT(*) as count FROM query_cache`;
    const today = await sql`
      SELECT COUNT(*) as count FROM query_cache 
      WHERE "cachedAt" > NOW() - INTERVAL '1 day'
    `;
    const popular = await sql`
      SELECT "name", "type", "queryCount" 
      FROM query_cache 
      ORDER BY "queryCount" DESC 
      LIMIT 10
    `;
    
    return new Response(JSON.stringify({
      total: total.rows[0].count,
      today: today.rows[0].count,
      popular: popular.rows
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// 处理搜索缓存
async function handleSearchCache(keyword, corsHeaders) {
  try {
    const results = await sql`
      SELECT uuid, "name", "type", "queryCount", "cachedAt"
      FROM query_cache
      WHERE "name" ILIKE ${'%' + keyword + '%'}
      ORDER BY "queryCount" DESC
      LIMIT 20
    `;
    
    return new Response(JSON.stringify(results.rows), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// 处理热门查询
async function handlePopular(limit, corsHeaders) {
  try {
    const results = await sql`
      SELECT uuid, "name", "type", "queryCount", "cachedAt"
      FROM query_cache
      ORDER BY "queryCount" DESC
      LIMIT ${limit}
    `;
    
    return new Response(JSON.stringify(results.rows), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
