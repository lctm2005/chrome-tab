import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../site-shell";

export const metadata: Metadata = { title: "Support", description: "Setup, Arc migration, Ask Space, backup, and troubleshooting for Space Tabs." };

const faqs = [
  ["Why are there three setup steps?", "Choose how to start, bring data by creating a Space or selecting an Arc file, then review the ready screen. The Arc path includes selectable import, conflict preview, backup and import Undo."],
  ["What Arc file do I choose?", "Choose a copy of Arc’s StorableSidebar.json. Space Tabs reads it locally to build a preview; it does not modify the original file. Keep the original somewhere safe."],
  ["Why can’t Ask Space read a page?", "Ask Space uses up to 12 confirmed live HTTP(S) pages in the current Space, prioritizing pages you select. Chrome internal pages, extension pages, closed saved tabs and pages that block script access cannot be sources. Open the saved page, reload it if needed, then select it and try again."],
  ["What does Ask send?", "Before sending, the review shows the provider, exact source pages, character count, truncation state and whether stored text from recent conversation messages is included. Generated-response Sources appendices are not sent as conversation context. Only after confirmation does content go directly to your configured provider."],
  ["Will Auto Group erase old Tags?", "No. Eligible live and dormant saved HTTP(S) tabs are included in the proposal. Pinned or restricted tabs and empty historical Tags are explicitly listed as untouched. Applied changes create an operation record with Undo."],
  ["What is the difference between Tidy and Auto Group?", "Tidy Names shortens panel-only labels for live tabs and keeps them in place. Auto Group proposes topic groups for eligible live and dormant tabs. Both disclose tab metadata before AI generation, show a second review before applying, and support Undo."],
  ["Why was an import or restore stopped as too large?", "Space Tabs checks the normalized workspace against an 8 MB Chrome-storage safety budget before writing. Reduce the selected Arc Spaces or saved tabs and try again. A rejected import or restore leaves the existing workspace unchanged."],
];

export default function SupportPage() {
  return (
    <div className="site-frame support-page"><SiteHeader /><main>
      <section className="support-hero section-wrap"><p className="eyebrow"><span /> Support</p><h1>Get your Arc workflow<br />{" "}settled in Chrome.</h1><p>Start with the shortest path below. If something still feels wrong, send the exact step, expected result, and a screenshot—never an API key or private backup.</p><a href="mailto:lctm2005@gmail.com?subject=Space%20Tabs%20support">Email support</a></section>
      <section className="quick-start section-wrap"><h2>Quick start</h2><div className="quick-grid"><article><span>1</span><h3>Open Workbench</h3><p>Choose Start fresh or Move from Arc in the visible first-run setup.</p></article><article><span>2</span><h3>Review before import</h3><p>Select Spaces and inspect names, conflicts, folder counts and saved tab counts.</p></article><article><span>3</span><h3>Keep an escape hatch</h3><p>Export a backup from the ready screen or Settings. Use Undo if the latest import is not right.</p></article></div></section>
      <section className="faq-section section-wrap"><div><p className="eyebrow"><span /> Common questions</p><h2>Answers before<br />troubleshooting.</h2></div><div className="faq-list">{faqs.map(([question, answer], index) => <details key={question} open={index === 0}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div></section>
      <section className="support-contact section-wrap"><div><h2>Still stuck?</h2><p>Include your Chrome version, Space Tabs version, the workflow you followed, and what happened. Redact private URLs and never attach API keys.</p></div><a href="mailto:lctm2005@gmail.com?subject=Space%20Tabs%20support">lctm2005@gmail.com</a></section>
    </main><SiteFooter /></div>
  );
}
