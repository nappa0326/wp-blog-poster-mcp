// update_post ツールの登録と実装。
// 既存の下書き投稿（status: draft）のみを部分更新する。公開済み記事はエラーで弾く。

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WordPressClient } from "../wordpress.js";

// 入力スキーマ（raw shape 形式）
const inputShape = {
  post_id: z
    .number()
    .int()
    .positive()
    .describe("更新対象の投稿 ID（必須）。対象は status=draft の投稿のみ。"),
  title: z
    .string()
    .min(1, "title は空にできません")
    .max(200, "title は 200 文字以内にしてください")
    .optional()
    .describe("記事タイトル（任意、未指定なら現在値を保持）"),
  content: z
    .string()
    .min(1, "content は空にできません")
    .max(100_000, "content は 100000 文字以内にしてください")
    .optional()
    .describe(
      "本文（任意、未指定なら現在値を保持）。" +
        "アーカイブ表示で「続きを読む」にしたい場合は冒頭パラグラフの後に " +
        "<!-- wp:more --><!--more--><!-- /wp:more --> を入れる慣習を踏襲すること。",
    ),
  excerpt: z
    .string()
    .max(1000, "excerpt は 1000 文字以内にしてください")
    .optional()
    .describe("抜粋（任意、未指定なら現在値を保持）"),
  categories: z
    .array(z.number().int().positive())
    .max(20, "categories は 20 個まで")
    .optional()
    .describe("カテゴリ ID の配列（任意、指定時は現在値を上書き）"),
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
      "カテゴリ名の配列（任意、存在しなければ root 配下に新規作成される）。categories と併用可、union マージして現在値を上書き。",
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
    .describe(
      "タグ名の配列（任意、指定時は現在値を上書き。存在しないタグは自動作成される）",
    ),
  featured_media_id: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "アイキャッチ画像のメディア ID（任意、0 を指定すると解除）",
    ),
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * update_post ツールを MCP サーバーに登録する。
 */
export function registerUpdatePostTool(
  server: McpServer,
  wp: WordPressClient,
): void {
  server.registerTool(
    "update_post",
    {
      title: "Update WordPress draft post",
      description:
        "既存の下書き投稿を部分更新する。対象は status=draft の投稿のみで、公開済み記事はエラーになる。" +
        "指定したフィールドのみ上書きされ、未指定フィールドは現在値が保持される。",
      inputSchema: inputShape,
    },
    async (args): Promise<ToolResult> => {
      try {
        // 少なくとも 1 つは更新対象フィールドが指定されていること
        const hasAnyField =
          args.title !== undefined ||
          args.content !== undefined ||
          args.excerpt !== undefined ||
          args.categories !== undefined ||
          args.category_names !== undefined ||
          args.tags !== undefined ||
          args.featured_media_id !== undefined;
        if (!hasAnyField) {
          throw new Error(
            "更新するフィールドが指定されていません。title/content/excerpt/categories/category_names/tags/featured_media_id のいずれかを指定してください。",
          );
        }

        // タグ名 → タグ ID 解決（指定されたときのみ）
        let tagIds: number[] | undefined;
        if (args.tags !== undefined) {
          tagIds = args.tags.length > 0 ? await wp.resolveTagIds(args.tags) : [];
        }

        const post = await wp.updateDraftPost({
          id: args.post_id,
          title: args.title,
          content: args.content,
          excerpt: args.excerpt,
          categories: args.categories,
          categoryNames: args.category_names,
          tags: tagIds,
          featuredMedia: args.featured_media_id,
        });

        const lines = [
          `下書きを更新しました。`,
          `- 投稿 ID: ${post.id}`,
          `- ステータス: ${post.status}`,
          `- 最終更新 (GMT): ${post.modifiedGmt}`,
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
              text: `update_post が失敗しました: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
