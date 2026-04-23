// WordPress REST API クライアント。
// パーマリンク設定が「基本」の環境でも動くよう ?rest_route= 形式でエンドポイントを組み立てる。

import type { AppConfig } from "./config.js";

/**
 * WordPress REST API が返す HTTP エラーを表す例外。
 *
 * 既存 message（`WordPress REST API エラー: ...` 形式）は `super(message)` で維持し、
 * 呼出側が `err.message` 依存で実装しているケースとの互換性を保つ。
 * term_exists エラーなど、エラーレスポンス body の構造を参照したい場合は `body` を利用する。
 */
export class WordPressApiError extends Error {
  readonly status: number;
  readonly body: unknown; // JSON パース済みレスポンス。パース不能なら { _raw: text }

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "WordPressApiError";
    this.status = status;
    this.body = body;
  }
}

export interface CreateDraftPostParams {
  title: string;
  content: string;
  excerpt?: string;
  categories?: number[];
  categoryNames?: string[]; // 名前指定、内部で resolveCategoryIds により ID 化 + 既存なし時は新規作成
  tags?: number[]; // ここでは解決済みの tag ID 配列を受け取る
  featuredMedia?: number; // アイキャッチ画像のメディア ID（任意）
}

export interface CreatedPost {
  id: number;
  link: string;
  editUrl: string;
  previewUrl: string;
  status: string;
}

export interface UpdateDraftPostParams {
  id: number;
  title?: string;
  content?: string;
  excerpt?: string;
  categories?: number[];
  categoryNames?: string[]; // 名前指定、内部で resolveCategoryIds により ID 化 + 既存なし時は新規作成
  tags?: number[]; // 解決済みの tag ID 配列
  featuredMedia?: number; // アイキャッチ画像のメディア ID
}

export interface UpdatedPost {
  id: number;
  link: string;
  editUrl: string;
  previewUrl: string;
  status: string;
  modifiedGmt: string;
}

export interface ListDraftsParams {
  limit: number; // 1〜50
  offset: number; // 0〜
  authorId?: number; // 未指定なら現在の認証ユーザー
}

export interface DraftSummary {
  id: number;
  title: string;
  modifiedGmt: string;
  link: string;
  editUrl: string;
}

export interface GetPostResult {
  id: number;
  title: string;
  contentRaw: string; // Gutenberg ブロックマーカー込みの生 HTML (context=edit)
  excerptRaw: string;
  status: string;
  categories: number[];
  tags: number[];
  featuredMedia: number;
  modifiedGmt: string;
  dateGmt: string;
  link: string;
  editUrl: string;
}

export interface ListPostsParams {
  status: "publish" | "draft" | "pending" | "private" | "future" | "any";
  perPage: number; // 1〜50
  offset: number; // 0〜
  search?: string;
  orderBy: "date" | "modified" | "title";
  order: "asc" | "desc";
}

export interface PostSummary {
  id: number;
  title: string;
  excerpt: string;
  status: string;
  dateGmt: string;
  modifiedGmt: string;
  link: string;
}

export interface DeleteDraftPostParams {
  id: number;
  forceDelete: boolean; // false: ゴミ箱送り (trash) / true: 完全削除
}

export interface DeletedPost {
  id: number;
  finalStatus: "trash" | "deleted";
  previousStatus: string; // 事前 GET 時点のステータス（= "draft"）
}

export interface UploadMediaParams {
  filename: string;
  bytes: Buffer;
  mimeType: string;
  altText?: string;
  caption?: string;
  title?: string;
}

export interface ListCategoriesParams {
  limit: number; // 1〜100
  offset: number; // 0〜
  orderBy: "count" | "name" | "id";
  order: "asc" | "desc";
  search?: string;
  parent?: number; // 0 指定で root のみ、未指定で全階層
}

export interface CategorySummary {
  id: number;
  name: string;
  slug: string;
  parent: number;
  count: number;
  description: string;
}

