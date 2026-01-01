console.log("==== Cleanup Leaderboard Function Loaded ====");

// ====== Config ======
const APP_ID = "7951375894910515";
const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3";
const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;

const LEADERBOARDS = ["HIGH_SCORE_MONTH", "HIGH_SCORE_SPEED"];

// 取得上限（Netlify 実行時間対策）
const FETCH_MAX_ENTRIES = 500;

// リトライ設定（transient=true / 5xx のとき）
const FETCH_MAX_RETRIES = 4;

// 削除の同時実行数（多すぎると 500/2 を誘発しやすい）
const DELETE_CONCURRENCY = 5;

// ====== Helpers ======
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJsonWithRetry(url, label, maxRetries = FETCH_MAX_RETRIES) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url);
    const text = await res.text();

    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // ignore
    }

    const apiError = json && json.error ? json.error : null;
    const isTransient =
      (apiError && apiError.is_transient === true) ||
      res.status >= 500;

    // 成功
    if (res.ok && !apiError) return json;

    // 失敗ログ（長すぎないように）
    console.log(
      `❌ Fetch failed (${label}) attempt=${attempt} HTTP=${res.status} transient=${isTransient}`
    );
    console.log(`BODY: ${text.slice(0, 300)}`);

    // transient じゃない or リトライ尽きた → 例外
    if (!isTransient || attempt === maxRetries) {
      throw new Error(`Fetch failed ${label} HTTP ${res.status}`);
    }

    // 指数バックオフ + ジッター
    const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
    const jitter = Math.floor(Math.random() * 400);
    await sleep(backoff + jitter);
  }

  // ここには基本来ない
  throw new Error(`Fetch failed ${label} (unexpected)`);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let i = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) break;
        results[idx] = await worker(items[idx], idx);
      }
    }
  );

  await Promise.all(runners);
  return results;
}

// ====== Netlify handler ======
exports.handler = async function () {
  console.log("==== Start Cleaning Leaderboards ====");

  const results = [];

  // ✅ 直列で実行しつつ、失敗しても次へ
  for (const leaderboardName of LEADERBOARDS) {
    try {
      await cleanLeaderboardEntries(leaderboardName);
      results.push({ leaderboardName, ok: true });
    } catch (e) {
      console.error(`❌ Failed leaderboard: ${leaderboardName}`, e);
      results.push({ leaderboardName, ok: false, error: e.message });
      // 続行
    }
  }

  const failed = results.filter((r) => !r.ok);

  console.log("RESULTS:", results);
  console.log("✅ Cleanup Function Completed");

  return {
    statusCode: failed.length ? 500 : 200,
    body: JSON.stringify({ results }, null, 2),
  };
};

// ====== Core logic ======
async function cleanLeaderboardEntries(leaderboardName) {
  console.log(`🚀 Processing leaderboard: ${leaderboardName}`);

  const allEntries = await fetchLeaderboardEntries(leaderboardName);
  console.log(`✅ Total ${allEntries.length} entries fetched for ${leaderboardName}.`);

  // 🔹 HIGH_SCORE_SPEED のトップエントリーを保存（取得できた場合のみ）
  if (leaderboardName === "HIGH_SCORE_SPEED") {
    const topEntry = allEntries.find((entry) => entry.rank === 1);
    if (topEntry) {
      console.log("🏆 Saving top entry to HIGH_SCORE_SPEED_ALL");
      await saveEntryToAllTimeLeaderboard(topEntry);
    } else {
      console.log("ℹ️ No top entry found for HIGH_SCORE_SPEED (maybe empty).");
    }
  }

  // 🔹 現在の年月
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // 🔹 削除対象（前月以前）
  const entriesToDelete = allEntries.filter((entry) => {
    const ts = Number(entry.timestamp);
    if (!Number.isFinite(ts) || ts <= 0) return false;

    const entryDate = new Date(ts * 1000);
    const y = entryDate.getFullYear();
    const m = entryDate.getMonth() + 1;

    return y < currentYear || (y === currentYear && m < currentMonth);
  });

  console.log(`🗑️ Found ${entriesToDelete.length} entries to delete in ${leaderboardName}`);
  if (entriesToDelete.length > 0) {
    console.log("📋 Sample delete IDs:", entriesToDelete.slice(0, 5).map((e) => e.id));
  }

  if (entriesToDelete.length === 0) {
    console.log(`🗑️ Completed cleanup for ${leaderboardName} (nothing to delete)`);
    return;
  }

  // 🔹 削除（同時実行制限あり）
  const deleteResults = await mapWithConcurrency(
    entriesToDelete,
    DELETE_CONCURRENCY,
    async (entry) => deleteEntry(entry.id, leaderboardName)
  );

  const successCount = deleteResults.filter((r) => r.success).length;
  const failureCount = deleteResults.length - successCount;

  console.log(`✅ Successfully deleted ${successCount} entries from ${leaderboardName}`);
  if (failureCount > 0) {
    console.log(`❌ Failed to delete ${failureCount} entries from ${leaderboardName}`);
  }

  console.log(`🗑️ Completed cleanup for ${leaderboardName}`);
}

