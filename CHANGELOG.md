# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
