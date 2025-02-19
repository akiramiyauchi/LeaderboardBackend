const fetch = require("node-fetch"); // node-fetch@2 を使用

exports.handler = async function (event, context) {
    const APP_ID = "7951375894910515";
    const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3";
    const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;

    // ✅ クエリパラメータから `api_name` を取得（デフォルトは `HIGH_SCORE_ALL`）
    const params = new URLSearchParams(event.queryStringParameters);
    const apiName = params.get("api_name") || "HIGH_SCORE_ALL"; 

    const API_URL = `https://graph.oculus.com/leaderboard_entries?api_name=${apiName}&fields=rank,user{alias,display_name},score,timestamp&limit=100`;

    // ✅ タイムアウト設定（5秒でキャンセル）
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    // ✅ 上位 300 件に制限
    const MAX_ENTRIES = 300;

    async function fetchLimitedPages(url, results = []) {
        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout); // レスポンス成功ならタイマー解除
            const data = await response.json();

            if (!response.ok) {
                throw new Error(`APIエラー: ${data.error?.message || "不明なエラー"}`);
            }

            results.push(...data.data);

            // ✅ 300 件に達したら終了
            if (results.length >= MAX_ENTRIES) {
                return results.slice(0, MAX_ENTRIES);
            }

            // ✅ ページネーション制限（5ページまで）
            if (data.paging && data.paging.next && results.length < MAX_ENTRIES) {
                console.log("次のページのURL:", data.paging.next);
                return fetchLimitedPages(data.paging.next, results);
            } else {
                return results;
            }
        } catch (error) {
            throw new Error(`データ取得中にエラーが発生しました: ${error.message}`);
        }
    }

    try {
        // ✅ `api_name` を動的に変更
        const allData = await fetchLimitedPages(`${API_URL}&access_token=${ACCESS_TOKEN}`);

        console.log(`全データ取得完了 (${apiName}):`, allData.length);

        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*", // CORS 対応
                "Content-Type": "application/json"
            },
            body: JSON.stringify(allData),
        };
    } catch (error) {
        console.error("エラー詳細:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Failed to load data.", error: error.toString() }),
        };
    }
};
