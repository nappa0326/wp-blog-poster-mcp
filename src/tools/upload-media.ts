// upload_media ツールの登録と実装。
// 画像を file_path（ローカル絶対パス）または file_base64 で受け取り、
// WordPress メディアライブラリにアップロードする。
// SVG は安全上デフォルト禁止のため受け付けない（PNG/JPEG/GIF/WebP のみ）。

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WordPressClient } from "../wordpress.js";

// 許可する拡張子と対応する MIME。
// WordPress 側の mime 判定は拡張子ベースなので、拡張子ごとに正規 MIME を固定する。
const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

// 受信可能な base64 文字列長の上限（バイト長に対して約 4/3 倍）。
// 実バイナリで約 21MB まで許容。サーバー側 php.ini は upload_max_filesize=2048M なので
// ここは MCP 転送層での現実的な上限として設ける。
const MAX_BASE64_LEN = 28_000_000;

// file_path 経由のファイルサイズ上限（Buffer bytes）。
// 既存 MAX_BASE64_LEN=28_000_000 の実バイナリ相当（base64 4 文字 ≒ 3 バイト）。
const MAX_FILE_BYTES = 21_000_000;

const inputShape = {
  filename: z
    .string()
    .min(1, "filename は空にできません")
    .max(255, "filename は 255 文字以内にしてください")
    .regex(
      /\.(png|jpe?g|gif|webp)$/i,
      "filename は .png/.jpg/.jpeg/.gif/.webp のいずれかで終わる必要があります",
    )
    .describe("アップロードするファイル名（拡張子必須）"),
  file_path: z
    .string()
    .min(1, "file_path は空にできません")
    .optional()
    .describe(
      "アップロードする画像の絶対パス（推奨）。MCP サーバーが直接ファイルを読み込むため、base64 化による JSON-RPC 経由の大容量転送を回避できる。file_path と file_base64 のいずれか一方を必ず指定する。",
    ),
  file_base64: z
    .string()
    .min(1, "file_base64 は空にできません")
    .max(MAX_BASE64_LEN, "file_base64 が大きすぎます（約21MBまで）")
    .optional()
    .describe(
      "ファイル本体を base64 エンコードした文字列。小さな画像向け・既存互換用途。file_path と file_base64 のいずれか一方を必ず指定する。",
    ),
  alt_text: z
    .string()
    .max(500, "alt_text は 500 文字以内にしてください")
    .optional()
    .describe("代替テキスト（任意、アクセシビリティと SEO のため推奨）"),
  caption: z
    .string()
    .max(1000, "caption は 1000 文字以内にしてください")
    .optional()
    .describe("キャプション（任意）"),
  title: z
    .string()
    .max(200, "title は 200 文字以内にしてください")
    .optional()
    .describe("メディアタイトル（任意、未指定時はファイル名由来）"),
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * upload_media ツールを MCP サーバーに登録する。
 */
export function registerUploadMediaTool(
  server: McpServer,
  wp: WordPressClient,
): void {
  server.registerTool(
    "upload_media",
    {
      title: "Upload image to WordPress media library",
      description:
        "画像（PNG/JPEG/GIF/WebP）をメディアライブラリにアップロードする。返り値の media_id と source_url を使って、create_draft_post の featured_media_id 指定や本文中の <img> 埋め込みに使用する。",
      inputSchema: inputShape,
    },
    async (args): Promise<ToolResult> => {
      try {
        // 拡張子から MIME を決定（Zod で保証済みなので必ず hit する）
        const extMatch = args.filename.match(/\.([a-zA-Z0-9]+)$/);
        const ext = (extMatch?.[1] ?? "").toLowerCase();
        const mimeType = EXT_TO_MIME[ext];
        if (!mimeType) {
          throw new Error(`未対応の拡張子です: .${ext}`);
        }

        // 入力経路の exactly-one 判定（file_path / file_base64 のいずれか一方）
        const hasFilePath =
          typeof args.file_path === "string" && args.file_path.length > 0;
        const hasFileBase64 =
          typeof args.file_base64 === "string" && args.file_base64.length > 0;
        if (hasFilePath && hasFileBase64) {
          throw new Error(
            "file_path と file_base64 は同時に指定できません（どちらか一方を指定してください）",
          );
        }
        if (!hasFilePath && !hasFileBase64) {
          throw new Error(
            "file_path または file_base64 のいずれかを指定してください",
          );
        }

        // バイト列を取得
        let bytes: Buffer;
        if (hasFilePath) {
          const filePath = args.file_path as string;
          // 絶対パス強制（MCP プロセスの cwd に依存した相対パス混入を防ぐ）
          if (!path.isAbsolute(filePath)) {
            throw new Error(
              `file_path は絶対パスで指定してください: ${filePath}`,
            );
          }
          try {
            bytes = await fs.readFile(filePath);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(
              `file_path の読み込みに失敗しました: ${filePath} (${msg})`,
            );
          }
          if (bytes.length === 0) {
            throw new Error(`file_path のファイルが空です: ${filePath}`);
          }
          if (bytes.length > MAX_FILE_BYTES) {
            throw new Error(
              `ファイルサイズが上限を超えています: ${bytes.length} bytes > ${MAX_FILE_BYTES} bytes`,
            );
          }
        } else {
          // file_base64 経路（従来通り、無効な文字列は早期検知）
          try {
            bytes = Buffer.from(args.file_base64 as string, "base64");
          } catch {
            throw new Error("file_base64 が有効な base64 文字列ではありません");
          }
          if (bytes.length === 0) {
            throw new Error("file_base64 のデコード結果が 0 バイトでした");
          }
        }

        const uploaded = await wp.uploadMedia({
          filename: args.filename,
          bytes,
          mimeType,
          altText: args.alt_text,
          caption: args.caption,
          title: args.title,
        });

        const lines = [
          `メディアをアップロードしました。`,
          `- メディア ID: ${uploaded.id}`,
          `- MIME: ${uploaded.mimeType}`,
          `- URL: ${uploaded.sourceUrl}`,
          `- 編集画面: ${uploaded.editUrl}`,
          ``,
          `本文に埋め込む場合の例:`,
          `<img src="${uploaded.sourceUrl}" alt="${escapeAttr(uploaded.altText)}" class="wp-image-${uploaded.id}" />`,
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
              text: `upload_media が失敗しました: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

/**
 * HTML 属性値に挿入するための最低限のエスケープ。
 * ここは LLM に例示する文字列なので、ガイド用途に留める。
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
