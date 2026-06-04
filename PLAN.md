# pi-web-tools plan

## Goal

Replace the current `pi-web-access` dependency with a small, synchronous pi package owned under `github.com/shooln/pi-web-tools`.

## Requirements

- Remove/disable `pi-web-access` from the global pi package setup.
- Avoid background `pi.sendMessage(..., triggerTurn: true)` patterns that can corrupt Anthropic tool-use/tool-result pairing.
- Provide online search, page fetching/extraction, and bounded crawling.
- Work as a pi package via local path now and git/npm later.

## Implementation steps

1. Create a git-ready pi package in `~/src/pi-web-tools`.
2. Implement extension tools:
   - `web_search`: Brave Search when `BRAVE_SEARCH_API_KEY` is present, otherwise DuckDuckGo HTML fallback.
   - `fetch_content`: Fetch one or more URLs and extract readable Markdown/text.
   - `web_crawl`: Bounded same-origin/default crawl with depth/page limits.
   - `get_search_content`: Retrieve content from results stored during this pi session.
3. Add package dependencies already confirmed in the existing web package stack.
4. Wire the local package into `~/.pi/agent/settings.json` and remove `npm:pi-web-access`.
5. Uninstall `pi-web-access` from `~/.pi/agent/npm`.
6. Run install and lightweight tests.

## Open questions

- Whether to push/create `github.com/shooln/pi-web-tools` from this machine after local validation.
