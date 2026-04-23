// list_categories ツールの登録と実装。
// 既存カテゴリの一覧を軽量フィールドで返す。Claude が既存分類体系を把握して
// create_draft_post / update_post に category_names を渡す前の参照用。

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
    .describe("カテゴリ名に対するキーワード検索（任意）"),
  parent: z
    .number()
    .int()
    .min(0, "parent は 0 以上")
    .optional()
    .describe(
      "親カテゴリ ID でフィルタ（任意、0 指定で root のみ、未指定で全階層）",
    ),
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * list_categories ツールを MCP サーバーに登録する。
 */
export function registerListCategoriesTool(
  server: McpServer,
  wp: WordPressClient,
): void {
  server.registerTool(
    "list_categories",
    {
      title: "List WordPress categories",
      description:
        "カテゴリの一覧を返す（既定: 使用数の多い順）。" +
        "既存の分類体系を Claude が把握した上で create_draft_post / update_post の category_names または categories を指定するための参照用。" +
        "parent=0 で root のみ、parent 指定で特定カテゴリの子だけを取れる。",
      inputSchema: inputShape,
    },
    async (args): Promise<ToolResult> => {
      try {
        const limit = args.limit ?? 50;
        const offset = args.offset ?? 0;
        const orderBy = args.orderby ?? "count";
        const order = args.order ?? "desc";

        const cats = await wp.listCategories({
          limit,
          offset,
          orderBy,
          order,
          search: args.search,
          parent: args.parent,
        });

        if (cats.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `カテゴリは見つかりませんでした（limit=${limit}, offset=${offset}${args.search ? `, search="${args.search}"` : ""}${args.parent !== undefined ? `, parent=${args.parent}` : ""}）。`,
              },
            ],
          };
        }

        const header = `カテゴリ ${cats.length} 件（orderby=${orderBy} ${order}${args.search ? `, search="${args.search}"` : ""}${args.parent !== undefined ? `, parent=${args.parent}` : ""}）:`;
        const lines = cats.map((c) => {
          const parentLabel = c.parent === 0 ? "root" : `parent=${c.parent}`;
          const descShown = c.description
            ? ` / 説明: ${c.description.slice(0, 80)}`
            : "";
          return `- [${c.id}] ${c.name} (slug=${c.slug}, ${parentLabel}, 使用数=${c.count})${descShown}`;
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
              text: `list_categories が失敗しました: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
