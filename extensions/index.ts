import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { Type } from "typebox";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; pi-web-tools/0.1; +https://github.com/shooln/pi-web-tools)";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_CHARS = 20_000;
const DEFAULT_MAX_RESULTS = 5;
const MAX_FETCH_URLS = 10;
const MAX_CRAWL_PAGES = 50;
const MAX_CRAWL_DEPTH = 3;

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

type SearchProvider = "auto" | "brave" | "duckduckgo";

type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
  content?: ExtractedContent;
};

type ExtractedContent = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title?: string;
  excerpt?: string;
  byline?: string;
  markdown: string;
  text: string;
  links?: string[];
  truncated: boolean;
  error?: string;
};

type StoredResult = {
  id: string;
  type: "search" | "fetch" | "crawl";
  timestamp: number;
  query?: string;
  urls?: string[];
  results?: SearchResult[];
  pages?: ExtractedContent[];
  errors?: string[];
};

const store = new Map<string, StoredResult>();

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function generateId(prefix = "web"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n\n[truncated at ${maxChars} chars]`,
    truncated: true,
  };
}

function assertHttpUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are supported: ${rawUrl}`);
  }
  return url;
}

function makeAbortSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  timeout.unref?.();
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason);
    else parent.addEventListener("abort", () => controller.abort(parent.reason), { once: true });
  }
  controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
  return controller.signal;
}

function absolutizeUrl(rawUrl: string, baseUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function decodeDuckDuckGoRedirect(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : parsed.toString();
  } catch {
    return rawUrl;
  }
}

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const { document } = parseHTML(html);
  const links = new Set<string>();
  for (const anchor of Array.from(document.querySelectorAll("a"))) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    const absolute = absolutizeUrl(href, baseUrl);
    if (absolute) links.add(absolute);
  }
  return [...links];
}

function htmlToExtractedContent(
  html: string,
  url: string,
  finalUrl: string,
  status: number,
  contentType: string,
  maxChars: number,
  includeLinks: boolean,
): ExtractedContent {
  const { document } = parseHTML(html);
  const article = new Readability(document as unknown as Document).parse();
  const rawTitle = article?.title || document.querySelector("title")?.textContent || undefined;
  const title = rawTitle ? normalizeWhitespace(rawTitle) : undefined;
  const htmlContent = article?.content || document.body?.innerHTML || html;
  const markdownRaw = normalizeWhitespace(turndown.turndown(htmlContent));
  const textRaw = normalizeWhitespace(article?.textContent || document.body?.textContent || markdownRaw);
  const markdown = truncateText(markdownRaw, maxChars);
  const text = truncateText(textRaw, maxChars);

  return {
    url,
    finalUrl,
    status,
    contentType,
    title,
    excerpt: article?.excerpt ? normalizeWhitespace(article.excerpt) : undefined,
    byline: article?.byline ? normalizeWhitespace(article.byline) : undefined,
    markdown: markdown.text,
    text: text.text,
    links: includeLinks ? extractLinksFromHtml(html, finalUrl) : undefined,
    truncated: markdown.truncated || text.truncated,
  };
}

async function fetchExtractedContent(
  rawUrl: string,
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    maxChars: number;
    includeLinks?: boolean;
    userAgent?: string;
  },
): Promise<ExtractedContent> {
  const url = assertHttpUrl(rawUrl);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: makeAbortSignal(options.signal, options.timeoutMs),
      headers: {
        "user-agent": options.userAgent || DEFAULT_USER_AGENT,
        accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    const finalUrl = response.url || url.toString();
    const body = await response.text();

    if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml") || body.trimStart().startsWith("<")) {
      return htmlToExtractedContent(
        body,
        url.toString(),
        finalUrl,
        response.status,
        contentType,
        options.maxChars,
        options.includeLinks ?? false,
      );
    }

    const normalized = normalizeWhitespace(body);
    const truncated = truncateText(normalized, options.maxChars);
    return {
      url: url.toString(),
      finalUrl,
      status: response.status,
      contentType,
      title: finalUrl,
      markdown: truncated.text,
      text: truncated.text,
      links: undefined,
      truncated: truncated.truncated,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      url: url.toString(),
      finalUrl: url.toString(),
      status: 0,
      contentType: "",
      markdown: "",
      text: "",
      truncated: false,
      error: message,
    };
  }
}

