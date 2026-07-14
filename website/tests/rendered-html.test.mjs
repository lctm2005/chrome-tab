import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

async function render(path = "/") {
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function htmlFor(path) {
  const response = await render(path);
  assert.equal(response.status, 200, `${path} should render`);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  return response.text();
}

test("renders the Arc migration and controlled-AI product promise", async () => {
  const html = await htmlFor("/");
  assert.match(html, /Keep Chrome\./);
  assert.match(html, /Bring your Arc workflow\./);
  assert.match(html, /Add private BYOK AI\./);
  assert.match(html, /Selectable Arc import/);
  assert.match(html, /Preview · Confirm · Undo/);
  assert.match(html, /Nothing is sent until you confirm/);
  assert.match(html, /uses up to 12 confirmed live HTTP\(S\) pages/i);
  assert.match(html, /Sources appendices stay out of the context sent to your provider/i);
  assert.match(html, /No telemetry/);
  assert.match(html, /Space Tabs: Arc-like Spaces &amp; BYOK AI/i);
  assert.match(html, /Install from GitHub/i);
  assert.match(html, /github\.com\/lctm2005\/chrome-tab#install-from-source/i);
  for (const screenshot of [
    "01-spaces-overview.png",
    "02-nested-folders-dormant-tabs.png",
    "03-tab-context-menu.png",
    "04-settings-arc-import-shortcuts.png",
    "05-ask-page-byok-ai.png",
  ]) {
    assert.match(html, new RegExp(`/screenshots/${screenshot.replaceAll(".", "\\.")}`, "i"));
  }
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton|Space Tags|\bbeta\b|waitlist/i);
});

test("renders a privacy page that matches the extension data path", async () => {
  const html = await htmlFor("/privacy");
  assert.match(html, /<title>Privacy · Space Tabs<\/title>/i);
  assert.match(html, /No proxy server/);
  assert.match(html, /up to 12 confirmed live HTTP\(S\)/i);
  assert.match(html, /stored text from recent conversation messages/i);
  assert.match(html, /Sources appendices are excluded from that conversation context/i);
  assert.match(html, /Chrome session storage/);
  assert.match(html, /does not require an account, collect telemetry/i);
});

test("renders support for Arc setup, Ask Space, and historical Tags", async () => {
  const html = await htmlFor("/support");
  assert.match(html, /<title>Support · Space Tabs<\/title>/i);
  assert.match(html, /Why are there three setup steps/);
  assert.match(html, /StorableSidebar\.json/);
  assert.match(html, /Why can’t Ask Space read a page/);
  assert.match(html, /up to 12 confirmed live HTTP\(S\) pages/i);
  assert.match(html, /Sources appendices are not sent as conversation context/i);
  assert.match(html, /Will Auto Group erase old Tags/);
  assert.match(html, /8 MB Chrome-storage safety budget/);
  assert.match(html, /mailto:lctm2005@gmail.com\?subject=Space%20Tabs%20support/);
});

test("uses site-specific metadata and project assets", async () => {
  const html = await htmlFor("/");
  assert.match(html, /<title>Space Tabs: Arc-like Spaces &amp; BYOK AI — Keep Chrome\. Bring your Arc workflow\.<\/title>/i);
  assert.match(html, /property="og:image" content="http:\/\/localhost(?::3000)?\/og\.png"/i);
  assert.match(html, /href="(?:http:\/\/localhost(?::3000)?)?\/icon\.png"/i);
  assert.doesNotMatch(html, /Starter Project|favicon\.svg/i);
});
