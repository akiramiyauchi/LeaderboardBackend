import axios from "axios";

export async function handler(event, context) {
    const APP_ID = "7951375894910515";
    const APP_SECRET = "a7fa72a764bb60aa20513e272fceeee3";
    const ACCESS_TOKEN = `OC|${APP_ID}|${APP_SECRET}`;
    const API_URL = `https://graph.oculus.com/${APP_ID}/leaderboards?api_name=HIGH_SCORE&fields=entries{rank,user{name},score}`;

    try {
        const response = await axios.get(`${API_URL}&access_token=${ACCESS_TOKEN}`);
        const data = response.data; // axiosではレスポンスデータはdataプロパティに格納されます。
        return {
            statusCode: 200,
            body: JSON.stringify(data),
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "エラーが発生しました", error: error.toString() }),
        };
    }
}
