# wp-blog-poster-mcp

> Language: **日本語** / [English](./README.md)

WordPress の REST API を叩いて下書き記事を作成・編集し、画像を添えるためのローカル MCP サーバー。Claude Desktop / Claude Code から自然言語で画像付きの記事下書きを作成する用途を想定している。

## 提供ツール

- `create_draft_post`: 下書き記事 1 件を作成する。常に `status: "draft"` 固定。アイキャッチ画像のメディア ID (`featured_media_id`) を指定可能。タグはタグ名、カテゴリは ID（`categories`）またはカテゴリ名（`category_names`）で指定でき、名前指定側は存在しなければ自動作成される（カテゴリは root 配下固定）。
- `upload_media`: 画像（PNG/JPEG/GIF/WebP）をメディアライブラリにアップロードする。base64 で受け取り、`alt_text` / `caption` / `title` を設定できる。返り値に `<img>` 埋込のテンプレート文字列を含む。
- `update_post`: 既存の **下書き** 投稿を部分更新する。対象が `draft` 以外（`publish` など）の場合はエラーで弾き、誤って公開済み記事を書き換えることを防ぐ。`title` / `content` / `excerpt` / `categories` / `category_names` / `tags` / `featured_media_id` のうち指定したフィールドのみ上書きされ、未指定は現在値を保持する。
- `list_drafts`: 現在の認証ユーザーが所有する **下書き** 投稿の一覧を、更新日時の降順で返す（既定 20 件）。`update_post` / `delete_draft_post` で対象の投稿 ID を特定する用途を想定。
- `delete_draft_post`: 下書き投稿を削除する。既定（`force_delete=false`）では **ゴミ箱送り**（`status=trash`）で管理画面から復元可能。`force_delete=true` で完全削除（復元不可）。対象が `draft` 以外の場合はエラーで弾く。
- `get_post`: 投稿 ID を指定して 1 件取得する。本文は Gutenberg ブロックマーカー込みの **raw**（`context=edit`）を返すため、Claude が過去記事の文体・構造を参考にして新記事を書くのに適している。読み取り専用でステータス制限なし。
- `list_posts`: 投稿の探索用一覧（既定は公開記事の新しい順）。本文は含まず ID / タイトル / 抜粋 / ステータス / 日付を返す軽量形式。気になる投稿の ID を `get_post` に渡す 2 段階フローを想定。
- `list_categories`: カテゴリの一覧を返す（既定は使用数の多い順）。既存の分類体系を Claude が把握した上で `create_draft_post` / `update_post` の `categories` または `category_names` を指定するための参照用。`parent=0` で root のみ、`parent=<id>` で特定カテゴリの子のみに絞り込める。
- `list_tags`: タグの一覧を返す（既定は使用数の多い順）。重複した意味のタグ作成を避けるため、投稿前に既存タグを Claude に把握させる用途を想定。

## 前提条件

- Node.js 22 以上
- Claude Desktop または Claude Code（どちらも STDIO トランスポート経由で接続）
- WordPress 5.6+ （Application Password 機能が組み込みで使える）

## WordPress 側の準備

1. 管理画面 → ユーザー → 新規追加で専用ユーザーを作成する。
   - ユーザー名例: `claude-poster`
   - 権限グループ: **編集者（Editor）** 推奨（タグ自動作成のため）
   - Administrator は使わない
2. 作成したユーザーのプロフィール画面下部「アプリケーションパスワード」で新規発行する。
   - 名前例: `claude-desktop-mcp`
   - 表示されたパスワードは一度しか見えないので控える（スペース込み）
3. `https://{your-domain}/wp-json/wp/v2/posts` または `https://{your-domain}/?rest_route=/wp/v2/posts` をブラウザで開き、JSON が返ることを確認する。
   - 返らない場合はセキュリティプラグインのブロック、またはパーマリンク設定の問題を疑う
