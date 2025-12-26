// netlify/functions/leaderboard.js
const fetch = require("node-fetch"); // v2

// ---- Tunables -------------------------------------------------
const TIMEOUT_MS_ALL = 3500;
const TIMEOUT_MS_OTHER = 12000;

const PAGE1_LIMIT = 20;

// 2ページ目候補（ALLの高速化用）
const PAGE2_CANDIDATES = [50, 40, 30, 25, 20, 10];

// リトライ設定（上流一時不安定対策）
const RETRY_MAX = 2;           // 合計 1 + 2 = 3回まで
const RETRY_BASE_DELAY = 250;  // ms（指数的に伸ばす）
// ----------------------------------------------------------------

exports.handler = async function (event) {
  // TODO: 本当は環境変数推奨
  const APP_ID = "7951375894910515";
  const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3";
  const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;

  const params = new URLSearchParams(event.queryStringParameters || {});
  const apiName = params.get("api_name") || "HIGH_SCORE_ALL";

  const isAll = apiName === "HIGH_SCORE_ALL";
  const MAX_ENTRIES = isAll ? 100 : 300;

  const FIELDS = "rank,user{alias,display_name,id},score,timestamp,id";

  function timeoutMs() {
    return isAll ? TIMEOUT_MS_ALL : TIMEOUT_MS_OTHER;
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

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function withTimeout(url) {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeoutMs());
    return fetch(url, {
      signal: controller.signal,
      headers: { "Accept-Encoding": "gzip" },
    }).finally(() => clearTimeout(to));
  }

  // 1回のfetchを「jsonは必ず1回だけ読む」形で安全に処理
  async function fetchJson(url) {
    const res = await withTimeout(url);
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = json?.error?.message || res.statusText || "Unknown error";
      const code = json?.error?.code; // Oculus側のエラーコードっぽい
      const err = new Error(`API ${res.status}${code ? "/" + code : ""}: ${msg}`);
      err.httpStatus = res.status;
      err.oculusCode = code;
      err.raw = json;
      throw err;
    }
    return json;
  }

  // 上流の一時エラー(5xx) or Abort のときだけリトライ
  function isRetryableError(err) {
    const s = err?.httpStatus;
    if (s && s >= 500) return true;
    // node-fetch v2 のAbortは name が AbortError になることが多い
    if (String(err?.name) === "AbortError") return true;
    if (String(err?.message || "").includes("AbortError")) return true;
    return false;
  }

  async function fetchJsonWithRetry(url) {
    let lastErr = null;
    for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
      try {
        return await fetchJson(url);
      } catch (e) {
        lastErr = e;
        if (!isRetryableError(e) || attempt === RETRY_MAX) break;
        // 250ms, 500ms, ...
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  async function fetchPage(after, limit) {
    const json = await fetchJsonWithRetry(buildUrl({ after, limit }));
    const nextAfter = json?.paging?.cursors?.after || null;
    return { data: json?.data || [], after: nextAfter };
  }

  // ALLは速さ重視：limit違いの並列レースで2ページ目の成功を拾う
  async function fetchSecondPageRace(afterCursorFromPage1) {
    const promises = PAGE2_CANDIDATES.map(async (lim) => {
      const json = await fetchJsonWithRetry(buildUrl({ after: afterCursorFromPage1, limit: lim }));
      return {
        data: json?.data || [],
        after: json?.paging?.cursors?.after || null,
        limit: lim,
      };
    });

    try {
      return await Promise.any(promises);
    } catch {
      return { data: [], after: null, limit: 0 };
    }
  }

  // Monthly/Speedは安定重視：逐次でフォールバック
  async function fetchSecondPageSequential(afterCursorFromPage1) {
    for (const lim of PAGE2_CANDIDATES) {
      try {
        const json = await fetchJsonWithRetry(buildUrl({ after: afterCursorFromPage1, limit: lim }));
        return {
          data: json?.data || [],
          after: json?.paging?.cursors?.after || null,
          limit: lim,
        };
      } catch (e) {
        // 次の候補へ
      }
    }
    return { data: [], after: null, limit: 0 };
  }

  function normalizeAndDedup(rows) {
    rows.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

    const unique = [];
    const seen = new Set();

    for (const r of rows) {
      const key = r.id || `${r.user?.id ?? ""}:${r.rank ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(r);
      if (unique.length >= MAX_ENTRIES) break;
    }
    return unique;
  }

  try {
    // 1ページ目
    const page1 = await fetchPage(null, PAGE1_LIMIT);
    let results = [...page1.data];

    // 2ページ目（必要なら）
    if (results.length < MAX_ENTRIES && page1.after) {
      const page2 = isAll
        ? await fetchSecondPageRace(page1.after)
        : await fetchSecondPageSequential(page1.after);

      for (const row of page2.data) {
        if (results.length >= MAX_ENTRIES) break;
        results.push(row);
      }
    }

    const unique = normalizeAndDedup(results);

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
        "Cache-Control": "max-age=30, stale-while-revalidate=120",
      },
      body: JSON.stringify(unique),
    };
  } catch (e) {
    console.log("[LB] FAIL", {
      apiName,
      name: e?.name,
      message: e?.message,
      httpStatus: e?.httpStatus,
      oculusCode: e?.oculusCode,
    });
  
    // 失敗時でも1ページ目だけ返せるなら返す
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
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Upstream fetch failed.",
          error: String(e),
        }),
      };
    }
  }
};
