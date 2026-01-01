console.log("==== Cleanup Leaderboard Function Loaded ====");

const APP_ID = "7951375894910515";
const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3";
const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;

const LEADERBOARDS = ["HIGH_SCORE_MONTH", "HIGH_SCORE_SPEED"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.handler = async function () {
  console.log("==== Start Cleaning Leaderboards ====");

  try {
    // ✅ 直列実行（安定性UP）
    for (const name of LEADERBOARDS) {
      await cleanLeaderboardEntries(name);
    }

    console.log("✅ Cleanup Function Completed");
    return { statusCode: 200, body: "Leaderboard cleanup complete." };
  } catch (error) {
    console.error("❌ Cleanup function failed:", error);
    return { statusCode: 500, body: `Internal Server Error: ${error.message}` };
  }
};

async function cleanLeaderboardEntries(leaderboardName) {
  console.log(`🚀 Processing leaderboard: ${leaderboardName}`);

  const allEntries = await fetchLeaderboardEntries(leaderboardName);
  console.log(`✅ Total ${allEntries.length} entries fetched for ${leaderboardName}.`);

  if (leaderboardName === "HIGH_SCORE_SPEED") {
    const topEntry = allEntries.find((entry) => entry.rank === 1);
    if (topEntry) {
      console.log("🏆 Saving top entry to HIGH_SCORE_SPEED_ALL");
      await saveEntryToAllTimeLeaderboard(topEntry);
    }
  }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const entriesToDelete = allEntries.filter((entry) => {
    if (!entry.timestamp) return false; // 念のため
    const entryDate = new Date(entry.timestamp * 1000);
    return (
      entryDate.getFullYear() < currentYear ||
      (entryDate.getFullYear() === currentYear && entryDate.getMonth() + 1 < currentMonth)
    );
  });

  console.log(`🗑️ Found ${entriesToDelete.length} entries to delete in ${leaderboardName}`);

  // ✅ ログは増やしすぎない（UIで切れる）
  if (entriesToDelete.length > 0) {
    console.log("📋 Sample entries to delete:", entriesToDelete.slice(0, 3).map((e) => e.id));
  }

  // ✅ 削除は同時実行を絞る（例：5並列）
  const deleteResults = await mapWithConcurrency(entriesToDelete, 5, (entry) =>
    deleteEntry(entry.id, leaderboardName)
  );

  const successCount = deleteResults.filter((r) => r.success).length;
  const failureCount = deleteResults.length - successCount;
  console.log(`✅ Successfully deleted ${successCount} entries from ${leaderboardName}`);
  if (failureCount > 0) console.log(`❌ Failed to delete ${failureCount} entries from ${leaderboardName}`);

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

    if (allEntries.length >= 500) {
      console.log(`⚠️ Fetch limit reached (500 entries), stopping.`);
      break;
    }
  }

  return allEntries;
}

async function fetchJsonWithRetry(url, leaderboardName, maxRetries = 4) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    const isTransient = (json && json.error && json.error.is_transient) || res.status >= 500;

    if (res.ok && !(json && json.error)) return json;

    console.log(`❌ Fetch failed (${leaderboardName}) attempt=${attempt} HTTP=${res.status} transient=${isTransient}`);
    console.log(`BODY: ${text.slice(0, 300)}`);

    if (!isTransient || attempt === maxRetries) {
      throw new Error(`Fetch failed ${leaderboardName} HTTP ${res.status}`);
    }

    const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
    const jitter = Math.floor(Math.random() * 400);
    await sleep(backoff + jitter);
  }
}

// ✅ 同時実行数制限つき map（外部ライブラリ不要）
async function mapWithConcurrency(items, concurrency, worker) {
  const results = [];
  let i = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx]);
    }
  });

  await Promise.all(runners);
  return results;
}

// --- 以下、あなたのままでOK ---
async function saveEntryToAllTimeLeaderboard(entry) { /* 省略：あなたのままでOK */ }
async function deleteEntry(entryId, leaderboardName) { /* 省略：あなたのままでOK */ }
