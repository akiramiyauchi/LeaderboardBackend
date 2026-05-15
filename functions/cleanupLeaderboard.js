console.log("==== Cleanup Leaderboard Scheduled Launcher Loaded ====");

// Scheduled Function launcher
// 実際の重い処理は cleanupLeaderboard-background.js に任せる
exports.handler = async function (event, context) {
  console.log("==== Start Cleanup Leaderboard Launcher ====");

  try {
    // Netlify本番URL
    // process.env.URL は Netlify が自動で入れるサイトURL
    const siteUrl = process.env.URL || `https://${event.headers.host}`;

    const backgroundUrl =
      `${siteUrl}/.netlify/functions/cleanupLeaderboard-background`;

    console.log("🚀 Invoking background function:", backgroundUrl);

    const headers = {
      "content-type": "application/json",
    };

    // CLEANUP_SECRET を設定している場合だけ、background側へ渡す
    if (process.env.CLEANUP_SECRET) {
      headers["x-cleanup-secret"] = process.env.CLEANUP_SECRET;
    }

    const response = await fetch(backgroundUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "scheduled",
        startedAt: new Date().toISOString(),
      }),
    });

    const text = await response.text();

    console.log(
      `✅ Background invoke response status=${response.status} body=${text.slice(0, 300)}`
    );

    // Background Function は正常起動なら 202 を返すことが多い
    const ok = response.ok || response.status === 202;

    return {
      statusCode: ok ? 202 : 500,
      body: JSON.stringify(
        {
          message: ok
            ? "cleanupLeaderboard background invoked"
            : "failed to invoke cleanupLeaderboard background",
          backgroundStatus: response.status,
          backgroundBody: text.slice(0, 300),
        },
        null,
        2
      ),
    };
  } catch (error) {
    console.error("❌ Failed to invoke background function:", error);

    return {
      statusCode: 500,
      body: JSON.stringify(
        {
          message: "failed to invoke cleanupLeaderboard background",
          error: error.message,
        },
        null,
        2
      ),
    };
  }
};
