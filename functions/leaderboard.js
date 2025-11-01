const fetch = require("node-fetch"); // v2

exports.handler = async function (event) {
  const APP_ID = "7951375894910515";
  const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3";
  const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;

  const params = new URLSearchParams(event.queryStringParameters || {});
  const apiName = params.get("api_name") || "HIGH_SCORE_ALL";

  // 取得件数を抑えつつ（サイト表示用）・カーソルで進む
  const MAX_ENTRIES = 300;
  const PAGE_SIZE = apiName === "HIGH_SCORE_ALL" ? 50 : 100; // まず50件ずつ
  const FIELDS = "rank,user{alias,display_name,id},score,timestamp,id";

  async function getPageByCursor(after, limit) {
    const url =
      `https://graph.oculus.com/leaderboard_entries` +
      `?api_name=${encodeURIComponent(apiName)}` +
      `&fields=${encodeURIComponent(FIELDS)}` +
      `&filter=NONE&limit=${limit}` +
      (after ? `&after=${encodeURIComponent(after)}` : "") +
      `&access_token=${ACCESS_TOKEN}`;

    // タイムアウト制御
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const json = await res.json();
      if (!res.ok) {
        const msg = json?.error?.message || "Unknown error";
        throw new Error(`API ${res.status}: ${msg}`);
      }
      const nextAfter = json?.paging?.cursors?.after || null;
      return { data: json?.data || [], after: nextAfter };
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchAllByCursor() {
    const results = [];
    let after = null;
    let limit = PAGE_SIZE;
    let triesSameCursor = 0;

    while (results.length < MAX_ENTRIES) {
      try {
        const { data, after: nextAfter } = await getPageByCursor(after, limit);
        results.push(...data);
        if (!nextAfter || data.length === 0) break; // 取り切り
        after = nextAfter;
        triesSameCursor = 0;         // 正常に進んだのでリセット
      } catch (err) {
        // next が壊れている時でも、カーソルで小刻みに進めるためのフォールバック
        triesSameCursor += 1;
        if (triesSameCursor >= 3 && limit > 1) {
          // ページサイズを落として再試行（50→25→10→5→1）
          if (limit > 25) limit = 25;
          else if (limit > 10) limit = 10;
          else if (limit > 5) limit = 5;
          else limit = 1;
          triesSameCursor = 0;
        } else if (triesSameCursor >= 3 && limit === 1) {
          // 1件取得でもダメなら打ち切る（部分結果を返す）
          break;
        }
        await new Promise(r => setTimeout(r, 300)); // 軽いバックオフ
      }
    }
    return results.slice(0, MAX_ENTRIES);
  }

  try {
    const data = await fetchAllByCursor();

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    };
  } catch (e) {
    console.error("leaderboard function error:", e);
    return {
      statusCode: 502,
      body: JSON.stringify({ message: "Upstream fetch failed.", error: String(e) }),
    };
  }
};