export interface ListTagsParams {
  limit: number; // 1〜100
  offset: number; // 0〜
  orderBy: "count" | "name" | "id";
  order: "asc" | "desc";
  search?: string;
}

export interface TagSummary {
  id: number;
  name: string;
  slug: string;
  count: number;
  description: string;
}

export interface UploadedMedia {
  id: number;
  sourceUrl: string;
  mimeType: string;
  mediaType: string; // "image" | "file" 等
  title: string;
  altText: string;
  editUrl: string;
}

/**
 * WordPress REST API を叩くクライアント。
 *
 * 認証は Application Password を用いた Basic 認証。
 * URL 形式は常に `${apiUrl}/?rest_route=/wp/v2/...` として組み立てる。
 */
export class WordPressClient {
  private readonly apiUrl: string;
  private readonly authHeader: string;
  private readonly requestTimeoutMs: number;

  constructor(config: AppConfig) {
    this.apiUrl = config.apiUrl;
    const raw = `${config.username}:${config.appPassword}`;
    this.authHeader = `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
    this.requestTimeoutMs = config.requestTimeoutMs;
  }

  /**
   * 下書き投稿を新規作成する。status は常に "draft" に固定。
   */
  async createDraftPost(params: CreateDraftPostParams): Promise<CreatedPost> {
    const body: Record<string, unknown> = {
      title: params.title,
      content: params.content,
      status: "draft",
    };
    if (params.excerpt !== undefined) body.excerpt = params.excerpt;
    // categories (ID 配列) と categoryNames (名前配列) をマージ、重複排除
    const mergedCategories = await this.mergeCategoryIds(
      params.categories,
      params.categoryNames,
    );
    if (mergedCategories.length > 0) {
      body.categories = mergedCategories;
    }
    if (params.tags && params.tags.length > 0) {
      body.tags = params.tags;
    }
    if (params.featuredMedia !== undefined) {
      body.featured_media = params.featuredMedia;
    }

    const json = await this.request<Record<string, unknown>>(
      "POST",
      "/wp/v2/posts",
      body,
    );

    const id = Number(json.id);
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(
        `REST API が投稿 ID を返しませんでした: ${JSON.stringify(json)}`,
      );
    }
    const link = typeof json.link === "string" ? json.link : "";
    const status = typeof json.status === "string" ? json.status : "draft";

    return {
      id,
      link,
      status,
      // 編集画面とプレビュー画面の URL は REST API から直接返らないため組み立てる
      editUrl: `${this.apiUrl}/wp-admin/post.php?post=${id}&action=edit`,
      previewUrl: `${this.apiUrl}/?p=${id}&preview=true`,
    };
  }

  /**
   * 既存の下書き投稿を部分更新する。
   *
   * 安全のため、更新対象は status="draft" の投稿に限定する。
   * 公開済み (publish) / 保留 (pending) / 非公開 (private) 等は事前チェックでエラーにする。
   * 更新リクエストには `status: "draft"` を明示して draft 維持を保証する。
   */
  async updateDraftPost(params: UpdateDraftPostParams): Promise<UpdatedPost> {
    // 1) 事前に現在ステータスを取得して draft 以外はエラー
    const current = await this.request<Record<string, unknown>>(
      "GET",
      `/wp/v2/posts/${params.id}?context=edit`,
    );
    const currentStatus =
      typeof current.status === "string" ? current.status : "";
    if (currentStatus !== "draft") {
      throw new Error(
        `投稿 ID ${params.id} のステータスは "${currentStatus}" です。` +
          `update_post は下書き (draft) のみを更新対象とします。` +
          `公開済み記事の編集は WordPress 管理画面から行ってください。`,
      );
    }

    // 2) 部分更新の body を組み立て（未指定フィールドは送らず既存値を保持）
    const body: Record<string, unknown> = {
      status: "draft", // 明示して draft 維持
    };
    if (params.title !== undefined) body.title = params.title;
    if (params.content !== undefined) body.content = params.content;
    if (params.excerpt !== undefined) body.excerpt = params.excerpt;
    // update では「categories / categoryNames のいずれか指定あり」の場合のみマージして送信。
    // 両方未指定なら body.categories を送らず既存値を保持する。
    if (params.categories !== undefined || params.categoryNames !== undefined) {
      const mergedCategories = await this.mergeCategoryIds(
        params.categories,
        params.categoryNames,
      );
      body.categories = mergedCategories;
    }
    if (params.tags !== undefined) body.tags = params.tags;
    if (params.featuredMedia !== undefined) {
      body.featured_media = params.featuredMedia;
    }

    const json = await this.request<Record<string, unknown>>(
      "POST",
      `/wp/v2/posts/${params.id}`,
      body,
    );

    const id = Number(json.id);
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(
        `REST API が投稿 ID を返しませんでした: ${JSON.stringify(json)}`,
      );
    }
    const link = typeof json.link === "string" ? json.link : "";
    const status = typeof json.status === "string" ? json.status : "draft";
    const modifiedGmt =
      typeof json.modified_gmt === "string" ? json.modified_gmt : "";

    return {
      id,
      link,
      status,
      modifiedGmt,
      editUrl: `${this.apiUrl}/wp-admin/post.php?post=${id}&action=edit`,
      previewUrl: `${this.apiUrl}/?p=${id}&preview=true`,
    };
  }

  /**
   * 指定ユーザー（未指定時は認証中ユーザー）の下書き投稿一覧を取得する。
   *
   * MVP の「human-in-the-loop で公開」思想に合わせ、下書きに限定して返す。
   * 公開済み投稿の一覧取得は別ツール化を検討する。
   */
  async listDrafts(params: ListDraftsParams): Promise<DraftSummary[]> {
    // 認証中ユーザーの ID を特定（authorId 未指定時）
    let authorId = params.authorId;
    if (authorId === undefined) {
      const me = await this.request<Record<string, unknown>>(
        "GET",
        "/wp/v2/users/me",
      );
      const idVal = Number(me.id);
      if (!Number.isFinite(idVal) || idVal <= 0) {
        throw new Error(
          `現在のユーザー ID を取得できませんでした: ${JSON.stringify(me)}`,
        );
      }
      authorId = idVal;
    }

    const query = new URLSearchParams({
      status: "draft",
      author: String(authorId),
      per_page: String(params.limit),
      offset: String(params.offset),
      orderby: "modified",
      order: "desc",
      context: "edit",
      _fields: "id,title,modified_gmt,link,status",
    });
    const list = await this.request<unknown[]>(
      "GET",
      `/wp/v2/posts?${query.toString()}`,
    );
    if (!Array.isArray(list)) {
      throw new Error(
        `REST API が配列を返しませんでした: ${JSON.stringify(list)}`,
      );
    }

    const results: DraftSummary[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const id = Number(rec.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const titleRaw = rec.title;
      const title =
        titleRaw && typeof titleRaw === "object" && "rendered" in titleRaw
          ? String((titleRaw as { rendered?: unknown }).rendered ?? "")
          : String(titleRaw ?? "");
      const modifiedGmt =
        typeof rec.modified_gmt === "string" ? rec.modified_gmt : "";
      const link = typeof rec.link === "string" ? rec.link : "";
      results.push({
        id,
        title,
        modifiedGmt,
        link,
        editUrl: `${this.apiUrl}/wp-admin/post.php?post=${id}&action=edit`,
      });
    }
    return results;
  }

  /**
   * 指定 ID の投稿 1 件を取得する。
   *
   * context=edit を使い、content.raw (Gutenberg ブロックマーカー込みの生 HTML) を返す。
   * これにより、過去記事を Claude に参考として渡す際に、レンダリング後の HTML ではなく
   * 「実際に WP に保存された編集用マークアップ」を文体参考として利用できる。
   */
  async getPost(id: number): Promise<GetPostResult> {
    const json = await this.request<Record<string, unknown>>(
      "GET",
      `/wp/v2/posts/${id}?context=edit`,
    );

    const postId = Number(json.id);
    if (!Number.isFinite(postId) || postId <= 0) {
      throw new Error(
        `REST API が投稿 ID を返しませんでした: ${JSON.stringify(json)}`,
      );
    }

    // title / content / excerpt は context=edit で { raw, rendered } 形式になる
    const titleRaw = pickRaw(json.title);
    const contentRaw = pickRaw(json.content);
    const excerptRaw = pickRaw(json.excerpt);

    const categoriesArr = Array.isArray(json.categories)
      ? json.categories
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v) && v > 0)
      : [];
    const tagsArr = Array.isArray(json.tags)
      ? json.tags
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v) && v > 0)
      : [];

    return {
      id: postId,
      title: titleRaw,
      contentRaw,
      excerptRaw,
      status: typeof json.status === "string" ? json.status : "",
      categories: categoriesArr,
      tags: tagsArr,
      featuredMedia:
        typeof json.featured_media === "number"
          ? json.featured_media
          : Number(json.featured_media ?? 0) || 0,
      modifiedGmt:
        typeof json.modified_gmt === "string" ? json.modified_gmt : "",
      dateGmt: typeof json.date_gmt === "string" ? json.date_gmt : "",
      link: typeof json.link === "string" ? json.link : "",
      editUrl: `${this.apiUrl}/wp-admin/post.php?post=${postId}&action=edit`,
    };
  }

  /**
   * 投稿一覧を取得する（本文は含めない、探索用）。
   *
   * 既定は status=publish / orderby=date / order=desc。
   * 返却は id / title / excerpt / status / date / link などの軽量フィールドのみ。
   * 本文は LLM コンテキストを圧迫するため意図的に含めず、詳細は getPost で個別取得させる。
   */
  async listPosts(params: ListPostsParams): Promise<PostSummary[]> {
    const query = new URLSearchParams({
      status: params.status,
      per_page: String(params.perPage),
      offset: String(params.offset),
      orderby: params.orderBy,
      order: params.order,
      _fields: "id,title,excerpt,status,date_gmt,modified_gmt,link",
    });
    if (params.search !== undefined && params.search.length > 0) {
      query.set("search", params.search);
    }

    const list = await this.request<unknown[]>(
      "GET",
      `/wp/v2/posts?${query.toString()}`,
    );
    if (!Array.isArray(list)) {
      throw new Error(
        `REST API が配列を返しませんでした: ${JSON.stringify(list)}`,
      );
    }

    const results: PostSummary[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const id = Number(rec.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      results.push({
        id,
        title: pickRendered(rec.title),
        excerpt: pickRendered(rec.excerpt),
        status: typeof rec.status === "string" ? rec.status : "",
        dateGmt: typeof rec.date_gmt === "string" ? rec.date_gmt : "",
        modifiedGmt:
          typeof rec.modified_gmt === "string" ? rec.modified_gmt : "",
        link: typeof rec.link === "string" ? rec.link : "",
      });
    }
    return results;
  }

  /**
   * 下書き投稿を削除する。
   *
   * 安全のため、削除対象は status="draft" の投稿に限定する。
   * 公開済み (publish) / 保留 (pending) / 非公開 (private) 等は事前チェックでエラーにする。
   * forceDelete=false (既定) の場合はゴミ箱送り (status=trash、管理画面から復元可能)、
   * forceDelete=true の場合は ?force=true を付与して完全削除する。
   */
  async deleteDraftPost(
    params: DeleteDraftPostParams,
  ): Promise<DeletedPost> {
    // 1) 事前に現在ステータスを取得して draft 以外はエラー
    const current = await this.request<Record<string, unknown>>(
      "GET",
      `/wp/v2/posts/${params.id}?context=edit`,
    );
    const currentStatus =
      typeof current.status === "string" ? current.status : "";
    if (currentStatus !== "draft") {
      throw new Error(
        `投稿 ID ${params.id} のステータスは "${currentStatus}" です。` +
          `delete_draft_post は下書き (draft) のみを削除対象とします。` +
          `公開済み記事の削除は WordPress 管理画面から行ってください。`,
      );
    }

    // 2) DELETE 実行。forceDelete=true は ?force=true を付与して完全削除。
    //    それ以外は WP 既定動作でゴミ箱 (trash) 送り。
    const route = params.forceDelete
      ? `/wp/v2/posts/${params.id}?force=true`
      : `/wp/v2/posts/${params.id}`;
    const deleted = await this.request<Record<string, unknown>>(
      "DELETE",
      route,
    );

    // 完全削除の場合は REST が deleted: true とトップレベル previous を返す。
    // ゴミ箱送りの場合は更新後の投稿オブジェクト (status=trash) を返す。
    let finalStatus: "trash" | "deleted";
    if (params.forceDelete) {
      finalStatus = "deleted";
    } else {
      const afterStatus =
        typeof deleted.status === "string" ? deleted.status : "";
      if (afterStatus !== "trash") {
        throw new Error(
          `ゴミ箱送り後のステータスが "trash" ではありません: "${afterStatus}" (${JSON.stringify(
            deleted,
          )})`,
        );
      }
      finalStatus = "trash";
    }

    return {
      id: params.id,
      finalStatus,
      previousStatus: currentStatus,
    };
  }

  /**
   * 画像ファイルをメディアライブラリにアップロードする。
   *
   * raw バイナリ方式（Content-Type: image/*, Content-Disposition: attachment; filename="..."）。
   * alt_text / caption / title が指定された場合は、アップロード後にメタデータを別リクエストで更新する。
   */
  async uploadMedia(params: UploadMediaParams): Promise<UploadedMedia> {
    // 1) バイナリ本体をアップロード
    const uploaded = await this.requestBinary<Record<string, unknown>>(
      "POST",
      "/wp/v2/media",
      params.bytes,
      params.mimeType,
      params.filename,
    );

    const id = Number(uploaded.id);
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(
        `メディア作成 API が ID を返しませんでした: ${JSON.stringify(uploaded)}`,
      );
    }

    // 2) メタデータの事後更新（指定があったときのみ）
    let final: Record<string, unknown> = uploaded;
    const patch: Record<string, unknown> = {};
    if (params.altText !== undefined) patch.alt_text = params.altText;
    if (params.caption !== undefined) patch.caption = params.caption;
    if (params.title !== undefined) patch.title = params.title;
    if (Object.keys(patch).length > 0) {
      final = await this.request<Record<string, unknown>>(
        "POST",
        `/wp/v2/media/${id}`,
        patch,
      );
    }

    return this.mapMedia(final);
  }

  /**
   * REST API レスポンスからクライアント公開型へ整形する。
   */
  private mapMedia(json: Record<string, unknown>): UploadedMedia {
    const id = Number(json.id);
    const sourceUrl = typeof json.source_url === "string" ? json.source_url : "";
    const mimeType = typeof json.mime_type === "string" ? json.mime_type : "";
    const mediaType =
      typeof json.media_type === "string" ? json.media_type : "";
    // title / alt_text は rendered 形式 or プレーン文字列両方あり得る
    const titleRaw = json.title;
    const title =
      titleRaw && typeof titleRaw === "object" && "rendered" in titleRaw
        ? String((titleRaw as { rendered?: unknown }).rendered ?? "")
        : String(titleRaw ?? "");
    const altText = typeof json.alt_text === "string" ? json.alt_text : "";
    return {
      id,
      sourceUrl,
      mimeType,
      mediaType,
      title,
      altText,
      editUrl: `${this.apiUrl}/wp-admin/post.php?post=${id}&action=edit`,
    };
  }

  /**
   * タグ名の配列を tag ID の配列に解決する。
   * 既存タグがあればその ID を返し、無ければ新規作成してその ID を返す。
   */
  async resolveTagIds(tagNames: string[]): Promise<number[]> {
    const ids: number[] = [];
    for (const name of tagNames) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const id = await this.findOrCreateTag(trimmed);
      ids.push(id);
    }
    return ids;
  }

  private async findOrCreateTag(name: string): Promise<number> {
    // search による完全一致判定（WordPress の仕様上 partial match になるため二重チェック）
    const search = encodeURIComponent(name);
    const existing = await this.request<unknown[]>(
      "GET",
      `/wp/v2/tags?search=${search}&per_page=100`,
    );
    if (Array.isArray(existing)) {
      for (const item of existing) {
        if (
          item &&
          typeof item === "object" &&
          "name" in item &&
          "id" in item &&
          (item as { name?: unknown }).name === name
        ) {
          return Number((item as { id: unknown }).id);
        }
      }
    }
    // 無ければ新規作成。search でスリ抜けたが既存の場合は term_exists エラー (HTTP 400) になるため
    // data.term_id を拾って既存 ID を返すフォールバックを試みる。
    try {
      const created = await this.request<Record<string, unknown>>(
        "POST",
        "/wp/v2/tags",
        { name },
      );
      const id = Number(created.id);
      if (!Number.isFinite(id) || id <= 0) {
        throw new Error(
          `タグ作成 API が ID を返しませんでした: ${JSON.stringify(created)}`,
        );
      }
      return id;
    } catch (err) {
      return await this.recoverTermExists(err, name, "tags");
    }
  }

  /**
   * カテゴリ名の配列を category ID の配列に解決する。
   * 既存カテゴリがあればその ID を返し、無ければ root 配下に新規作成してその ID を返す。
   * 階層指定 (parent) は v0.3.0 ではサポートしない（誤って深い階層を増やさないため）。
   */
  async resolveCategoryIds(categoryNames: string[]): Promise<number[]> {
    const ids: number[] = [];
    for (const name of categoryNames) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const id = await this.findOrCreateCategory(trimmed);
      ids.push(id);
    }
    return ids;
  }

  private async findOrCreateCategory(name: string): Promise<number> {
    // search は partial match のため、name 完全一致で二重チェック
    const search = encodeURIComponent(name);
    const existing = await this.request<unknown[]>(
      "GET",
      `/wp/v2/categories?search=${search}&per_page=100`,
    );
    if (Array.isArray(existing)) {
      for (const item of existing) {
        if (
          item &&
          typeof item === "object" &&
          "name" in item &&
          "id" in item &&
          (item as { name?: unknown }).name === name
        ) {
          return Number((item as { id: unknown }).id);
        }
      }
    }
    // 無ければ新規作成 (root 配下、parent 未指定)。
    // search でスリ抜けた場合は term_exists エラーになるため data.term_id で再取得する。
    try {
      const created = await this.request<Record<string, unknown>>(
        "POST",
        "/wp/v2/categories",
        { name },
      );
      const id = Number(created.id);
      if (!Number.isFinite(id) || id <= 0) {
        throw new Error(
          `カテゴリ作成 API が ID を返しませんでした: ${JSON.stringify(created)}`,
        );
      }
      return id;
    } catch (err) {
      return await this.recoverTermExists(err, name, "categories");
    }
  }

  /**
   * POST /wp/v2/{taxonomy} が term_exists エラー (HTTP 400) を返したときの回復処理。
   *
   * body.data.term_id で既存 term の ID を取得できたら、GET /wp/v2/{taxonomy}/{id} で
   * name を検証してから返す。slug 衝突だが name 不一致のケースでの誤アタッチを防ぐ。
   * 検証で不一致、または term_exists 以外のエラーだった場合は元のエラーを再 throw する。
   */
  private async recoverTermExists(
    err: unknown,
    expectedName: string,
    taxonomy: "tags" | "categories",
  ): Promise<number> {
    if (err instanceof WordPressApiError && err.status === 400) {
      const body = err.body as
        | { code?: unknown; data?: { term_id?: unknown } }
        | null;
      if (body && body.code === "term_exists") {
        const existingId = Number(body.data?.term_id);
        if (Number.isFinite(existingId) && existingId > 0) {
          // name 完全一致の検証。slug 衝突で別 name の既存 term を誤って返さないため。
          const verify = await this.request<Record<string, unknown>>(
            "GET",
            `/wp/v2/${taxonomy}/${existingId}`,
          );
          if (
            typeof verify.name === "string" &&
            verify.name === expectedName
          ) {
            return existingId;
          }
        }
      }
    }
    throw err;
  }

  /**
   * `categories` (ID 配列) と `categoryNames` (名前配列) を union マージして重複排除した ID 配列を返す。
   * 両方未指定なら空配列を返す。
   */
  private async mergeCategoryIds(
    categoryIds?: number[],
    categoryNames?: string[],
  ): Promise<number[]> {
    const ids = new Set<number>();
    if (categoryIds) {
      for (const id of categoryIds) {
        if (Number.isFinite(id) && id > 0) ids.add(id);
      }
    }
    if (categoryNames && categoryNames.length > 0) {
      const resolved = await this.resolveCategoryIds(categoryNames);
      for (const id of resolved) ids.add(id);
    }
    return [...ids];
  }

  /**
   * カテゴリ一覧を取得する（軽量フィールドのみ）。
   *
   * `_fields` で id/name/slug/parent/count/description に絞りコンテキスト削減。
   * `parent` パラメータで 0 指定 = root のみ、未指定 = 全階層。
   */
  async listCategories(params: ListCategoriesParams): Promise<CategorySummary[]> {
    const query = new URLSearchParams({
      per_page: String(params.limit),
      offset: String(params.offset),
      orderby: params.orderBy,
      order: params.order,
      _fields: "id,name,slug,parent,count,description",
    });
    if (params.search !== undefined && params.search.length > 0) {
      query.set("search", params.search);
    }
    if (params.parent !== undefined) {
      query.set("parent", String(params.parent));
    }

    const list = await this.request<unknown[]>(
      "GET",
      `/wp/v2/categories?${query.toString()}`,
    );
    if (!Array.isArray(list)) {
      throw new Error(
        `REST API が配列を返しませんでした: ${JSON.stringify(list)}`,
      );
    }

    const results: CategorySummary[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const id = Number(rec.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      results.push({
        id,
        name: typeof rec.name === "string" ? rec.name : "",
        slug: typeof rec.slug === "string" ? rec.slug : "",
        parent: Number(rec.parent ?? 0) || 0,
        count: Number(rec.count ?? 0) || 0,
        description: typeof rec.description === "string" ? rec.description : "",
      });
    }
    return results;
  }

  /**
   * タグ一覧を取得する（軽量フィールドのみ）。
   */
  async listTags(params: ListTagsParams): Promise<TagSummary[]> {
    const query = new URLSearchParams({
      per_page: String(params.limit),
      offset: String(params.offset),
      orderby: params.orderBy,
      order: params.order,
      _fields: "id,name,slug,count,description",
    });
    if (params.search !== undefined && params.search.length > 0) {
      query.set("search", params.search);
    }

    const list = await this.request<unknown[]>(
      "GET",
      `/wp/v2/tags?${query.toString()}`,
    );
    if (!Array.isArray(list)) {
      throw new Error(
        `REST API が配列を返しませんでした: ${JSON.stringify(list)}`,
      );
    }

    const results: TagSummary[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const id = Number(rec.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      results.push({
        id,
        name: typeof rec.name === "string" ? rec.name : "",
        slug: typeof rec.slug === "string" ? rec.slug : "",
        count: Number(rec.count ?? 0) || 0,
        description: typeof rec.description === "string" ? rec.description : "",
      });
    }
    return results;
  }

  // --- 内部ヘルパー ---

  private buildUrl(route: string): string {
    // route は "/wp/v2/posts" や "/wp/v2/tags?search=foo" を想定
    // ?rest_route= 形式に載せるため、route 側に ? が含まれる場合は & に置換する
    const [path, query] = route.split("?", 2);
    const base = `${this.apiUrl}/?rest_route=${encodeURI(path)}`;
    return query ? `${base}&${query}` : base;
  }

  /**
   * バイナリ本体を送る POST 用のリクエスト実装（raw binary 方式のメディアアップロード用）。
   *
   * multipart/form-data ではなく、WordPress REST API が許容する
   * `Content-Type: <mime>` + `Content-Disposition: attachment; filename="..."` 方式を用いる。
   */
  private async requestBinary<T>(
    method: "POST",
    route: string,
    bytes: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<T> {
    const url = this.buildUrl(route);
    // ASCII 安全なファイル名を作る（RFC 5987 エンコード）。元ファイル名が ASCII-safe なら同じ。
    const asciiName = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    const encodedName = encodeURIComponent(filename);
    const disposition = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
      "Content-Type": mimeType,
      "Content-Disposition": disposition,
      "Content-Length": String(bytes.length),
    };

    // Buffer を fetch に渡す。TS 5.7+ では Uint8Array<ArrayBufferLike> と
    // lib.dom の BodyInit (BufferSource) の型定義が噛み合わないため、実行時は正しく動作する
    // ことを前提に Uint8Array ビュー（コピー無し）を生成し、型だけ BodyInit にアサートする。
    const bodyView = new Uint8Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ) as unknown as BodyInit;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: bodyView,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        let parsedBody: unknown;
        try {
          parsedBody = text ? JSON.parse(text) : null;
        } catch {
          parsedBody = { _raw: text };
        }
        throw new WordPressApiError(
          `WordPress REST API エラー: ${method} ${route} -> HTTP ${res.status} ${res.statusText}\n${truncate(text, 800)}`,
          res.status,
          parsedBody,
        );
      }
      if (!text) {
        throw new Error(
          `WordPress REST API が空レスポンスを返しました: ${method} ${route}`,
        );
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(
          `WordPress REST API のレスポンスが JSON ではありません: ${method} ${route}\n${truncate(text, 800)}`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `WordPress REST API がタイムアウトしました (${this.requestTimeoutMs}ms): ${method} ${route}`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    route: string,
    body?: unknown,
  ): Promise<T> {
    const url = this.buildUrl(route);
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };
    let bodyText: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      bodyText = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: bodyText,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        // エラー body を JSON パース（パース不能時は raw 保持）。
        // term_exists など呼出側でレスポンス構造を判定したい場合のために body を添えて throw する。
        let parsedBody: unknown;
        try {
          parsedBody = text ? JSON.parse(text) : null;
        } catch {
          parsedBody = { _raw: text };
        }
        throw new WordPressApiError(
          `WordPress REST API エラー: ${method} ${route} -> HTTP ${res.status} ${res.statusText}\n${truncate(text, 800)}`,
          res.status,
          parsedBody,
        );
      }
      if (!text) {
        // 本来は空レスポンスは想定しないが、予期せぬ空をエラー化
        throw new Error(
          `WordPress REST API が空レスポンスを返しました: ${method} ${route}`,
        );
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(
          `WordPress REST API のレスポンスが JSON ではありません: ${method} ${route}\n${truncate(text, 800)}`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `WordPress REST API がタイムアウトしました (${this.requestTimeoutMs}ms): ${method} ${route}`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * context=edit で返ってくる { raw, rendered } の構造から raw を優先取得する。
 * 文字列が直接来た場合はそれを返す。取得できなければ空文字。
 */
function pickRaw(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const v = value as { raw?: unknown; rendered?: unknown };
    if (typeof v.raw === "string") return v.raw;
    if (typeof v.rendered === "string") return v.rendered;
  }
  return "";
}

/**
 * 一覧向け。rendered 優先で取り、無ければ raw にフォールバック。
 */
function pickRendered(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const v = value as { raw?: unknown; rendered?: unknown };
    if (typeof v.rendered === "string") return v.rendered;
    if (typeof v.raw === "string") return v.raw;
  }
  return "";
}