async function fetchLeaderboardEntries(leaderboardName) {
  console.log(`📡 Fetching entries for leaderboard: ${leaderboardName}`);

  let allEntries = [];
  let nextUrl =
    `https://graph.oculus.com/leaderboard_entries?api_name=${leaderboardName}` +
    `&access_token=${ACCESS_TOKEN}` +
    `&fields=id,timestamp,rank,score,user{id,alias,profile_url},extra_data_base64` +
    `&filter=NONE&limit=100`;

  while (nextUrl) {
    const data = await fetchJsonWithRetry(nextUrl, leaderboardName);

    if (data?.data) allEntries.push(...data.data);
    nextUrl = data?.paging?.next || null;

    // Netlify 実行時間対策
    if (allEntries.length >= FETCH_MAX_ENTRIES) {
      console.log(`⚠️ Fetch limit reached (${FETCH_MAX_ENTRIES} entries), stopping.`);
      break;
    }
  }

  return allEntries;
}

// ✅ トップスコアを ALL TIME リーダーボードに保存
async function saveEntryToAllTimeLeaderboard(entry) {
  console.log(`🔄 Saving entry ${entry.id} to HIGH_SCORE_SPEED_ALL`);

  const scoreValue = parseInt(entry.score, 10);
  if (isNaN(scoreValue)) {
    console.log(`❌ Invalid score format for entry ${entry.id}, skipping...`);
    return;
  }

  const body = new URLSearchParams({
    api_name: "HIGH_SCORE_SPEED_ALL",
    access_token: ACCESS_TOKEN,
    score: scoreValue.toString(),
    extra_data_base64: entry.extra_data_base64 || "",
    user_id: entry.user.id,
    force_update: "true",
  });

  const response = await fetch("https://graph.oculus.com/leaderboard_submit_entry", {
    method: "POST",
    body,
  });

  if (response.ok) {
    console.log(`✅ Successfully saved entry ${entry.id} to HIGH_SCORE_SPEED_ALL.`);
  } else {
    console.log(`❌ Failed to save entry ${entry.id}. Response:`, (await response.text()).slice(0, 300));
  }
}

// ✅ リーダーボードのエントリー削除
async function deleteEntry(entryId, leaderboardName) {
  const deleteUrl = `https://graph.oculus.com/${entryId}?access_token=${ACCESS_TOKEN}`;

  const response = await fetch(deleteUrl, { method: "DELETE" });

  if (response.ok) {
    // ログ増やしすぎない（必要ならコメントアウト解除）
    // console.log(`✅ Deleted entry: ${entryId} (${leaderboardName})`);
    return { success: true };
  } else {
    console.log(
      `❌ Failed to delete entry ${entryId} (${leaderboardName}). Response:`,
      (await response.text()).slice(0, 300)
    );
    return { success: false };
  }
}