4. Basic 認証の `Authorization` ヘッダーが PHP に届かない環境（CGI/FCGI など）では、サイトルートの `.htaccess` に以下を追記する:
   ```
   SetEnvIf Authorization "(.+)" HTTP_AUTHORIZATION=$1
   ```

## インストール・ビルド

```powershell
npm install
npm run build
```

## ローカル動作確認（MCP Inspector）

```powershell
npm run inspector
```

ブラウザで MCP Inspector が開くので、ツールを選んで適当な入力で実行する。

## Claude Desktop への登録

`%APPDATA%\Claude\claude_desktop_config.json` を編集:

```json
{
  "mcpServers": {
    "wp-blog-poster": {
      "command": "node",
      "args": ["C:\\path\\to\\wp-blog-poster-mcp\\build\\index.js"],
      "env": {
        "WP_API_URL": "https://your-domain.com",
        "WP_USERNAME": "claude-poster",
        "WP_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx"
      }
    }
  }
}
```

Claude Desktop は **タスクトレイから完全終了** してから再起動する（ウィンドウを閉じるだけでは不十分）。

## Claude Code への登録

`%USERPROFILE%\.claude.json`（ユーザースコープ）の top-level `mcpServers` に同じ形式で追加:

```json
{
  "mcpServers": {
    "wp-blog-poster": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\path\\to\\wp-blog-poster-mcp\\build\\index.js"],
      "env": {
        "WP_API_URL": "https://your-domain.com",
        "WP_USERNAME": "claude-poster",
        "WP_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx"
      }
    }
  }
}
```

Claude Code の MCP サーバー一覧は起動時に読まれるため、編集後は Claude Code を再起動する。

## 環境変数

| 変数名 | 必須 | 説明 |
|---|---|---|
| `WP_API_URL` | ○ | サイトのベース URL（末尾スラッシュなし、HTTPS 必須） |
| `WP_USERNAME` | ○ | WordPress ユーザー名 |
| `WP_APP_PASSWORD` | ○ | Application Password（スペース込み） |
| `WP_REQUEST_TIMEOUT_MS` | — | REST API 呼出のタイムアウト（ミリ秒、`1000`〜`600000` の整数）。既定 **60000**（60 秒）。共有ホスティングで大きな画像をアップロードする場合は引き上げる。 |

## 画像付き投稿のフロー例

Claude に以下のように自然文で指示するとツールが連鎖的に呼ばれる:

1. 画像を用意（スクショ、生成画像、ローカルファイル等）して base64 化する
2. `upload_media` を呼び、`file_base64` / `filename` / `alt_text` を渡して `media_id` と `source_url` を得る
3. `create_draft_post` を呼ぶ際、本文に `<img src="{source_url}" alt="..." class="wp-image-{media_id}" />` を含め、必要に応じて `featured_media_id: {media_id}` をアイキャッチとして指定する

PNG/JPEG/GIF/WebP 以外（SVG 等）は WP のデフォルト設定で拒否されるためサポート外。

## 下書きの更新・削除

既存の下書きを直したい・消したい場合のフロー:

1. `list_drafts` で対象の投稿 ID とタイトルを確認する（`limit` / `offset` でページング）
2. 更新する場合: `update_post` に `post_id` と変更したいフィールドのみ渡す
3. 削除する場合: `delete_draft_post` に `post_id` を渡す
   - 既定はゴミ箱送り（管理画面から復元可能）
   - 完全削除したい場合は `force_delete: true` を指定

`update_post` / `delete_draft_post` は `status=draft` の投稿のみを対象にする。公開済み・予約投稿・ゴミ箱等の非 draft 投稿にはエラーで弾く仕組みで、誤って公開済み記事を変更・削除することを防ぐ。

## カテゴリ・タグの指定フロー

カテゴリもタグも、ID でも名前でも指定できる。

