import assert from "node:assert/strict";
import test from "node:test";
import webToolsExtension from "../extensions/index.ts";

test("registers web tools and fetches example.com", async () => {
  const tools = new Map<string, any>();
  const pi = {
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    appendEntry() {},
    on() {},
  };

  webToolsExtension(pi as any);

  for (const name of ["internet_search", "fetch_content", "web_crawl", "get_search_content"]) {
    assert.ok(tools.has(name), `${name} should be registered`);
  }

  const result = await tools.get("fetch_content").execute(
    "test-fetch",
    { url: "https://example.com", maxChars: 2_000, timeoutMs: 15_000 },
    undefined,
  );

  const text = result.content?.[0]?.text || "";
  assert.match(text, /Example Domain/i);
  assert.ok(result.details.id.startsWith("fetch_"));
});
