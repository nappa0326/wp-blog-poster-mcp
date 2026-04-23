// list_tags ツールの登録と実装。
// 既存タグの一覧を軽量フィールドで返す。重複タグ作成を避けるための参照用。

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WordPressClient } from "../wordpress.js";

const inputShape = {
  limit: z
    .number()
    .int()
    .min(1, "limit は 1 以上")
    .max(100, "limit は 100 以下")
    .optional()
    .describe("取得件数の上限（任意、1〜100、既定 50）"),
  offset: z
    .number()
    .int()
    .min(0, "offset は 0 以上")
    .optional()
    .describe("スキップする件数（任意、既定 0）"),
  orderby: z
    .enum(["count", "name", "id"])
    .optional()
    .describe("並び替え基準（任意、既定 count）"),
  order: z
    .enum(["asc", "desc"])
    .optional()
    .describe("並び順（任意、既定 desc = 使用数が多い順）"),
  search: z
    .string()
    .min(1, "search は空にできません")
    .max(200, "search は 200 文字以内")
    .optional()
    .describe("タグ名に対するキーワード検索（任意）"),
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * list_tags ツールを MCP サーバーに登録する。
 */
export function registerListTagsTool(
  server: McpServer,
  wp: WordPressClient,
): void {
  server.registerTool(
    "list_tags",
    {
      title: "List WordPress tags",
      description:
        "タグの一覧を返す（既定: 使用数の多い順）。" +
        "既存タグを Claude が把握した上で create_draft_post / update_post の tags にタグ名を渡すための参照用。" +
        "重複した意味のタグ作成を避けることが目的。",
      inputSchema: inputShape,
    },
    async (args): Promise<ToolResult> => {
      try {
        const limit = args.limit ?? 50;
        const offset = args.offset ?? 0;
        const orderBy = args.orderby ?? "count";
        const order = args.order ?? "desc";

        const tags = await wp.listTags({
          limit,
          offset,
          orderBy,
          order,
          search: args.search,
        });

        if (tags.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `タグは見つかりませんでした（limit=${limit}, offset=${offset}${args.search ? `, search="${args.search}"` : ""}）。`,
              },
            ],
          };
        }

        const header = `タグ ${tags.length} 件（orderby=${orderBy} ${order}${args.search ? `, search="${args.search}"` : ""}）:`;
        const lines = tags.map((t) => {
          const descShown = t.description
            ? ` / 説明: ${t.description.slice(0, 80)}`
            : "";
          return `- [${t.id}] ${t.name} (slug=${t.slug}, 使用数=${t.count})${descShown}`;
        });

        return {
          content: [{ type: "text", text: [header, ...lines].join("\n") }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `list_tags が失敗しました: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
