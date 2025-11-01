const fetch = require("node-fetch"); // v2

// ---- Tunables -------------------------------------------------
const TIMEOUT_MS = 3500;             // 1リクエストの短タイムアウト
const PAGE1_LIMIT = 50;              // 先頭ページ
const PAGE2_CANDIDATES = [50, 40, 30, 25, 20, 10]; // 2ページ目の並列レース
// ----------------------------------------------------------------

exports.handler = async function (event) {
  const APP_ID = "7951375894910515";
  const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3";
  const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;

  const params = new URLSearchParams(event.queryStringParameters || {});
  const apiName = params.get("api_name") || "HIGH_SCORE_ALL";

  // HIGH_SCORE_ALL は100位までを最速で返す。他は従来通りでもOKだがここでは同じ実装に寄せる
  const MAX_ENTRIES = apiName === "HIGH_SCORE_ALL" ? 100 : 300;
  const FIELDS = "rank,user{alias,display_name,id},score,timestamp,id";

  function withTimeout(url) {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const p = fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept-Encoding": "gzip", // 圧縮（node-fetchが解凍）
      },
    }).finally(() => clearTimeout(to));
    return p;
  }

  function buildUrl({ after = null, limit }) {
    return (
      `https://graph.oculus.com/leaderboard_entries` +
      `?api_name=${encodeURIComponent(apiName)}` +
      `&fields=${encodeURIComponent(FIELDS)}` +
      `&filter=NONE&limit=${limit}` +
      (after ? `&after=${encodeURIComponent(after)}` : "") +
      `&access_token=${ACCESS_TOKEN}`
    );
  }

  async function fetchPage(after, limit) {
    const res = await withTimeout(buildUrl({ after, limit }));
    const json = await res.json();
    if (!res.ok) {
      const msg = json?.error?.message || "Unknown error";
      const code = json?.error?.code;
      throw new Error(`API ${res.status}${code ? "/"+code : ""}: ${msg}`);
    }
    const nextAfter = json?.paging?.cursors?.after || null;
    return { data: json?.data || [], after: nextAfter };
  }

  // 2ページ目はサイズ違いを並列発射して最初に成功したものを使う
  async function fetchSecondPageFast(afterCursorFromPage1) {
    const controllers = [];
    try {
      const promises = PAGE2_CANDIDATES.map((lim) =>
        (async () => {
          const res = await withTimeout(buildUrl({ after: afterCursorFromPage1, limit: lim }));
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            const msg = j?.error?.message || res.statusText;
            throw new Error(`LIM${lim}: ${res.status} ${msg}`);
          }
          const json = await res.json();
          const data = json?.data || [];
          const after = json?.paging?.cursors?.after || null;
          return { data, after, limit: lim };
        })()
      );

      // どれか一つ成功したら採用（Promise.any）
      const winner = await Promise.any(promises);
      return winner;
    } catch (err) {
      // すべて失敗→空で返す（1ページ目だけ表示）
      return { data: [], after: null, limit: 0 };
    } finally {
      // AbortController は withTimeout内で閉じているのでここでは何もしない
    }
  }

  try {
    // 1ページ目（50件固定）
    const page1 = await fetchPage(null, PAGE1_LIMIT);
    let results = [...page1.data];

    // 2ページ目を高速レースで取得（壊れ next を踏まず、after で進む）
    if (results.length < MAX_ENTRIES && page1.after) {
      const page2 = await fetchSecondPageFast(page1.after);
      // 100件に丸める（過剰取得の可能性を防ぐ）
      for (const row of page2.data) {
        if (results.length >= MAX_ENTRIES) break;
        results.push(row);
      }
    }

    // 念のため rank でソート & 重複防止
    results.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    const unique = [];
    const seen = new Set();
    for (const r of results) {
      const key = r.id || `${r.user?.id ?? ""}:${r.rank ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(r);
      if (unique.length >= MAX_ENTRIES) break;
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
        "Cache-Control": "max-age=30, stale-while-revalidate=120", // 軽いキャッシュ（ブラウザ側）
      },
      body: JSON.stringify(unique),
    };
  } catch (e) {
    // 失敗時でも部分的に返せるよう、1ページ目だけ再度トライして返す
    try {
      const page1 = await fetchPage(null, PAGE1_LIMIT);
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(page1.data),
      };
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({ message: "Upstream fetch failed.", error: String(e) }),
      };
    }
  }
};
