// ✅ デバッグ用ログを最初に追加
console.log("==== Cleanup Leaderboard Function Loaded ====");

// ✅ Meta API の認証情報
const APP_ID = "7951375894910515";
const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3";
const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;

// ✅ Netlify の環境変数に問題がないか確認
console.log("ACCESS_TOKEN (masked):", ACCESS_TOKEN ? ACCESS_TOKEN.slice(0, 10) + "..." : "NOT SET");

const LEADERBOARDS = ["TEST", "TEST2"];

// ✅ Netlify Function
exports.handler = async function () {
    console.log("==== Start Cleaning Leaderboards ====");

    try {
        for (const leaderboard of LEADERBOARDS) {
            console.log(`Processing leaderboard: ${leaderboard}`);
            await cleanLeaderboardEntries(leaderboard);
        }

        console.log("==== Cleanup Function Completed ====");
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
    console.log(`Fetching entries for leaderboard: ${leaderboardName}`);

    let allEntries = [];
    let nextUrl = `https://graph.oculus.com/leaderboard_entries?api_name=${leaderboardName}&access_token=${ACCESS_TOKEN}&fields=id,timestamp,rank,score,user{id,alias,profile_url},extra_data_base64&filter=NONE&limit=100`;

    while (nextUrl) {
        console.log(`Fetching: ${nextUrl}`);
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
    }

    console.log(`✅ Total ${allEntries.length} entries fetched for ${leaderboardName}.`);
}
