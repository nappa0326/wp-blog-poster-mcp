#!/usr/bin/env node
// wp-blog-poster-mcp のエントリポイント。
// 重要: STDIO トランスポート使用時、stdout は JSON-RPC 専用。
//       ログ出力は必ず console.error (stderr) を使うこと。console.log はプロトコルを壊す。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { WordPressClient } from "./wordpress.js";
import { registerCreatePostTool } from "./tools/create-post.js";
import { registerUploadMediaTool } from "./tools/upload-media.js";
import { registerUpdatePostTool } from "./tools/update-post.js";
import { registerListDraftsTool } from "./tools/list-drafts.js";
import { registerDeletePostTool } from "./tools/delete-post.js";
import { registerGetPostTool } from "./tools/get-post.js";
import { registerListPostsTool } from "./tools/list-posts.js";
import { registerListCategoriesTool } from "./tools/list-categories.js";
import { registerListTagsTool } from "./tools/list-tags.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const wp = new WordPressClient(config);

  const server = new McpServer({
    name: "wp-blog-poster",
    version: "0.3.0",
  });

  registerCreatePostTool(server, wp);
  registerUploadMediaTool(server, wp);
  registerUpdatePostTool(server, wp);
  registerListDraftsTool(server, wp);
  registerDeletePostTool(server, wp);
  registerGetPostTool(server, wp);
  registerListPostsTool(server, wp);
  registerListCategoriesTool(server, wp);
  registerListTagsTool(server, wp);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[wp-blog-poster] started on stdio transport");
}

main().catch((err) => {
  console.error("[wp-blog-poster] fatal:", err);
  process.exit(1);
});
