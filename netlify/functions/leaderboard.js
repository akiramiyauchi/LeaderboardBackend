const fetch = require("node-fetch"); // node-fetch@2 を使用

exports.handler = async function (event, context) {
    const APP_ID = "7951375894910515"; // あなたのAPP_ID
    const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3"; // あなたのAPP_SECRET
    const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;
    const API_URL = `https://graph.oculus.com/leaderboard_entries?api_name=HIGH_SCORE&fields=rank,user{id},score`;

    try {
        // APIリクエスト
        const response = await fetch(`${API_URL}&access_token=${ACCESS_TOKEN}`);
        const data = await response.json();
        console.log("API Response:", data); // レスポンス全体をログに表示
        
        // 成功時のレスポンス
        return {
            statusCode: 200,
            body: JSON.stringify(data),
        };
    } catch (error) {
        // エラー時のレスポンス
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "エラーが発生しました", error: error.toString() }),
        };
    }
};
