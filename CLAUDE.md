# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a remote MCP (Model Context Protocol) server deployed on Cloudflare Workers with OAuth authentication. The server provides image generation capabilities using Cloudflare AI's Flux 1 Schnell model, accessible by Claude Desktop and other MCP clients over HTTP/SSE.

## Development Commands

```bash
# Install dependencies (using pnpm)
pnpm install

# Run locally
npm run dev
# or
npx wrangler dev

# Format code
npm run format

# Fix linting issues
npm run lint:fix

# Deploy to Cloudflare
npm run deploy

# Generate TypeScript types for Cloudflare
npm run cf-typegen
```

## Architecture

### Core Components

1. **MCP Server** (`src/index.ts`):
   - Uses `McpAgent` from the `agents` package to create a durable object
   - Implements image generation using Cloudflare AI's Flux 1 Schnell
   - Provides the `generate_image` tool
   - Mounts at `/sse` endpoint for SSE connections

2. **OAuth Provider** (`src/index.ts`):
   - Uses `@cloudflare/workers-oauth-provider` for OAuth2 authentication
   - Handles authorization flow at `/authorize`, `/approve`, and `/token` endpoints
   - Stores OAuth data in KV namespace (`OAUTH_KV`)

3. **Web Application** (`src/app.ts`):
   - Hono-based web application for OAuth authorization UI
   - Renders login and authorization approval screens
   - Handles OAuth flow redirects

4. **Utilities** (`src/utils.ts`):
   - HTML layout and rendering helpers
   - OAuth form parsing utilities
   - Markdown rendering for documentation

### Cloudflare Resources

- **Durable Objects**: `MyMCP` class for stateful MCP server instances
- **KV Namespace**: `OAUTH_KV` for OAuth session storage
- **AI Binding**: `AI` for accessing Cloudflare AI models
- **R2 Bucket**: `IMAGE_BUCKET` for storing generated images
- **Static Assets**: Served from `/static` directory

### AI Integration

- Uses `@cf/black-forest-labs/flux-1-schnell` model
- Optimized for fast, high-quality generation
- Supports customizable diffusion steps
- Returns both base64-encoded JPEG images and hosted URLs
- Minimum 4 diffusion steps for quality
- Includes error handling for AI service failures

### R2 Image Storage

- Generated images are stored in R2 bucket
- Images served via `/images/[filename]` route
- Long-term caching with Cache-Control headers
- URLs follow the pattern: `https://[worker-domain]/images/[timestamp]-[random-id].jpeg`
- Images are directly accessible without authentication

## Testing & Debugging

### Local Testing with MCP Inspector
1. Run server locally: `npm run dev`
2. Start MCP Inspector: `npx @modelcontextprotocol/inspector`
3. Connect to `http://localhost:8787/sse` using SSE transport
4. Authenticate with any email/password (demo accepts all)

### Debugging Tips
- Clear MCP auth files if needed: `rm -rf ~/.mcp-auth`
- Test direct connection: `npx mcp-remote http://localhost:8787/sse`
- Check Cloudflare logs for deployment issues

## Code Style

- Uses Biome for formatting and linting
- Indent width: 4 spaces
- Line width: 100 characters
- TypeScript strict mode enabled
- Ignores common linting rules: `noExplicitAny`, `noDebugger`, `noConsoleLog`

## Deployment Notes

1. Create KV namespace before first deploy: `npx wrangler kv namespace create OAUTH_KV`
2. Update KV namespace ID in `wrangler.jsonc`
3. Deploy with: `npm run deploy`
4. Access at: `https://[worker-name].[account-name].workers.dev`