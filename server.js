const express = require("express");
const fetch = require("node-fetch");
const app = express();

const APP_ID = "7951375894910515"; // あなたのアプリID
const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3"; // あなたのアプリシークレット
const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;
const API_URL = `https://graph.oculus.com/${APP_ID}/leaderboards?api_name=HIGH_SCORE&fields=entries{rank,user{name},score}`;

app.get("/leaderboard", async (req, res) => {
    try {
        const response = await fetch(`${API_URL}&access_token=${ACCESS_TOKEN}`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("APIリクエストエラー:", error);
        res.status(500).send("エラーが発生しました");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました`);
});