async function searchDuckDuckGo(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(`https://html.duckduckgo.com/html/?${params.toString()}`, {
    method: "GET",
    signal: makeAbortSignal(signal, DEFAULT_TIMEOUT_MS),
    headers: {
      "user-agent": DEFAULT_USER_AGENT,
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`DuckDuckGo returned HTTP ${response.status}`);
  const html = await response.text();
  const { document } = parseHTML(html);
  const results: SearchResult[] = [];

  for (const row of Array.from(document.querySelectorAll(".result"))) {
    if (results.length >= maxResults) break;
    const anchor = row.querySelector(".result__a") || row.querySelector("a");
    const title = normalizeWhitespace(anchor?.textContent || "");
    const href = anchor?.getAttribute("href");
    if (!title || !href) continue;
    const snippet = normalizeWhitespace(row.querySelector(".result__snippet")?.textContent || "");
    const decoded = decodeDuckDuckGoRedirect(href);
    const absolute = absolutizeUrl(decoded, "https://duckduckgo.com/");
    if (!absolute) continue;
    results.push({ title, url: absolute, snippet: snippet || undefined });
  }

  return results;
}

async function searchBrave(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const token = process.env.BRAVE_SEARCH_API_KEY;
  if (!token) throw new Error("BRAVE_SEARCH_API_KEY is not set");
  const params = new URLSearchParams({ q: query, count: String(maxResults) });
  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
    signal: makeAbortSignal(signal, DEFAULT_TIMEOUT_MS),
    headers: {
      accept: "application/json",
      "x-subscription-token": token,
      "user-agent": DEFAULT_USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`Brave Search returned HTTP ${response.status}`);
  const payload = await response.json() as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return (payload.web?.results || [])
    .filter((result) => result.title && result.url)
    .slice(0, maxResults)
    .map((result) => ({
      title: normalizeWhitespace(result.title || ""),
      url: result.url || "",
      snippet: result.description ? normalizeWhitespace(result.description) : undefined,
    }));
}

async function runSearch(query: string, provider: SearchProvider, maxResults: number, signal?: AbortSignal): Promise<{ provider: string; results: SearchResult[] }> {
  if (provider === "brave") {
    return { provider: "brave", results: await searchBrave(query, maxResults, signal) };
  }
  if (provider === "duckduckgo") {
    return { provider: "duckduckgo", results: await searchDuckDuckGo(query, maxResults, signal) };
  }

  if (process.env.BRAVE_SEARCH_API_KEY) {
    try {
      return { provider: "brave", results: await searchBrave(query, maxResults, signal) };
    } catch {
      // Fall through to DuckDuckGo so search still works without paid API reliability.
    }
  }
  return { provider: "duckduckgo", results: await searchDuckDuckGo(query, maxResults, signal) };
}

function formatSearchResults(query: string, provider: string, id: string, results: SearchResult[]): string {
  const lines = [`# Search results for: ${query}`, "", `Provider: ${provider}`, `Response ID: ${id}`, ""];
  for (const [index, result] of results.entries()) {
    lines.push(`## ${index + 1}. ${result.title}`);
    lines.push(result.url);
    if (result.snippet) lines.push(`\n${result.snippet}`);
    if (result.content?.markdown) lines.push(`\n### Fetched content\n\n${result.content.markdown}`);
    lines.push("");
  }
  if (results.length === 0) lines.push("No results found.");
  return lines.join("\n");
}

function formatPages(title: string, id: string, pages: ExtractedContent[]): string {
  const lines = [`# ${title}`, "", `Response ID: ${id}`, ""];
  for (const [index, page] of pages.entries()) {
    lines.push(`## ${index + 1}. ${page.title || page.finalUrl}`);
    lines.push(page.finalUrl);
    lines.push(`Status: ${page.status}${page.contentType ? ` (${page.contentType})` : ""}`);
    if (page.error) {
      lines.push(`\nError: ${page.error}`);
    } else if (page.markdown) {
      lines.push(`\n${page.markdown}`);
    } else {
      lines.push("\nNo extractable text content found.");
    }
    lines.push("");
  }
  return lines.join("\n");
}

function remember(pi: ExtensionAPI, result: StoredResult): void {
  store.set(result.id, result);
  pi.appendEntry("pi-web-tools-result", result);
}

function restoreFromSession(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== "pi-web-tools-result") continue;
      const data = entry.data as StoredResult | undefined;
      if (data?.id) store.set(data.id, data);
    }
  });
}

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      output[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return output;
}

function normalizeUrlList(params: Record<string, unknown>): string[] {
  const urls = Array.isArray(params.urls) ? params.urls.filter((url): url is string => typeof url === "string") : [];
  const single = asString(params.url);
  const combined = single ? [single, ...urls] : urls;
  return [...new Set(combined.map((url) => url.trim()).filter(Boolean))].slice(0, MAX_FETCH_URLS);
}

function matchesPatterns(url: string, includePatterns: string[], excludePatterns: string[]): boolean {
  if (includePatterns.length > 0 && !includePatterns.some((pattern) => url.includes(pattern))) return false;
  if (excludePatterns.some((pattern) => url.includes(pattern))) return false;
  return true;
}

