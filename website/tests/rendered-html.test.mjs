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
  assert.match(html, /Choose StorableSidebar\.json for each import/i);
  assert.match(html, /final step has one Save action/i);
  assert.match(html, /leave the provider unselected to continue without AI/i);
  assert.match(html, /Tidy Names uses your configured provider when available/i);
  assert.match(html, /falls back to local naming rules without sending tab metadata/i);
  assert.match(html, /Auto Group requires configured AI/i);
  assert.match(html, /one final preview/i);
  assert.match(html, /tabs and Tags do not change until you choose Apply/i);
  assert.match(html, /Ask Page reads only the current HTTP\(S\) page when you send/i);
  assert.match(html, /exact page/i);
  assert.match(html, /extracted character count/i);
  assert.match(html, /clickable link to the single source page/i);
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
  assert.doesNotMatch(html, /authorize (?:an )?Arc file once|remembers? the (?:approved )?(?:local )?file|reuse(?:s|d)? (?:that|the) (?:local )?file/i);
});

test("renders a privacy page that matches the extension data path", async () => {
  const html = await htmlFor("/privacy");
  assert.match(html, /<title>Privacy · Space Tabs<\/title>/i);
  assert.match(html, /No proxy server/);
  assert.match(html, /Ask Page, Space Tabs reads only the current HTTP\(S\) page/i);
  assert.match(html, /stored text from recent conversation messages/i);
  assert.match(html, /source links are excluded from that conversation context/i);
  assert.match(html, /Chrome session storage/);
  assert.match(html, /does not require an account, collect telemetry/i);
  assert.match(html, /manually choose StorableSidebar\.json/i);
  assert.match(html, /does not persist the source file or a reusable file handle/i);
  assert.match(html, /Saved local file URLs may be stored and restored/i);
  assert.match(html, /file:\/\/\/\*/i);
  assert.match(html, /Allow access to file URLs/i);
  assert.match(html, /does not read the file(?:&apos;|&#x27;|')s contents/i);
  assert.match(html, /Tidy Names uses the configured provider when available/i);
  assert.match(html, /falls back to local naming rules without sending tab metadata/i);
  assert.match(html, /Auto Group requires configured AI/i);
  assert.match(html, /until you review that preview and choose Apply/i);
});

test("renders support for Arc setup, Ask Page, and historical Tags", async () => {
  const html = await htmlFor("/support");
  assert.match(html, /<title>Support · Space Tabs<\/title>/i);
  assert.match(html, /Why are there two setup steps/);
  assert.match(html, /StorableSidebar\.json/);
  assert.match(html, /review optional BYOK AI settings and choose Save/i);
  assert.match(html, /leave the provider unselected to finish without AI/i);
  assert.match(html, /for each import/i);
  assert.match(html, /does not persist a reusable file handle/i);
  assert.match(html, /Why can’t Ask Page read this page/);
  assert.match(html, /reads only the current HTTP\(S\) page when you send/i);
  assert.match(html, /Responses stream, can be stopped/i);
  assert.match(html, /clickable link to that single source page/i);
  assert.match(html, /source links are not sent back as conversation context/i);
  assert.match(html, /Will Auto Group erase old Tags/);
  assert.match(html, /8 MB Chrome-storage safety budget/);
  assert.match(html, /there is no intermediate confirmation/i);
  assert.match(html, /mailto:lctm2005@gmail.com\?subject=Space%20Tabs%20support/);
  assert.doesNotMatch(html, /Ask Space|Not now|up to 12 confirmed live HTTP\(S\) pages/i);
});

test("uses site-specific metadata and project assets", async () => {
  const html = await htmlFor("/");
  assert.match(html, /<title>Space Tabs: Arc-like Spaces &amp; BYOK AI — Keep Chrome\. Bring your Arc workflow\.<\/title>/i);
  assert.match(html, /property="og:image" content="http:\/\/localhost(?::3000)?\/og\.png"/i);
  assert.match(html, /href="(?:http:\/\/localhost(?::3000)?)?\/icon\.png"/i);
  assert.doesNotMatch(html, /Starter Project|favicon\.svg/i);
});
