// list_drafts ツールの登録と実装。
// 現在の認証ユーザー（claude-poster 等）の下書き投稿一覧を返す。

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WordPressClient } from "../wordpress.js";

// 入力スキーマ（raw shape 形式）
const inputShape = {
  limit: z
    .number()
    .int()
    .min(1, "limit は 1 以上")
    .max(50, "limit は 50 以下")
    .optional()
    .describe("取得件数の上限（任意、1〜50、既定 20）"),
  offset: z
    .number()
    .int()
    .min(0, "offset は 0 以上")
    .optional()
    .describe("スキップする件数（任意、既定 0）"),
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * list_drafts ツールを MCP サーバーに登録する。
 */
export function registerListDraftsTool(
  server: McpServer,
  wp: WordPressClient,
): void {
  server.registerTool(
    "list_drafts",
    {
      title: "List WordPress drafts for the current user",
      description:
        "認証中のユーザーが所有する下書き投稿の一覧を返す（更新日時の降順）。" +
        "各エントリには投稿 ID / タイトル / 最終更新 (GMT) / リンク / 編集画面 URL を含む。" +
        "update_post で更新したい投稿の ID を特定する用途を想定。",
      inputSchema: inputShape,
    },
    async (args): Promise<ToolResult> => {
      try {
        const limit = args.limit ?? 20;
        const offset = args.offset ?? 0;

        const drafts = await wp.listDrafts({ limit, offset });

        if (drafts.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `下書きは見つかりませんでした（limit=${limit}, offset=${offset}）。`,
              },
            ],
          };
        }

        const header = `下書き ${drafts.length} 件（limit=${limit}, offset=${offset}、更新日時の降順）:`;
        const lines = drafts.map((d) => {
          const titleShown = d.title.length > 0 ? d.title : "(無題)";
          return [
            `- [${d.id}] ${titleShown}`,
            `    最終更新 (GMT): ${d.modifiedGmt || "不明"}`,
            `    編集: ${d.editUrl}`,
          ].join("\n");
        });

        return {
          content: [
            { type: "text", text: [header, ...lines].join("\n") },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `list_drafts が失敗しました: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