async function crawl(
  startUrl: string,
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    maxChars: number;
    maxPages: number;
    maxDepth: number;
    sameOrigin: boolean;
    includePatterns: string[];
    excludePatterns: string[];
  },
): Promise<{ pages: ExtractedContent[]; errors: string[] }> {
  const root = assertHttpUrl(startUrl);
  const seen = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: root.toString(), depth: 0 }];
  const pages: ExtractedContent[] = [];
  const errors: string[] = [];

  while (queue.length > 0 && pages.length < options.maxPages) {
    if (options.signal?.aborted) break;
    const item = queue.shift();
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    if (!matchesPatterns(item.url, options.includePatterns, options.excludePatterns)) continue;

    const page = await fetchExtractedContent(item.url, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      maxChars: options.maxChars,
      includeLinks: item.depth < options.maxDepth,
    });
    pages.push(page);
    if (page.error) errors.push(`${item.url}: ${page.error}`);

    if (item.depth >= options.maxDepth || !page.links) continue;
    for (const link of page.links) {
      if (seen.has(link)) continue;
      const parsed = new URL(link);
      if (options.sameOrigin && parsed.origin !== root.origin) continue;
      if (!matchesPatterns(link, options.includePatterns, options.excludePatterns)) continue;
      queue.push({ url: link, depth: item.depth + 1 });
    }
  }

  return { pages, errors };
}

