# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-04-23

### Fixed
- Tag and category resolution (`create_draft_post` / `update_post` with `tags` /
  `category_names`) no longer crashes when the WordPress `?search=` endpoint
  fails to surface an existing term and the subsequent `POST` returns
  `term_exists` (HTTP 400). The new fallback reads `data.term_id` from the
  error body, verifies the existing term's `name` matches exactly (to avoid
  accidentally attaching to a slug-colliding but differently-named term), and
  returns the existing ID. The previous behavior was to propagate the raw 400
  as a request failure.

### Changed
- Introduced an internal `WordPressApiError` exception type that carries the
  response `status` and parsed `body`, allowing callers to react to specific
  REST error codes. The public message format is unchanged, so downstream code
  that relies on `err.message` continues to work.

## [0.3.0] - 2026-04-23

### Added
- `list_categories` tool — list existing WordPress categories with ID / name /
  slug / parent / count / description. Useful for Claude to inspect the
  existing classification before adding categories to a post.
- `list_tags` tool — list existing tags with usage count. Helps avoid creating
  duplicate tags with similar meanings.
- `create_draft_post` and `update_post` now accept `category_names: string[]`
  in addition to `categories: number[]`. Names are resolved to IDs (and
  created at the root level if they don't exist), then unioned with the ID
  list. Same pattern as the existing `tags` auto-creation.
- `WP_REQUEST_TIMEOUT_MS` environment variable — configurable REST request
  timeout (range 1000–600000 ms). Default raised from the previous
  hard-coded 30 000 ms to **60 000 ms** to better accommodate larger media
  uploads over shared hosting.

### Changed
- Default REST request timeout is now 60 seconds (up from 30 seconds).
  Existing deployments will continue to work without any configuration
  change; set `WP_REQUEST_TIMEOUT_MS` to override.

## [0.2.0] - 2026-04-22

### Added
- `upload_media` tool — upload PNG / JPEG / GIF / WebP images to the WordPress
  media library, with optional `alt_text` / `caption` / `title` metadata.
- `create_draft_post` now accepts an optional `featured_media_id` to attach a
  previously uploaded image as the post's featured image.
- `update_post` tool — partially update an existing **draft** post. Rejects
  non-draft targets (`publish` / `pending` / `private`) to prevent accidental
  edits to published content.
- `list_drafts` tool — list drafts owned by the authenticated user, ordered
  by last modified time, with `limit` and `offset` paging.
- `delete_draft_post` tool — move a draft to the trash (default) or fully
  delete it with `force_delete: true`. Rejects non-draft targets.
- `get_post` tool — fetch a single post by ID with raw Gutenberg content
  (`context=edit`). Enables Claude to reference the author's existing voice
  and block structure when composing new posts.
- `list_posts` tool — discover posts by status / search / date. Returns
  lightweight summaries without bodies; pair with `get_post` for full text.

### Changed
- README split into English (`README.md`) and Japanese (`README.ja.md`).

## [0.1.0] - 2026-04-18

### Added
- Initial release.
- `create_draft_post` tool — create a single WordPress draft via the REST API.
  `status` is always pinned to `draft`; publishing is intentionally left to
  humans in the admin UI.
- STDIO transport for use with Claude Desktop and Claude Code.
- Application Password (Basic auth over HTTPS) authentication.
- URL scheme `?rest_route=/...` to work with permalink structures that don't
  expose `/wp-json/...`.
