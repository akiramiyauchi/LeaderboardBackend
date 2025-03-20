const fetch = require("node-fetch");

// Meta API の認証情報
const APP_ID = "7951375894910515";
const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3";
const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;

const LEADERBOARDS = ["HIGH_SCORE_MONTH", "HIGH_SCORE_SPEED"];

// Netlify Function (毎月1日に実行)
exports.handler = async function () {
    console.log("==== Start Cleaning Leaderboards ====");

    for (const leaderboard of LEADERBOARDS) {
        await cleanLeaderboardEntries(leaderboard);
    }

    console.log("==== End Cleaning Leaderboards ====");
    return {
        statusCode: 200,
        body: "Leaderboard cleanup complete.",
    };
};

// 🔹 リーダーボードのエントリーを取得・削除
async function cleanLeaderboardEntries(leaderboardName) {
    console.log(`Fetching entries for leaderboard: ${leaderboardName}`);

    let allEntries = [];
    let nextUrl = `https://graph.oculus.com/leaderboard_entries?api_name=${leaderboardName}&access_token=${ACCESS_TOKEN}&fields=id,timestamp,rank,score,user{id,alias,profile_url},extra_data_base64&filter=NONE&limit=100`;

    // 🔹 ページネーションしながらエントリー取得
    while (nextUrl) {
        const response = await fetch(nextUrl);
        if (!response.ok) {
            console.log(`Failed to fetch ${leaderboardName}: ${response.status}`);
            return;
        }

        const data = await response.json();
        if (data?.data) {
            allEntries.push(...data.data);
        }

        nextUrl = data?.paging?.next || null;
    }

    console.log(`Total ${allEntries.length} entries fetched for ${leaderboardName}.`);

    // 🔹 HIGH_SCORE_SPEED のトップエントリーを保存
    if (leaderboardName === "HIGH_SCORE_SPEED") {
        const topEntry = allEntries.find((entry) => entry.rank === 1);
        if (topEntry) {
            await saveEntryToAllTimeLeaderboard(topEntry);
        }
    }

    // 🔹 現在の年月を取得
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // JSは0から始まるため +1
    const currentYear = now.getFullYear();

    // 🔹 古いエントリーを削除
    for (const entry of allEntries) {
        const entryDate = new Date(entry.timestamp * 1000); // UNIX秒をミリ秒に変換
        if (entryDate.getMonth() + 1 !== currentMonth || entryDate.getFullYear() !== currentYear) {
            console.log(`== Deleting: ${entry.user.alias} (${entryDate.toISOString().slice(0, 10)}) ==`);
            //await deleteEntry(entry.id, leaderboardName);
        }
    }
}

// 🔹 トップスコアを ALL TIME リーダーボードに保存
async function saveEntryToAllTimeLeaderboard(entry) {
    console.log(`Saving entry ${entry.id} to HIGH_SCORE_SPEED_ALL`);

    const scoreValue = parseInt(entry.score, 10);
    if (isNaN(scoreValue)) {
        console.log(`Invalid score format for entry ${entry.id}, skipping...`);
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
        body: body,
    });

    if (response.ok) {
        console.log(`✅ Successfully saved entry ${entry.id} to HIGH_SCORE_SPEED_ALL.`);
    } else {
        console.log(`❌ Failed to save entry ${entry.id}. Response:`, await response.text());
    }
}

// 🔹 リーダーボードのエントリー削除
async function deleteEntry(entryId, leaderboardName) {
    console.log(`Deleting entry: ${entryId} from ${leaderboardName}`);

    const deleteUrl = `https://graph.oculus.com/${entryId}?access_token=${ACCESS_TOKEN}`;
    const response = await fetch(deleteUrl, { method: "DELETE" });

    if (response.ok) {
        console.log(`✅ Successfully deleted entry: ${entryId}`);
    } else {
        console.log(`❌ Failed to delete entry ${entryId}. Response:`, await response.text());
    }
}