export default function webToolsExtension(pi: ExtensionAPI) {
  restoreFromSession(pi);

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web synchronously. Uses Brave Search when BRAVE_SEARCH_API_KEY is set, otherwise DuckDuckGo HTML search.",
    promptSnippet: "Search the web and optionally fetch top-result page content synchronously.",
    promptGuidelines: [
      "Use web_search for online information lookup; pass fetchResults=true only when page content is needed because it makes additional network requests.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      provider: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("brave"), Type.Literal("duckduckgo")], { description: "Search provider" })),
      maxResults: Type.Optional(Type.Number({ description: "Maximum results to return (1-20)" })),
      fetchResults: Type.Optional(Type.Boolean({ description: "Fetch and extract each result page before returning" })),
      maxCharsPerResult: Type.Optional(Type.Number({ description: "Maximum extracted characters per fetched result" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const query = asString(params.query);
      if (!query) throw new Error("query is required");
      const provider = (asString(params.provider) || "auto") as SearchProvider;
      const maxResults = asNumber(params.maxResults, DEFAULT_MAX_RESULTS, 1, 20);
      const fetchResults = asBoolean(params.fetchResults, false);
      const maxCharsPerResult = asNumber(params.maxCharsPerResult, 4_000, 500, 30_000);

      onUpdate?.({ content: [{ type: "text", text: `Searching ${provider} for: ${query}` }] });
      const searched = await runSearch(query, provider, maxResults, signal);
      let results = searched.results;

      if (fetchResults && results.length > 0) {
        onUpdate?.({ content: [{ type: "text", text: `Fetching ${results.length} result pages...` }] });
        const fetched = await mapWithLimit(results, 3, async (result) => ({
          ...result,
          content: await fetchExtractedContent(result.url, {
            signal,
            timeoutMs: DEFAULT_TIMEOUT_MS,
            maxChars: maxCharsPerResult,
          }),
        }));
        results = fetched;
      }

      const id = generateId("search");
      const stored: StoredResult = { id, type: "search", timestamp: Date.now(), query, results };
      remember(pi, stored);
      return {
        content: [{ type: "text", text: formatSearchResults(query, searched.provider, id, results) }],
        details: stored,
      };
    },
  });

  pi.registerTool({
    name: "fetch_content",
    label: "Fetch Content",
    description: "Fetch one or more web pages and extract readable Markdown/text synchronously.",
    promptSnippet: "Fetch and extract readable content from URLs.",
    promptGuidelines: ["Use fetch_content when the user gives URL(s) or asks to read a web page."],
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
      urls: Type.Optional(Type.Array(Type.String(), { description: "URLs to fetch" })),
      maxChars: Type.Optional(Type.Number({ description: "Maximum extracted characters per URL" })),
      timeoutMs: Type.Optional(Type.Number({ description: "Timeout per URL in milliseconds" })),
      includeLinks: Type.Optional(Type.Boolean({ description: "Include extracted links in details" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const urls = normalizeUrlList(params as Record<string, unknown>);
      if (urls.length === 0) throw new Error("Provide url or urls");
      const maxChars = asNumber(params.maxChars, DEFAULT_MAX_CHARS, 500, 100_000);
      const timeoutMs = asNumber(params.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
      const includeLinks = asBoolean(params.includeLinks, false);

      onUpdate?.({ content: [{ type: "text", text: `Fetching ${urls.length} URL(s)...` }] });
      const pages = await mapWithLimit(urls, 3, (url) =>
        fetchExtractedContent(url, { signal, timeoutMs, maxChars, includeLinks }),
      );
      const id = generateId("fetch");
      const stored: StoredResult = { id, type: "fetch", timestamp: Date.now(), urls, pages };
      remember(pi, stored);
      return {
        content: [{ type: "text", text: formatPages("Fetched content", id, pages) }],
        details: stored,
      };
    },
  });

  pi.registerTool({
    name: "web_crawl",
    label: "Web Crawl",
    description: "Crawl pages from a starting URL with strict depth/page limits and extract readable content.",
    promptSnippet: "Crawl a small bounded set of pages starting from a URL.",
    promptGuidelines: [
      "Use web_crawl only for bounded crawling; keep maxPages and maxDepth small unless the user asks for broader crawling.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "Starting URL" }),
      maxPages: Type.Optional(Type.Number({ description: "Maximum pages to crawl (1-50)" })),
      maxDepth: Type.Optional(Type.Number({ description: "Maximum link depth (0-3)" })),
      sameOrigin: Type.Optional(Type.Boolean({ description: "Restrict crawl to the starting URL origin" })),
      includePatterns: Type.Optional(Type.Array(Type.String(), { description: "Only crawl URLs containing one of these substrings" })),
      excludePatterns: Type.Optional(Type.Array(Type.String(), { description: "Skip URLs containing these substrings" })),
      maxCharsPerPage: Type.Optional(Type.Number({ description: "Maximum extracted characters per page" })),
      timeoutMs: Type.Optional(Type.Number({ description: "Timeout per page in milliseconds" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const url = asString(params.url);
      if (!url) throw new Error("url is required");
      const maxPages = asNumber(params.maxPages, 10, 1, MAX_CRAWL_PAGES);
      const maxDepth = asNumber(params.maxDepth, 1, 0, MAX_CRAWL_DEPTH);
      const sameOrigin = asBoolean(params.sameOrigin, true);
      const maxChars = asNumber(params.maxCharsPerPage, 8_000, 500, 50_000);
      const timeoutMs = asNumber(params.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
      const includePatterns = Array.isArray(params.includePatterns) ? params.includePatterns.filter((item): item is string => typeof item === "string") : [];
      const excludePatterns = Array.isArray(params.excludePatterns) ? params.excludePatterns.filter((item): item is string => typeof item === "string") : [];

      onUpdate?.({ content: [{ type: "text", text: `Crawling ${url} (maxPages=${maxPages}, maxDepth=${maxDepth})...` }] });
      const { pages, errors } = await crawl(url, {
        signal,
        timeoutMs,
        maxChars,
        maxPages,
        maxDepth,
        sameOrigin,
        includePatterns,
        excludePatterns,
      });
      const id = generateId("crawl");
      const stored: StoredResult = { id, type: "crawl", timestamp: Date.now(), urls: [url], pages, errors };
      remember(pi, stored);
      return {
        content: [{ type: "text", text: formatPages("Crawl results", id, pages) }],
        details: stored,
      };
    },
  });

  pi.registerTool({
    name: "get_search_content",
    label: "Get Stored Web Content",
    description: "Retrieve a previous web_search/fetch_content/web_crawl response by responseId.",
    promptSnippet: "Retrieve stored web tool results by responseId.",
    promptGuidelines: ["Use get_search_content when a prior web tool response ID needs to be expanded or revisited."],
    parameters: Type.Object({
      responseId: Type.String({ description: "Response ID returned by web_search, fetch_content, or web_crawl" }),
      url: Type.Optional(Type.String({ description: "Specific URL to retrieve from the stored response" })),
      urlIndex: Type.Optional(Type.Number({ description: "Zero-based URL/result index to retrieve" })),
    }),
    async execute(_toolCallId, params) {
      const responseId = asString(params.responseId);
      if (!responseId) throw new Error("responseId is required");
      const stored = store.get(responseId);
      if (!stored) throw new Error(`No stored web result found for responseId: ${responseId}`);
      const requestedUrl = asString(params.url);
      const requestedIndex = typeof params.urlIndex === "number" ? Math.floor(params.urlIndex) : undefined;

      if (stored.results) {
        let results = stored.results;
        if (requestedUrl) results = results.filter((result) => result.url === requestedUrl);
        if (requestedIndex !== undefined) results = results[requestedIndex] ? [results[requestedIndex]] : [];
        return {
          content: [{ type: "text", text: formatSearchResults(stored.query || responseId, "stored", responseId, results) }],
          details: { ...stored, results },
        };
      }

      let pages = stored.pages || [];
      if (requestedUrl) pages = pages.filter((page) => page.url === requestedUrl || page.finalUrl === requestedUrl);
      if (requestedIndex !== undefined) pages = pages[requestedIndex] ? [pages[requestedIndex]] : [];
      return {
        content: [{ type: "text", text: formatPages("Stored web content", responseId, pages) }],
        details: { ...stored, pages },
      };
    },
  });
}
