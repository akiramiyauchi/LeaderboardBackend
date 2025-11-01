// netlify/functions/leaderboard.js
const fetch = require("node-fetch"); // v2

const APP_ID = "7951375894910515";
const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3";
const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;

const MAX_ENTRIES = 300;      // 返す最大件数
const PAGE_LIMIT  = 100;      // 1ページあたり
const MAX_PAGES   = 5;        // 念のための上限
const TIMEOUT_MS  = 5000;     // 1リクエストあたりのタイムアウト
const RETRIES     = 3;        // 503/429/5xx の再試行回数

// 503/429などにリトライ付きのfetch
async function fetchWithRetry(url, opts = {}, retries = RETRIES) {
  for (let i = 0; i <= retries; i++) {
    const ac = new AbortController();
    const t  = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...opts, signal: ac.signal });
      clearTimeout(t);
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        if (i < retries) {
          const backoff = 250 * Math.pow(2, i) + Math.floor(Math.random() * 100);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
      }
      return res; // 2xx/4xx/5xx最終
    } catch (e) {
      clearTimeout(t);
      if (i < retries) {
        const backoff = 250 * Math.pow(2, i) + Math.floor(Math.random() * 100);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      throw e;
    }
  }
}

exports.handler = async function (event) {
  try {
    const params = new URLSearchParams(event.queryStringParameters || {});
    const apiName = (params.get("api_name") || "HIGH_SCORE_ALL").trim();

    // 任意: ホワイトリスト（悪用防止）
    // const ALLOWED = new Set(["HIGH_SCORE_ALL","HIGH_SCORE_MONTH","HIGH_SCORE_SPEED","HIGH_SCORE_SPEED_ALL"]);
    // if (!ALLOWED.has(apiName)) return { statusCode: 400, body: "invalid api_name" };

    let url = `https://graph.oculus.com/leaderboard_entries?api_name=${encodeURIComponent(apiName)}&fields=rank,user{alias,display_name},score,timestamp&id_format=OBJECT&filter=NONE&limit=${PAGE_LIMIT}&access_token=${ACCESS_TOKEN}`;

    const results = [];
    let pages = 0;

    while (url && results.length < MAX_ENTRIES && pages < MAX_PAGES) {
      pages++;
      const res  = await fetchWithRetry(url, { headers: { "Accept": "application/json" } });
      const json = await res.json();

      if (!res.ok) {
        const msg = json?.error?.message || `${res.status} ${res.statusText}`;
        // ここで throw すると上でキャッチ→500になる
        throw new Error(`APIエラー: ${msg}`);
      }

      if (Array.isArray(json.data)) {
        results.push(...json.data);
        if (results.length >= MAX_ENTRIES) break;
      }

      url = json?.paging?.next || null;
    }

    // 返却
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        // Netlify CDNキャッシュ（1分）＋古いのを5分再利用
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
      body: JSON.stringify(results.slice(0, MAX_ENTRIES)),
    };
  } catch (error) {
    console.error("エラー詳細:", error);
    return {
      statusCode: 503, // upstream 一時障害を反映
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ message: "Failed to load data.", error: String(error) }),
    };
  }
};
