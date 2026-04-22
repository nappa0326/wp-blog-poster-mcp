// 環境変数の読み込みと検証を行うモジュール。
// 必須変数が欠けている場合や HTTPS 以外の URL が指定された場合は起動時点で終了する。

export interface AppConfig {
  apiUrl: string; // 末尾スラッシュなしに正規化されたベース URL
  username: string;
  appPassword: string;
}

/**
 * 環境変数から設定を読み込み、検証する。
 * 致命的な不備があれば stderr にメッセージを出力して process.exit(1) で終了する。
 */
export function loadConfig(): AppConfig {
  const rawUrl = process.env.WP_API_URL ?? "";
  const username = process.env.WP_USERNAME ?? "";
  const appPassword = process.env.WP_APP_PASSWORD ?? "";

  const missing: string[] = [];
  if (!rawUrl) missing.push("WP_API_URL");
  if (!username) missing.push("WP_USERNAME");
  if (!appPassword) missing.push("WP_APP_PASSWORD");
  if (missing.length > 0) {
    console.error(
      `[wp-blog-poster] 必須の環境変数が未設定です: ${missing.join(", ")}`,
    );
    process.exit(1);
  }

  // HTTPS 必須ガード（平文送信防止）
  if (!/^https:\/\//i.test(rawUrl)) {
    console.error(
      `[wp-blog-poster] WP_API_URL は https:// で始まる必要があります: ${rawUrl}`,
    );
    process.exit(1);
  }

  // 末尾スラッシュを除去（クエリ組み立て時の `//` 回避）
  const apiUrl = rawUrl.replace(/\/+$/, "");

  return { apiUrl, username, appPassword };
}
