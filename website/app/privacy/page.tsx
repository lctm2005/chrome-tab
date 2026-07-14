import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../site-shell";

export const metadata: Metadata = { title: "Privacy", description: "How Space Tabs handles workspace data, BYOK credentials, and page content." };

export default function PrivacyPage() {
  return (
    <div className="site-frame legal-page"><SiteHeader /><main className="legal-wrap">
      <p className="eyebrow"><span /> Plain-language privacy</p><h1>Your workspace stays local.<br />{" "}AI goes only where you choose.</h1>
      <p className="legal-updated">Last updated July 13, 2026</p>
      <div className="legal-summary"><article><b>No account</b><span>Core features work without signing in.</span></article><article><b>No telemetry</b><span>Space Tabs does not track product usage.</span></article><article><b>No proxy server</b><span>BYOK requests go directly to your provider.</span></article></div>
      <div className="legal-content">
        <section><h2>Data Space Tabs handles</h2><p>Space Tabs may handle tab titles, URLs, favicons, Chrome tab IDs and group metadata; user-created Spaces, folders, ordering, panel-only names, Ask history, operation records, shortcuts and preferences; and backup or Arc import files you explicitly select.</p><p>For Ask Space, Space Tabs reads up to 12 confirmed live HTTP(S) pages, prioritizing pages you select. Before anything is sent, the review shows the provider, source pages, extracted character count and whether stored text from recent conversation messages will be included. Generated-response Sources appendices are excluded from that conversation context.</p></section>
        <section><h2>Local storage</h2><p>Workspace data and preferences are stored in Chrome extension storage on your device. An optional AI API key is kept in Chrome session storage when available, and is excluded from ordinary workspace state, portable backups and release packages.</p><p>Space Tabs does not require an account, collect telemetry, operate hosted sync, or run a persistent content script on every website.</p></section>
        <section><h2>Network requests</h2><p>Core organization, migration, export, restore and tab management work locally. Ask discloses source content and any stored text from recent conversation messages before sending; generated-response Sources appendices are not sent as conversation context. Tidy Names and Auto Group disclose the provider, exact tabs, full URLs and metadata fields before generating a proposal; a separate review controls whether that proposal is applied. Confirmed AI data goes directly to the endpoint you configured, with your API key as an authorization credential.</p><p>Space Tabs does not proxy those requests through a Space Tabs server and does not sell or share data for advertising.</p></section>
        <section><h2>Permissions</h2><ul><li><b>Side panel:</b> shows the product beside your browser tabs.</li><li><b>Tabs and tab groups:</b> lists, switches, groups and restores tabs for explicit Space actions.</li><li><b>Storage:</b> saves local Spaces, settings and recovery records.</li><li><b>Scripting:</b> reads confirmed page sources only after a user starts Ask Space.</li><li><b>Optional website access:</b> requested only for confirmed Ask source origins and the selected AI endpoint at the action that needs them.</li></ul></section>
        <section><h2>Your control</h2><p>You can clear the API key in Settings, export a complete portable backup, restore a chosen backup, undo supported import and organization operations, or remove all local extension data by uninstalling Space Tabs or clearing its Chrome storage.</p><p>Exported files can contain personal workspace URLs and Ask history. You decide where they are stored or shared.</p></section>
        <section><h2>Contact</h2><p>For privacy questions or data requests, email <a href="mailto:lctm2005@gmail.com">lctm2005@gmail.com</a>.</p></section>
      </div>
    </main><SiteFooter /></div>
  );
}
