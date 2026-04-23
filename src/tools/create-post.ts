// create_draft_post ツールの登録と実装。
// 入力は Zod で検証し、常に status: "draft" で投稿する。

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WordPressClient } from "../wordpress.js";

// 入力スキーマ（raw shape 形式）
const inputShape = {
  title: z
    .string()
    .min(1, "title は空にできません")
    .max(200, "title は 200 文字以内にしてください")
    .describe("記事タイトル（1〜200 文字）"),
  content: z
    .string()
    .min(1, "content は空にできません")
    .max(100_000, "content は 100000 文字以内にしてください")
    .describe(
      "本文（HTML または Gutenberg ブロック形式、1〜100000 文字）。" +
        "アーカイブ/トップページで「冒頭だけ表示＋続きを読むリンク」にしたい場合は、" +
        "冒頭パラグラフ（と任意の画像）の後に Gutenberg の more ブロックを挿入する慣習が広く使われる:\n" +
        "<!-- wp:more --><!--more--><!-- /wp:more -->\n" +
        "このマーカーが無い場合、テーマ側の the_excerpt() 挙動に依存する（通常は先頭 55 単語の自動抜粋）。",
    ),
  excerpt: z
    .string()
    .max(1000, "excerpt は 1000 文字以内にしてください")
    .optional()
    .describe("抜粋（任意）"),
  categories: z
    .array(z.number().int().positive())
    .max(20, "categories は 20 個まで")
    .optional()
    .describe("カテゴリ ID の配列（任意）"),
  category_names: z
    .array(
      z
        .string()
        .min(1)
        .max(50, "各カテゴリ名は 50 文字以内にしてください"),
    )
    .max(20, "category_names は 20 個まで")
    .optional()
    .describe(
      "カテゴリ名の配列（任意、存在しなければ root 配下に新規作成される）。categories と併用可、union マージされる。",
    ),
  tags: z
    .array(
      z
        .string()
        .min(1)
        .max(20, "各タグは 20 文字以内にしてください"),
    )
    .max(20, "tags は 20 個まで")
    .optional()
    .describe("タグ名の配列（存在しなければ作成される）"),
  featured_media_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "アイキャッチ画像のメディア ID（任意、upload_media の返り値 id を渡す）",
    ),
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * create_draft_post ツールを MCP サーバーに登録する。
 */
export function registerCreatePostTool(
  server: McpServer,
  wp: WordPressClient,
): void {
  server.registerTool(
    "create_draft_post",
    {
      title: "Create WordPress draft post",
      description:
        "WordPress に下書き記事を 1 件作成する。status は常に draft 固定で、公開は人間が管理画面で行う運用を強制する。",
      inputSchema: inputShape,
    },
    async (args): Promise<ToolResult> => {
      try {
        // タグ名 → タグ ID 解決（指定されたときのみ）
        let tagIds: number[] | undefined;
        if (args.tags && args.tags.length > 0) {
          tagIds = await wp.resolveTagIds(args.tags);
        }

        const post = await wp.createDraftPost({
          title: args.title,
          content: args.content,
          excerpt: args.excerpt,
          categories: args.categories,
          categoryNames: args.category_names,
          tags: tagIds,
          featuredMedia: args.featured_media_id,
        });

        const lines = [
          `下書きを作成しました。`,
          `- 投稿 ID: ${post.id}`,
          `- ステータス: ${post.status}`,
          `- 編集画面: ${post.editUrl}`,
          `- プレビュー: ${post.previewUrl}`,
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
              text: `create_draft_post が失敗しました: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
