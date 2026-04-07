// Vercel Edge Function - 捏 Ta API 代理（带缓存）
// 解决跨域问题，隐藏 Token，缓存查询结果

import { sql } from '@vercel/postgres';

export const config = {
  runtime: 'edge',
};

// 缓存配置
const CACHE_EXPIRE = 7 * 24 * 60 * 60 * 1000; // 7 天

export default async function handler(req) {
  // 允许跨域
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-token, Authorization',
  };

  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const targetPath = url.searchParams.get('target') || '';
    const useCache = url.searchParams.get('cache') !== 'false'; // 默认启用缓存
    
    if (!targetPath) {
      return new Response(JSON.stringify({ error: '缺少 target 参数' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 提取 UUID（如果是查询请求）
    const uuidMatch = targetPath.match(/uuid=([0-9a-f-]{36})/i);
    const uuid = uuidMatch ? uuidMatch[1] : null;

    // 如果是 GET 请求且有 UUID，先查缓存
    if (req.method === 'GET' && uuid && useCache) {
      try {
        const cached = await sql`
          SELECT data, "cachedAt" FROM query_cache 
          WHERE uuid = ${uuid} 
          AND "cachedAt" > NOW() - INTERVAL '7 days'
          ORDER BY "cachedAt" DESC 
          LIMIT 1
        `;
        
        if (cached.rows.length > 0) {
          console.log('[Cache] 命中缓存:', uuid);
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
        // 缓存查询失败，继续正常请求
      }
    }

    // 构建捏 Ta API 完整 URL
    const targetUrl = 'https://api.talesofai.cn' + targetPath;

    // 准备请求头
    const headers = new Headers({
      'Content-Type': 'application/json',
    });

    // 从请求头获取 Token
    const token = req.headers.get('x-token');
    if (token) {
      headers.set('x-token', token);
    }

    // 准备请求体
    let body = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        body = JSON.stringify(await req.json());
      } catch (e) {
        body = await req.text();
      }
    }

    console.log('[Proxy] 请求:', req.method, targetUrl);

    // 转发请求到捏 Ta API
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    console.log('[Proxy] 响应:', response.status);

    // 获取响应内容
    const data = await response.text();

    // 如果是成功的 GET 请求且有 UUID，保存到缓存
    if (response.status === 200 && req.method === 'GET' && uuid) {
      try {
        const jsonData = JSON.parse(data);
        await sql`
          INSERT INTO query_cache (uuid, data, "cachedAt", "type", "name")
          VALUES (
            ${uuid},
            ${JSON.stringify(jsonData)},
            NOW(),
            ${jsonData.type || 'unknown'},
            ${jsonData.item?.name || jsonData.name || 'Unknown'}
          )
          ON CONFLICT (uuid) 
          DO UPDATE SET 
            data = EXCLUDED.data,
            "cachedAt" = NOW(),
            "type" = EXCLUDED."type",
            "name" = EXCLUDED."name"
        `;
        console.log('[Cache] 已保存:', uuid);
      } catch (e) {
        console.error('[Cache] 保存失败:', e.message);
      }
    }

    // 返回响应
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