1. 事前に `list_categories`（必要なら `list_tags`）を呼び、既存の分類体系を確認する。新規に作るより既存 ID / 名前を再利用するのが望ましい
2. `create_draft_post` / `update_post` の引数:
   - `categories: [6, 22]` — 既存カテゴリの ID を直接指定
   - `category_names: ["Windows", "AI"]` — 名前で指定。存在しない場合は **root 配下に自動作成**（`parent` 指定は非対応）
   - 両方併用可、サーバー側で union マージして重複排除する
   - `tags: ["Claude", "MCP"]` — タグ名指定、存在しなければ自動作成

`create_category` / `create_tag` のような単独ツールは **意図的に提供しない**。分類体系の肥大化を防ぐためで、名前指定時の自動作成は「投稿作業の副作用」として発生するのみに限定している。

## 過去記事の文体を参考にして新記事を書かせるフロー

Claude に既存記事の雰囲気を踏襲させた記事を書いてもらう場合の流れ:

1. `list_posts`（既定は公開記事の新しい順、または `search` でキーワード検索）で参考にしたい記事をいくつか見つける。**本文は返らない**ので ID と抜粋だけで当たりをつける
2. 気になった記事の ID を `get_post` に渡す。本文は Gutenberg のブロックマーカー込みの raw で返るため、Claude が実際の編集構造（段落 / 画像 / `<!-- wp:more -->` 等）を把握できる
3. 文体・構造を参考に新記事を Claude に書かせ、`create_draft_post` で下書き化（画像は事前に `upload_media`）

`list_posts` は本文を含めず ID レベルの探索に徹する設計。全文は必ず `get_post` で個別取得し、LLM コンテキストの圧迫を避ける。

## 「続きを読む」リンクを出す慣習

アーカイブ／トップページで「冒頭だけ表示＋続きを読むリンク」形式にしたい場合、本文の冒頭パラグラフ（と任意の画像）の後に Gutenberg の **more ブロック** を挿入する。

```html
<!-- wp:paragraph --><p>イントロの一段落。</p><!-- /wp:paragraph -->
<!-- wp:image {"id":123} --><figure class="wp-block-image"><img src="..." class="wp-image-123" /></figure><!-- /wp:image -->
<!-- wp:more --><!--more--><!-- /wp:more -->
<!-- wp:heading --><h2>見出し1</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>続きの本文…</p><!-- /wp:paragraph -->
```

マーカー無しの場合はテーマの `the_excerpt()` 挙動に依存し、通常は先頭 55 単語の自動抜粋が表示される。

## トラブルシューティング

- **REST API が 401**: Application Password の間違い、または `.htaccess` で Authorization ヘッダーが届いていない
- **REST API が 403**: セキュリティプラグイン（SiteGuard, Wordfence など）で REST API がブロックされている
- **Claude Desktop / Claude Code でサーバーが見えない**: 設定ファイル（`claude_desktop_config.json` または `.claude.json`）の JSON 構文チェック、完全再起動（Claude Desktop はタスクトレイから終了、Claude Code は全セッション終了）
- **ツールは見えるが新ツールだけ呼べない**: ビルド後に Claude を再起動していない。MCP 子プロセスは起動時に spawn されたビルドを保持する
- **STDIO 経由で JSON-RPC が壊れる**: ログ出力に `console.log` を使っていないか確認（`console.error` のみ使用すること）
- **画像アップロード時に 500 エラー**: サーバーの `upload_max_filesize` / `post_max_size` を超えていないか、WordPress のメディア設定（サムネイル生成）でメモリ不足になっていないか確認

## セキュリティ上の注意

- 専用ユーザー（Editor 権限）を使い、Administrator は避ける
- 新規作成は常に `status: "draft"`。公開は人間が管理画面で確認してから行う
- `update_post` / `delete_draft_post` は draft 以外の投稿を拒否する（誤公開・誤削除ガード）
- `WP_API_URL` が `https://` 以外だと起動時にエラーで停止する
- ソースコードへの秘密情報ハードコードはしない

脆弱性の報告は [SECURITY.md](./SECURITY.md) を参照してください。

## ライセンス

[MIT License](./LICENSE)
