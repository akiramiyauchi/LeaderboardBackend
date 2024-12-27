const fetch = require("node-fetch"); // node-fetch@2 を使用

exports.handler = async function (event, context) {
    const APP_ID = "7951375894910515"; // あなたのAPP_ID
    const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3"; // あなたのAPP_SECRET
    const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;
    const API_URL = `https://graph.oculus.com/leaderboard_entries?api_name=HIGH_SCORE&fields=rank,user{alias},score`;

    async function fetchAllPages(url, results = []) {
        try {
            const response = await fetch(`${url}&access_token=${ACCESS_TOKEN}`);
            const data = await response.json();

            // 現在のページのデータを結果に追加
            results.push(...data.data);

            // `paging.next` が存在すれば次のページを取得
            if (data.paging && data.paging.next) {
                return fetchAllPages(data.paging.next, results);
            } else {
                // すべてのページを取得し終えた場合
                return results;
            }
        } catch (error) {
            throw new Error(`データ取得中にエラーが発生しました: ${error.toString()}`);
        }
    }

    try {
        // 全ページのデータを取得
        const allData = await fetchAllPages(API_URL);

        console.log("全データ取得完了:", allData);

        // 成功時のレスポンス
        return {
            statusCode: 200,
            body: JSON.stringify(allData),
        };
    } catch (error) {
        // エラー時のレスポンス
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "エラーが発生しました", error: error.toString() }),
        };
    }
};
