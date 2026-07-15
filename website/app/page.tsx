import Image from "next/image";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "./site-shell";

const promises = [
  {
    number: "01",
    title: "Bring selected Arc Spaces over",
    copy: "Choose StorableSidebar.json for each import. Space Tabs reads it locally, never modifies it, and previews everything before import.",
  },
  {
    number: "02",
    title: "Keep saved work dormant",
    copy: "Historical tabs and Tags remain part of the Space without loading every page into memory.",
  },
  {
    number: "03",
    title: "Leave with a complete backup",
    copy: "Export portable JSON at any time. Restore is reviewable, and the latest import can be undone.",
  },
];

type ProductScreenshotProps = {
  src: string;
  alt: string;
  caption: string;
  priority?: boolean;
  className?: string;
};

function ProductScreenshot({ src, alt, caption, priority = false, className = "" }: ProductScreenshotProps) {
  return (
    <figure className={`product-screenshot ${className}`.trim()}>
      <Image src={src} alt={alt} width={1280} height={800} priority={priority} unoptimized sizes="(max-width: 980px) 100vw, 60vw" />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export default function Home() {
  return (
    <div className="site-frame">
      <SiteHeader />
      <main>
        <section className="hero section-wrap">
          <div className="hero-copy">
            <p className="eyebrow"><span /> Arc workflow, without browser lock-in</p>
            <h1>Keep Chrome.<br />Bring your Arc workflow.<br /><em>Add private BYOK AI.</em></h1>
            <p className="hero-lede">
              Space Tabs: Arc-like Spaces &amp; BYOK AI turns Chrome into focused workspaces, imports selected
              Arc Spaces in minutes, and lets you ask or organize with the AI provider you choose.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="https://github.com/lctm2005/chrome-tab#install-from-source" target="_blank" rel="noreferrer">Install from GitHub</a>
              <a className="secondary-action" href="#product">See Space Tabs in action</a>
            </div>
            <ul className="trust-line" aria-label="Privacy summary">
              <li>No account</li>
              <li>No telemetry</li>
              <li>No Space Tabs server</li>
            </ul>
          </div>

          <ProductScreenshot
            className="hero-product-shot"
            src="/screenshots/01-spaces-overview.png"
            alt="Current Space Tabs extension showing the Launch Space, nested groups, and saved tabs in Chrome"
            caption="Current extension UI · Space switching, folders, Chrome-native groups, and dormant saved tabs"
            priority
          />
        </section>

        <section className="proof-strip" aria-label="Product promise">
          <div><span>Migration</span><b>Selectable Arc import</b></div>
          <div><span>Control</span><b>Preview · Confirm · Undo</b></div>
          <div><span>Ownership</span><b>Portable export anytime</b></div>
          <div><span>AI</span><b>Your key, your provider</b></div>
        </section>

        <section className="migration-section section-wrap" id="migration">
          <div className="section-heading">
            <p className="eyebrow"><span /> Migration without the leap of faith</p>
            <h2>Your Arc workspace,<br />now in Chrome.</h2>
            <p>Import is a visible three-step setup: choose a path, create or import a workspace, then review optional AI settings. The final step has one Save action: leave the provider unselected to continue without AI, or complete the provider settings to save them. You choose what crosses over and see conflicts before committing.</p>
          </div>
          <div className="feature-stack">
            <ProductScreenshot
              src="/screenshots/02-nested-folders-dormant-tabs.png"
              alt="Current Space Tabs three-step Arc import preview with selectable Spaces and conflict details"
              caption="Real setup flow · Choose, Space, AI & ready"
            />
            <div className="promise-list">
              {promises.map((item) => (
                <article key={item.number}>
                  <span>{item.number}</span>
                  <div><h3>{item.title}</h3><p>{item.copy}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="control-section section-wrap">
          <ProductScreenshot
            src="/screenshots/03-tab-context-menu.png"
            alt="Current Space Tabs Auto Group preview showing live and saved tabs before applying changes"
            caption="Real Auto Group preview · live and historical tabs stay visible before Apply"
          />
          <div className="section-heading right-copy">
            <p className="eyebrow"><span /> AI you control</p>
            <h2>A proposal first.<br />A change only after you approve.</h2>
            <p>Clicking Tidy Names or Auto Group sends the relevant tab metadata to your configured provider and generates one final preview—there is no extra pre-generation screen. Review exactly what will change or remain untouched; tabs and Tags do not change until you choose Apply. A 10-second Undo prompt follows each applied organization change.</p>
            <div className="privacy-note"><b>BYOK disclosure</b><span>Ask Page reads only the current HTTP(S) page when you send. Before anything goes to your provider, it shows the provider, exact page, extracted character count, and whether stored text from recent conversation messages will be included. Responses stream, can be stopped, and include a clickable link to the single source page.</span></div>
          </div>
        </section>

        <section className="surfaces-section section-wrap">
          <div className="section-heading centered">
            <p className="eyebrow"><span /> The actual extension, not a mockup</p>
            <h2>Quick in the side panel.<br />Deliberate in the Workbench.</h2>
            <p>Every product image on this page comes from the current extension UI.</p>
          </div>
          <div className="screenshot-grid" id="product">
            <ProductScreenshot
              src="/screenshots/05-ask-page-byok-ai.png"
              alt="Current Space Tabs Ask Page view using the active page with a clickable source"
              caption="Ask Page · current page, BYOK provider, single-source citation, streaming, and Stop"
            />
            <ProductScreenshot
              src="/screenshots/04-settings-arc-import-shortcuts.png"
              alt="Current Space Tabs Workbench Settings showing backup, restore, and Arc import controls"
              caption="Workbench Settings · export, restore, Arc import, and local BYOK configuration"
            />
          </div>
          <div className="surface-grid">
            <article><span className="surface-kicker">SIDE PANEL</span><h3>Switch, find, drag</h3><p>Keep daily retrieval close to the page you are using. Open dormant tabs only when you need them.</p><b>Command palette included →</b></article>
            <article><span className="surface-kicker">WORKBENCH</span><h3>Migrate, back up, ask</h3><p>Give Ask Page, AI organization, migration previews, recovery, and settings the space they deserve.</p><b>Full-page context →</b></article>
          </div>
        </section>

        <section className="final-cta section-wrap">
          <div><p className="eyebrow light"><span /> Built for Arc returners</p><h2>Bring the workflow.<br />Keep control.</h2></div>
          <div>
            <p>Review how Space Tabs handles your workspace, then follow the exact setup and troubleshooting guidance whenever you need it.</p>
            <div className="final-links"><Link href="/privacy">Read privacy</Link><Link href="/support">Read setup &amp; support</Link></div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
