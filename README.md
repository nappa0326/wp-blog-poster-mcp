# wp-blog-poster-mcp

> Language: **English** / [日本語](./README.ja.md)

A minimal local [MCP](https://modelcontextprotocol.io/) server that lets
Claude Desktop / Claude Code create and manage WordPress drafts through the
REST API, including image uploads. Intended for hobby blogs and small sites
on shared hosting where the full-featured WordPress MCP plugins are either
overkill or unavailable.

## Features

Nine tools are registered on the `wp-blog-poster` MCP server:

| Tool | Purpose |
|------|---------|
| `create_draft_post` | Create a single draft. `status` is always pinned to `draft`; publishing is intentionally left to a human in the admin UI. Accepts tags by name (auto-created) and categories by ID and/or name (auto-created at the root level). |
| `upload_media` | Upload a PNG / JPEG / GIF / WebP image to the media library. Accepts either `file_path` (absolute path, recommended — the server reads the file directly, avoiding base64 transport) or `file_base64` (inline, small images). Returns a `media_id` and `source_url`, with optional `alt_text` / `caption` / `title`. |
| `update_post` | Partially update an existing **draft** post. Any non-draft target (`publish` / `pending` / `private` / `trash`) is rejected to prevent accidental edits to published content. Unspecified fields are preserved. Supports `category_names` like `create_draft_post`. |
| `list_drafts` | List drafts owned by the authenticated user, ordered by last modified time, with `limit` and `offset` paging. |
| `delete_draft_post` | Move a draft to the trash (default) or fully delete it with `force_delete: true`. Non-draft targets are rejected. |
| `get_post` | Fetch a single post by ID with the **raw** Gutenberg content (not the rendered HTML), so Claude can reason about block markers and match the author's voice when composing new posts. Read-only, no status restriction. |
| `list_posts` | Discover posts by status / search / date. Returns lightweight summaries without the body (use `get_post` for the full text) to keep LLM context small. |
| `list_categories` | List categories with ID / name / slug / parent / count. Use before `create_draft_post` to see the existing classification (and to pick IDs for `categories`). Supports `parent=0` to list only root categories. |
| `list_tags` | List tags with ID / name / slug / count. Use to check existing tags before adding new ones via `create_draft_post`, avoiding near-duplicates. |

Design principles:

- **Human-in-the-loop for publishing.** LLMs can create and iterate on drafts,
  but cannot hit Publish.
- **Draft-only mutations.** `update_post` and `delete_draft_post` refuse to
  touch anything that isn't currently a draft.
- **No SSE / long-lived HTTP.** STDIO transport works in constrained shared
  hosting environments (execution-time limits, FCGI, etc.).

## Requirements

- Node.js **22+**
- Claude Desktop, Claude Code, or any other MCP client that spawns STDIO
  servers
- WordPress **5.6+** (for built-in Application Password support)

## WordPress setup

1. In **Users → Add New**, create a dedicated account for the MCP.
   - Suggested username: `claude-poster`
   - Role: **Editor** (recommended — lets the tool auto-create tags)
   - Do not use an Administrator account.
2. Open the new user's profile, scroll to **Application Passwords**, create
   one (e.g. name: `claude-desktop-mcp`). Copy the generated value including
   spaces — it's only shown once.
3. Verify that `https://{your-domain}/?rest_route=/wp/v2/posts` or
   `https://{your-domain}/wp-json/wp/v2/posts` returns JSON in a browser. If
   it doesn't, a security plugin (SiteGuard, Wordfence, etc.) may be blocking
   the REST API.
4. If your host runs PHP under CGI / FCGI, the `Authorization` header is
   often stripped before PHP sees it. Add the following line to the site
   root `.htaccess`:
   ```apache
   SetEnvIf Authorization "(.+)" HTTP_AUTHORIZATION=$1
   ```

## Install & build

```bash
npm install
npm run build
```

## Try it locally with MCP Inspector

```bash
npm run inspector
```

Opens the MCP Inspector in your browser. Pick a tool, supply arguments, and
run it against your WordPress site.

## Claude Desktop configuration

Edit `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "wp-blog-poster": {
      "command": "node",
      "args": ["/absolute/path/to/wp-blog-poster-mcp/build/index.js"],
      "env": {
        "WP_API_URL": "https://your-domain.com",
        "WP_USERNAME": "claude-poster",
        "WP_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx"
      }
    }
  }
}
```

Fully quit Claude Desktop (from the tray / menu bar — closing the window is
not enough) and relaunch.

## Claude Code configuration

Add the same entry under the top-level `mcpServers` key of
`%USERPROFILE%\.claude.json` (Windows) or `~/.claude.json` (macOS / Linux):

```json
{
  "mcpServers": {
    "wp-blog-poster": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/wp-blog-poster-mcp/build/index.js"],
      "env": {
        "WP_API_URL": "https://your-domain.com",
        "WP_USERNAME": "claude-poster",
        "WP_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx"
      }
    }
  }
}
```

Restart Claude Code after editing — the MCP server list is read at startup.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WP_API_URL` | ✅ | Site base URL, no trailing slash, **HTTPS only** (the server refuses to start otherwise). |
| `WP_USERNAME` | ✅ | WordPress username of the dedicated MCP user. |
| `WP_APP_PASSWORD` | ✅ | Application Password value (quote it in `.env` — it contains spaces). |
| `WP_REQUEST_TIMEOUT_MS` | — | Per-request timeout in milliseconds. Integer in `[1000, 600000]`. Defaults to **60000** (60 s). Raise this if you upload large media over slow shared hosting. |

## Example: image + draft workflow

1. Call `upload_media` with either:
   - `file_path`: absolute path to the image on the MCP server's filesystem
     (**recommended** for any non-trivial image — the server reads the file
     directly, so the caller doesn't pay the JSON-RPC transport cost of a
     base64-encoded payload). Exactly one of `file_path` or `file_base64`
     must be provided.
   - `file_base64`: inline base64 payload, for small images or callers that
     don't share a filesystem with the server.

   Plus `filename` (always required) and optional `alt_text` / `caption` /
   `title`. You get back `media_id` and `source_url`.
2. Call `create_draft_post` with the body including
   `<img src="{source_url}" alt="..." class="wp-image-{media_id}" />`, and
   optionally `featured_media_id: {media_id}` to set it as the featured
   image.

SVG and other types are rejected — only PNG / JPEG / GIF / WebP are accepted
to match WordPress's default upload MIME allowlist.

## Example: maintaining an existing draft

1. Call `list_drafts` to find the post you want to edit. Paginate with
   `limit` and `offset` as needed.
2. To edit: call `update_post` with `post_id` plus only the fields you want
   to change. Unspecified fields keep their current value.
3. To remove: call `delete_draft_post` with `post_id`. By default the post
   goes to the trash (recoverable from the WordPress admin). Pass
   `force_delete: true` to hard-delete instead.

Both `update_post` and `delete_draft_post` refuse to operate on anything
that is not currently a draft. Published posts remain off-limits by design.

## Example: categorizing and tagging

Categories and tags can both be given either by ID or by name:

1. Call `list_categories` (optionally `list_tags`) to see what already exists.
   Prefer reusing existing IDs / names over minting new ones.
2. When calling `create_draft_post` or `update_post`:
   - `categories: [6, 22]` — existing category IDs.
   - `category_names: ["Windows", "AI"]` — names; missing ones are auto-created
     at the root level (no `parent`).
   - Both may be combined; the server unions them and removes duplicates.
   - `tags: ["Claude", "MCP"]` — names; missing ones are auto-created.

The server intentionally does **not** expose separate `create_category` /
`create_tag` tools — auto-creation happens on demand as a side effect of
posting. This keeps the classification from growing unchecked while still
letting the LLM reuse or introduce terms naturally.

## Example: referencing past posts for voice / style

When you want Claude to write a new post that matches your existing voice:

1. Call `list_posts` with `search` or plain pagination to find a few reference
   articles (summaries only, no body). Note the post IDs you're interested in.
2. Call `get_post` with each `post_id`. You get the **raw** content including
   Gutenberg block markers (`<!-- wp:paragraph -->`, `<!-- wp:image -->`,
   `<!-- wp:more -->`, etc.), so Claude can see the actual editorial
   structure instead of rendered HTML.
3. Ask Claude to draft a new article in a similar tone, then call
   `create_draft_post` — optionally with `upload_media` for images.

`list_posts` never includes the body to protect LLM context. Always chain
through `get_post` for full text.

## The "Read more" convention

To make an archive or front page show "intro + Read more" instead of the
full body, insert the Gutenberg `more` block after the opening paragraph
(and optional hero image):

```html
<!-- wp:paragraph --><p>Intro paragraph.</p><!-- /wp:paragraph -->
<!-- wp:image {"id":123} --><figure class="wp-block-image"><img src="..." class="wp-image-123" /></figure><!-- /wp:image -->
<!-- wp:more --><!--more--><!-- /wp:more -->
<!-- wp:heading --><h2>First section</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>Body continues…</p><!-- /wp:paragraph -->
```

Without the marker, archive rendering falls back to the theme's
`the_excerpt()` implementation (typically the first 55 words).

## Troubleshooting

- **401 Unauthorized** — Application Password is wrong, or the
  `Authorization` header isn't reaching PHP. Add the `.htaccess` rule above.
- **403 Forbidden** — A security plugin is blocking `/wp-json/` or
  `?rest_route=`. Add an allowlist entry for the REST route.
- **Claude client doesn't see the server** — Check the JSON syntax in
  `claude_desktop_config.json` / `.claude.json`, then fully quit and relaunch
  the client (tray / menu bar, not just closing the window).
- **Newly added tool doesn't show up** — You rebuilt but didn't restart the
  client. The MCP child process caches the build it was spawned from.
- **JSON-RPC errors on the client side** — Something wrote to `stdout`.
  This project only uses `console.error`; check any fork / patch you made.
- **500 on image upload** — You're over PHP's `upload_max_filesize` /
  `post_max_size`, or WordPress ran out of memory during thumbnail
  generation.

## Security notes

- Use a dedicated Editor-role account, not an Administrator.
- New posts are always `status: "draft"`. `update_post` and
  `delete_draft_post` refuse non-draft targets as a second line of defence.
- `WP_API_URL` must start with `https://` — the server refuses to start
  against plain HTTP.
- Never hardcode secrets. The Application Password belongs in `env` /
  secret managers, not in source.

See [SECURITY.md](./SECURITY.md) for vulnerability reporting.

## License

[MIT License](./LICENSE)
