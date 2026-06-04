# pi-web-tools

Synchronous web tools for [pi](https://pi.dev): search, fetch, and bounded crawling.

This package avoids background `pi.sendMessage(..., triggerTurn: true)` patterns. Each operation completes inside the tool call that requested it, which keeps provider tool-use/tool-result message pairing simple.

## Tools

- `web_search` — online search. Uses Brave Search if `BRAVE_SEARCH_API_KEY` is set; otherwise falls back to DuckDuckGo HTML search.
- `fetch_content` — fetch one or more URLs and extract readable Markdown/text.
- `web_crawl` — bounded crawl from a start URL with `maxPages`, `maxDepth`, and same-origin defaults.
- `get_search_content` — retrieve content from a previous result ID stored in the current pi session.

## Usage

Once installed and reloaded, the tools are available to the agent automatically. Below are the parameters for each tool.

### `web_search`

| Param | Type | Description |
|-------|------|-------------|
| `query` | string (required) | Search query. |
| `provider` | `"auto"` \| `"brave"` \| `"duckduckgo"` | Force a provider. Default `auto` (Brave if key present, else DuckDuckGo). |
| `maxResults` | number | Maximum results to return (1–20). |
| `fetchResults` | boolean | Fetch and extract each result page before returning. Adds network requests. |
| `maxCharsPerResult` | number | Cap extracted characters per fetched result. |

```jsonc
{ "query": "typebox optional union", "maxResults": 5 }
```

### `fetch_content`

| Param | Type | Description |
|-------|------|-------------|
| `url` | string | A single URL to fetch. |
| `urls` | string[] | Multiple URLs to fetch. |
| `maxChars` | number | Maximum extracted characters per URL. |
| `timeoutMs` | number | Per-URL timeout in milliseconds. |
| `includeLinks` | boolean | Include extracted links in the result details. |

Provide either `url` or `urls`.

```jsonc
{ "url": "https://example.com", "maxChars": 2000 }
```

### `web_crawl`

| Param | Type | Description |
|-------|------|-------------|
| `url` | string (required) | Starting URL. |
| `maxPages` | number | Maximum pages to crawl (1–50). |
| `maxDepth` | number | Maximum link depth (0–3). |
| `sameOrigin` | boolean | Restrict crawl to the starting URL's origin. |
| `includePatterns` | string[] | Only crawl URLs containing one of these substrings. |
| `excludePatterns` | string[] | Skip URLs containing these substrings. |
| `maxCharsPerPage` | number | Maximum extracted characters per page. |
| `timeoutMs` | number | Per-page timeout in milliseconds. |

```jsonc
{ "url": "https://example.com/docs", "maxPages": 10, "maxDepth": 2, "sameOrigin": true }
```

### `get_search_content`

Retrieve content stored from a previous `web_search` / `fetch_content` / `web_crawl` call (results are cached per pi session and referenced by `responseId`).

| Param | Type | Description |
|-------|------|-------------|
| `responseId` | string (required) | Response ID returned by an earlier web tool. |
| `url` | string | Specific URL to retrieve from the stored response. |
| `urlIndex` | number | Zero-based URL/result index to retrieve. |

```jsonc
{ "responseId": "fetch_abc123", "urlIndex": 0 }
```

## Local install

The current machine is configured in `~/.pi/agent/settings.json` with:

```json
"/Users/shoolin/src/pi-web-tools"
```

Reload pi after changes:

```text
/reload
```

## Git install later

After pushing this repo to GitHub, replace the local path in pi settings with:

```json
"git:github.com/shooln/pi-web-tools"
```

or run:

```bash
pi install git:github.com/shooln/pi-web-tools
```

## Development

```bash
npm install --omit=peer --registry=https://registry.npmjs.org
npm run check
npm test
```

## Environment

| Variable | Purpose |
|----------|---------|
| `BRAVE_SEARCH_API_KEY` | Enables Brave Search for `web_search`. Without it, search falls back to DuckDuckGo HTML. |

## Notes

- Search with Brave requires `BRAVE_SEARCH_API_KEY`.
- DuckDuckGo fallback does not require an API key but can be rate-limited like any HTML search endpoint.
- Crawling is intentionally bounded; defaults are conservative.
- All operations are synchronous: each tool completes within its own call, avoiding background `sendMessage` patterns that can corrupt provider tool-use/tool-result pairing.

## License

MIT
