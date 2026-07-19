import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../site-shell";

export const metadata: Metadata = { title: "Support", description: "Setup, Arc migration, Ask Page, backup, and troubleshooting for Space Tabs." };

const faqs = [
  ["Why are there two setup steps?", "The Space step lets you choose Create new space or Move from Arc, then create or import the workspace. The AI step lets you review optional BYOK AI settings and choose Save. Leave the provider unselected to finish without AI, or complete the provider settings to save them. Cancelling the Arc file picker keeps you on the Space step."],
  ["What Arc file do I select?", "Select Arc’s StorableSidebar.json in the system picker for each import. Space Tabs reads the chosen file locally, never modifies it, and does not persist a reusable file handle."],
  ["Why can’t Ask Page read this page?", "Ask Page reads only the current HTTP(S) page when you send. Chrome internal pages, extension pages, local files, and pages that block script access cannot be read. Switch to a normal HTTP(S) page, reload it if needed, then try again."],
  ["What does Ask Page send?", "When you choose Ask Page, the question, current page content and stored text from recent conversation messages go directly to your configured provider. Selected text is prioritized when present. Responses stream, can be stopped, and include a clickable link to that single source page. Generated-response source links are not sent back as conversation context."],
  ["Will Auto Group erase old Tags?", "No. Eligible live and dormant saved HTTP(S) tabs are included in the proposal. Pinned or restricted tabs and empty historical Tags are explicitly listed as untouched. Applied changes create an operation record with Undo."],
  ["What is the difference between Tidy and Auto Group?", "Tidy Names shortens panel-only labels for live tabs and keeps them in place. It uses your configured provider when available, but falls back to local naming without sending tab metadata when AI is unavailable. Auto Group requires configured AI and proposes topic groups for eligible live and dormant tabs. AI proposals send only the disclosed metadata and generate one final preview; there is no intermediate confirmation. Nothing changes until you choose Apply, and both support Undo."],
  ["Why was an import or restore stopped as too large?", "Space Tabs checks the normalized workspace against an 8 MB Chrome-storage safety budget before writing. Reduce the selected Arc Spaces or saved tabs and try again. A rejected import or restore leaves the existing workspace unchanged."],
];

export default function SupportPage() {
  return (
    <div className="site-frame support-page"><SiteHeader /><main id="main-content" tabIndex={-1}>
      <section className="support-hero section-wrap"><p className="eyebrow"><span /> Support</p><h1>Get your Arc workflow<br />{" "}settled in Chrome.</h1><p>Start with the shortest path below. If something still feels wrong, send the exact step, expected result, and a screenshot—never an API key or private backup.</p><a href="mailto:lctm2005@gmail.com?subject=Space%20Tabs%20support">Email support</a></section>
      <section className="quick-start section-wrap"><h2>Quick start</h2><div className="quick-grid"><article><span>1</span><h3>Set up Space</h3><p>Choose Create new space or Move from Arc, then create the Space or review the selected Arc Spaces before import.</p></article><article><span>2</span><h3>Review AI</h3><p>Review optional BYOK AI settings, then choose Save. Leave the provider unselected to continue without AI, or complete the settings to save them.</p></article></div></section>
      <section className="faq-section section-wrap"><div><p className="eyebrow"><span /> Common questions</p><h2>Answers before<br />troubleshooting.</h2></div><div className="faq-list">{faqs.map(([question, answer], index) => <details key={question} open={index === 0}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
      <section className="support-contact section-wrap"><div><h2>Still stuck?</h2><p>Include your Chrome version, Space Tabs version, the workflow you followed, and what happened. Redact private URLs and never attach API keys.</p></div><a href="mailto:lctm2005@gmail.com?subject=Space%20Tabs%20support">lctm2005@gmail.com</a></section>
    </main><SiteFooter /></div>
  );
}
