# pi-web-tools

Synchronous web tools for [pi](https://pi.dev): search, fetch, and bounded crawling.

This package avoids background `pi.sendMessage(..., triggerTurn: true)` patterns. Each operation completes inside the tool call that requested it, which keeps provider tool-use/tool-result message pairing simple.

## Tools

- `web_search` — online search. Uses Brave Search if `BRAVE_SEARCH_API_KEY` is set; otherwise falls back to DuckDuckGo HTML search.
- `fetch_content` — fetch one or more URLs and extract readable Markdown/text.
- `web_crawl` — bounded crawl from a start URL with `maxPages`, `maxDepth`, and same-origin defaults.
- `get_search_content` — retrieve content from a previous result ID stored in the current pi session.

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

## Notes

- Search with Brave requires `BRAVE_SEARCH_API_KEY`.
- DuckDuckGo fallback does not require an API key but can be rate-limited like any HTML search endpoint.
- Crawling is intentionally bounded; defaults are conservative.
