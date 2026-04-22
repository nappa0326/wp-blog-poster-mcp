// get_post ツールの登録と実装。
// 指定 ID の投稿 1 件を取得する（本文の raw マークアップ込み）。読み取り専用で、ステータス制限はなし。

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WordPressClient } from "../wordpress.js";

const inputShape = {
  post_id: z
    .number()
    .int()
    .positive()
    .describe("取得対象の投稿 ID（必須）。公開済み / 下書き / その他を問わず、認証ユーザーの権限で読める投稿が対象。"),
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// LLM に返す文字列が爆発的に膨らむのを避けるため、本文の事前プレビューは truncate する。
// ただしツール経由では全文返す（文体把握のため）。ここは保険としての上限。
const CONTENT_MAX_CHARS = 80_000;

/**
 * get_post ツールを MCP サーバーに登録する。
 */
export function registerGetPostTool(
  server: McpServer,
  wp: WordPressClient,
): void {
  server.registerTool(
    "get_post",
    {
      title: "Get a single WordPress post with raw content",
      description:
        "投稿 ID を指定して 1 件の投稿を取得する。content は Gutenberg ブロックマーカー込みの生 HTML（context=edit の raw）を返す。" +
        "過去記事の文体・構造を Claude が参考にするための読み取り用ツール。ステータスは問わない（公開 / 下書き / 予約等すべて対象）。",
      inputSchema: inputShape,
    },
    async (args): Promise<ToolResult> => {
      try {
        const post = await wp.getPost(args.post_id);

        const contentShown =
          post.contentRaw.length > CONTENT_MAX_CHARS
            ? post.contentRaw.slice(0, CONTENT_MAX_CHARS) +
              `\n\n…（本文が ${CONTENT_MAX_CHARS} 文字を超えたため切り詰めました）`
            : post.contentRaw;

        const meta = [
          `投稿 ID ${post.id} を取得しました。`,
          `- タイトル: ${post.title}`,
          `- ステータス: ${post.status}`,
          `- 作成日時 (GMT): ${post.dateGmt || "不明"}`,
          `- 最終更新 (GMT): ${post.modifiedGmt || "不明"}`,
          `- カテゴリ ID: ${post.categories.length > 0 ? post.categories.join(", ") : "(なし)"}`,
          `- タグ ID: ${post.tags.length > 0 ? post.tags.join(", ") : "(なし)"}`,
          `- アイキャッチ画像 ID: ${post.featuredMedia || "(なし)"}`,
          `- 公開 URL: ${post.link || "(なし)"}`,
          `- 編集画面: ${post.editUrl}`,
        ].join("\n");

        const excerpt = post.excerptRaw
          ? `--- 抜粋 (raw) ---\n${post.excerptRaw}`
          : "--- 抜粋 ---\n(なし)";

        const body = `--- 本文 (content.raw) ---\n${contentShown}`;

        return {
          content: [
            { type: "text", text: [meta, "", excerpt, "", body].join("\n") },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `get_post が失敗しました: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
