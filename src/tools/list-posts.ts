// list_posts ツールの登録と実装。
// 投稿の探索用（本文は含めない軽量一覧）。既定は公開済み記事の新しい順。

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WordPressClient } from "../wordpress.js";

const inputShape = {
  status: z
    .enum(["publish", "draft", "pending", "private", "future", "any"])
    .optional()
    .describe("ステータスフィルタ（任意、既定 publish）"),
  per_page: z
    .number()
    .int()
    .min(1, "per_page は 1 以上")
    .max(50, "per_page は 50 以下")
    .optional()
    .describe("取得件数の上限（任意、1〜50、既定 10）"),
  offset: z
    .number()
    .int()
    .min(0, "offset は 0 以上")
    .optional()
    .describe("スキップする件数（任意、既定 0）"),
  search: z
    .string()
    .min(1, "search は空にできません")
    .max(200, "search は 200 文字以内")
    .optional()
    .describe("タイトル / 本文に対するキーワード検索（任意）"),
  orderby: z
    .enum(["date", "modified", "title"])
    .optional()
    .describe("並び替え基準（任意、既定 date）"),
  order: z
    .enum(["asc", "desc"])
    .optional()
    .describe("並び順（任意、既定 desc = 新しい順）"),
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// excerpt は一覧表示のみの概要。長すぎる場合は切り詰める。
const EXCERPT_PREVIEW_CHARS = 200;

/**
 * list_posts ツールを MCP サーバーに登録する。
 */
export function registerListPostsTool(
  server: McpServer,
  wp: WordPressClient,
): void {
  server.registerTool(
    "list_posts",
    {
      title: "List WordPress posts for discovery",
      description:
        "投稿の一覧を返す（既定: 公開済みの新しい順、本文は含めない）。過去記事の探索用で、ヒットした投稿 ID を get_post に渡すことで全文を取得する 2 段階フローを想定。" +
        "search でキーワード検索、status で下書き / 公開等のフィルタ、orderby で並び替えが可能。",
      inputSchema: inputShape,
    },
    async (args): Promise<ToolResult> => {
      try {
        const status = args.status ?? "publish";
        const perPage = args.per_page ?? 10;
        const offset = args.offset ?? 0;
        const orderBy = args.orderby ?? "date";
        const order = args.order ?? "desc";

        const posts = await wp.listPosts({
          status,
          perPage,
          offset,
          search: args.search,
          orderBy,
          order,
        });

        if (posts.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `投稿は見つかりませんでした（status=${status}, per_page=${perPage}, offset=${offset}${args.search ? `, search="${args.search}"` : ""}）。`,
              },
            ],
          };
        }

        const header = `投稿 ${posts.length} 件（status=${status}, per_page=${perPage}, offset=${offset}, orderby=${orderBy} ${order}${args.search ? `, search="${args.search}"` : ""}）:`;
        const lines = posts.map((p) => {
          const titleShown = p.title.length > 0 ? p.title : "(無題)";
          const excerptStripped = stripHtml(p.excerpt).trim();
          const excerptShown =
            excerptStripped.length > EXCERPT_PREVIEW_CHARS
              ? excerptStripped.slice(0, EXCERPT_PREVIEW_CHARS) + "…"
              : excerptStripped;
          return [
            `- [${p.id}] ${titleShown}`,
            `    ステータス: ${p.status} / 作成 (GMT): ${p.dateGmt || "不明"} / 最終更新 (GMT): ${p.modifiedGmt || "不明"}`,
            `    抜粋: ${excerptShown || "(なし)"}`,
            `    URL: ${p.link || "(なし)"}`,
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
              text: `list_posts が失敗しました: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

/**
 * 一覧 excerpt 向けに最低限の HTML タグ除去。<p> 等を落としてプレビューを見やすくする。
 * LLM 呼出側が完全に信頼するものではないが、表示用として十分。
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
}
