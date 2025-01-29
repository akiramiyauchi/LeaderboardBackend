const fetch = require("node-fetch"); // node-fetch@2 を使用

exports.handler = async function (event, context) {
    const APP_ID = "7951375894910515";
    const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3";
    const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;

    // ✅ クエリパラメータから `api_name` を取得（デフォルトは `HIGH_SCORE_ALL`）
    const params = new URLSearchParams(event.queryStringParameters);
    const apiName = params.get("api_name") || "HIGH_SCORE_ALL"; 

    const API_URL = `https://graph.oculus.com/leaderboard_entries?api_name=${apiName}&fields=rank,user{alias,display_name},score,timestamp`;

    // 全ページを取得する関数
    async function fetchAllPages(url, results = []) {
        try {
            const response = await fetch(url);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(`APIエラー: ${data.error?.message || "不明なエラー"}`);
            }

            results.push(...data.data);

            if (data.paging && data.paging.next) {
                console.log("次のページのURL:", data.paging.next);
                return fetchAllPages(data.paging.next, results);
            } else {
                return results;
            }
        } catch (error) {
            throw new Error(`データ取得中にエラーが発生しました: ${error.message}`);
        }
    }

    try {
        // ✅ `api_name` を動的に変更
        const allData = await fetchAllPages(`${API_URL}&access_token=${ACCESS_TOKEN}`);

        console.log(`全データ取得完了 (${apiName}):`, allData);

        return {
            statusCode: 200,
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
