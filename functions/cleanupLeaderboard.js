console.log("==== Cleanup Leaderboard Function Loaded ====");

// ✅ Meta API の認証情報
const APP_ID = "7951375894910515";
const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3";
const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;

//const LEADERBOARDS = ["HIGH_SCORE_MONTH", "HIGH_SCORE_SPEED"];
const LEADERBOARDS = ["TEST", "TEST2"];

// ✅ Netlify Function
exports.handler = async function () {
    console.log("==== Start Cleaning Leaderboards ====");

    try {
        // 🔹 並列処理でリーダーボードを処理
        await Promise.all(LEADERBOARDS.map(cleanLeaderboardEntries));

        console.log("✅ Cleanup Function Completed");
        return {
            statusCode: 200,
            body: "Leaderboard cleanup complete.",
        };
    } catch (error) {
        console.error("❌ Cleanup function failed:", error);
        return {
            statusCode: 500,
            body: `Internal Server Error: ${error.message}`,
        };
    }
};

// ✅ リーダーボードのエントリーを取得・削除
async function cleanLeaderboardEntries(leaderboardName) {
    console.log(`🚀 Processing leaderboard: ${leaderboardName}`);

    let allEntries = [];
    let nextUrl = `https://graph.oculus.com/leaderboard_entries?api_name=${leaderboardName}&access_token=${ACCESS_TOKEN}&fields=id,timestamp,rank,score,user{id,alias,profile_url},extra_data_base64&filter=NONE&limit=100`;

    while (nextUrl) {
        console.log(`📡 Fetching: ${nextUrl}`);
        const response = await fetch(nextUrl);
        if (!response.ok) {
            console.log(`❌ Failed to fetch ${leaderboardName}: ${response.status}`);
            return;
        }

        const data = await response.json();
        if (data?.data) {
            allEntries.push(...data.data);
        }

        nextUrl = data?.paging?.next || null;

        // 🔹 500 件取得したら終了 (Netlify の 10 秒制限対策)
        if (allEntries.length >= 500) {
            console.log(`⚠️ Fetch limit reached (500 entries), stopping.`);
            break;
        }
    }

    console.log(`✅ Total ${allEntries.length} entries fetched for ${leaderboardName}.`);

    // 🔹 HIGH_SCORE_SPEED のトップエントリーを保存
    if (leaderboardName === "HIGH_SCORE_SPEED") {
        const topEntry = allEntries.find((entry) => entry.rank === 1);
        if (topEntry) {
            console.log("🏆 Saving top entry to HIGH_SCORE_SPEED_ALL");
            await saveEntryToAllTimeLeaderboard(topEntry);
        }
    }

    // 🔹 現在の年月を取得
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // 🔹 削除対象のエントリー一覧を取得
    const entriesToDelete = allEntries.filter((entry) => {
        const entryDate = new Date(entry.timestamp * 1000);
        return (
            entryDate.getFullYear() < currentYear ||
            (entryDate.getFullYear() === currentYear && entryDate.getMonth() + 1 < currentMonth)
        );
    });

    console.log(`🗑️ Found ${entriesToDelete.length} entries to delete in ${leaderboardName}`);

    // 🔹 削除対象のエントリーをログに出力
    if (entriesToDelete.length > 0) {
        console.log("📋 Entries to delete:");
        entriesToDelete.forEach((entry) => {
            console.log(
                `  - ${entry.user.alias || "Unknown"} (${entry.id}) | Date: ${new Date(
                    entry.timestamp * 1000
                ).toISOString().slice(0, 10)}`
            );
        });
    }

    // 🔹 並列でエントリー削除
    const deleteResults = await Promise.all(entriesToDelete.map((entry) => deleteEntry(entry.id, leaderboardName)));

    // 🔹 削除成功・失敗の統計をログに出力
    const successCount = deleteResults.filter((result) => result.success).length;
    const failureCount = deleteResults.length - successCount;
    console.log(`✅ Successfully deleted ${successCount} entries from ${leaderboardName}`);
    if (failureCount > 0) {
        console.log(`❌ Failed to delete ${failureCount} entries from ${leaderboardName}`);
    }

    console.log(`🗑️ Completed cleanup for ${leaderboardName}`);
}

// ✅ リーダーボードのエントリー削除
async function deleteEntry(entryId, leaderboardName) {
    console.log(`🗑️ Deleting entry: ${entryId} from ${leaderboardName}`);

    const deleteUrl = `https://graph.oculus.com/${entryId}?access_token=${ACCESS_TOKEN}`;
    const response = await fetch(deleteUrl, { method: "DELETE" });

    if (response.ok) {
        console.log(`✅ Successfully deleted entry: ${entryId}`);
        return { success: true };
    } else {
        console.log(`❌ Failed to delete entry ${entryId}. Response:`, await response.text());
        return { success: false };
    }
}
