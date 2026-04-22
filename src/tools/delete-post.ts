// delete_draft_post ツールの登録と実装。
// 対象は status=draft の投稿のみ。既定はゴミ箱送りで、force_delete=true のとき完全削除。

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WordPressClient } from "../wordpress.js";

// 入力スキーマ（raw shape 形式）
const inputShape = {
  post_id: z
    .number()
    .int()
    .positive()
    .describe("削除対象の投稿 ID（必須）。対象は status=draft の投稿のみ。"),
  force_delete: z
    .boolean()
    .optional()
    .describe(
      "true のとき完全削除する（復元不可）。既定は false（ゴミ箱送り）。" +
        "ゴミ箱送りであれば WordPress 管理画面から復元できる。",
    ),
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * delete_draft_post ツールを MCP サーバーに登録する。
 */
export function registerDeletePostTool(
  server: McpServer,
  wp: WordPressClient,
): void {
  server.registerTool(
    "delete_draft_post",
    {
      title: "Delete a WordPress draft post",
      description:
        "下書き投稿を削除する。対象は status=draft の投稿のみで、公開済み記事はエラーになる。" +
        "既定 (force_delete=false) ではゴミ箱送り (status=trash) で、管理画面から復元可能。" +
        "force_delete=true の場合は完全削除（復元不可）。",
      inputSchema: inputShape,
    },
    async (args): Promise<ToolResult> => {
      try {
        const force = args.force_delete === true;
        const result = await wp.deleteDraftPost({
          id: args.post_id,
          forceDelete: force,
        });

        const lines =
          result.finalStatus === "deleted"
            ? [
                `投稿 ID ${result.id} を完全削除しました（復元不可）。`,
                `- 削除前ステータス: ${result.previousStatus}`,
              ]
            : [
                `投稿 ID ${result.id} をゴミ箱に移動しました。`,
                `- 削除前ステータス: ${result.previousStatus}`,
                `- 現在ステータス: ${result.finalStatus}`,
                `- 復元: WordPress 管理画面の「ゴミ箱」から可能`,
              ];
        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `delete_draft_post が失敗しました: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
