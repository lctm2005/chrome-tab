import { SiteFooter, SiteHeader } from "./site-shell";

const promises = [
  {
    number: "01",
    title: "Bring selected Arc Spaces over",
    copy: "Preview every Space, folder, saved tab, and naming conflict before anything is imported.",
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
              Space Tabs turns Chrome into focused workspaces, imports selected Arc Spaces in minutes,
              and lets you ask or organize with the AI provider you choose.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="mailto:lctm2005@gmail.com?subject=Space%20Tabs%20beta">Join the beta</a>
              <a className="secondary-action" href="#migration">See how migration works</a>
            </div>
            <ul className="trust-line" aria-label="Privacy summary">
              <li>No account</li>
              <li>No telemetry</li>
              <li>No Space Tabs server</li>
            </ul>
          </div>

          <div className="product-stage" aria-label="Space Tabs product preview">
            <div className="browser-bar">
              <span className="traffic red" /><span className="traffic yellow" /><span className="traffic green" />
              <span className="browser-pill">chrome · Space Tabs Workbench</span>
            </div>
            <div className="product-grid">
              <aside className="space-rail">
                <span className="mini-logo">S</span>
                <span className="space-dot active">R</span>
                <span className="space-dot">P</span>
                <span className="space-dot">D</span>
                <span className="space-dot add">+</span>
              </aside>
              <div className="workspace-card">
                <div className="workspace-title">
                  <div><small>SPACE</small><strong>Research launch</strong></div>
                  <span className="safe-pill">Local</span>
                </div>
                <div className="group-card purple">
                  <div><span className="group-icon">●</span><b>Market notes</b><small>3 live · 8 saved</small></div>
                  <p>Competitor landscape</p><p>Pricing notes</p>
                </div>
                <div className="group-card blue">
                  <div><span className="group-icon">●</span><b>User research</b><small>2 live · 14 saved</small></div>
                  <p>Interview synthesis</p><p>Arc returners</p>
                </div>
              </div>
              <div className="ask-card">
                <p className="card-label">ASK SPACE</p>
                <h3>Compare the launch risks.</h3>
                <div className="disclosure-row"><span>Provider</span><b>Your OpenAI-compatible endpoint</b></div>
                <div className="disclosure-row"><span>Sources</span><b>2 confirmed live HTTP(S) pages · selected first</b></div>
                <div className="source-tags"><span>[1] Market notes</span><span>[2] Interview synthesis</span></div>
                <button type="button">Review, then send</button>
                <small>Nothing is sent until you confirm.</small>
              </div>
            </div>
          </div>
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
            <p>Import is a visible first-run path, not a hidden append button. You choose what crosses over and see conflicts before committing.</p>
          </div>
          <div className="promise-list">
            {promises.map((item) => (
              <article key={item.number}>
                <span>{item.number}</span>
                <div><h3>{item.title}</h3><p>{item.copy}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className="control-section section-wrap">
          <div className="control-preview">
            <div className="proposal-head"><span>Auto Group proposal</span><b>6 tabs will move</b></div>
            <div className="proposal-group"><i className="dot purple-dot" /><div><b>Launch research</b><span>3 live · 2 saved</span></div><em>Proposed</em></div>
            <div className="proposal-group"><i className="dot blue-dot" /><div><b>Customer evidence</b><span>1 live · 5 saved</span></div><em>Proposed</em></div>
            <div className="untouched"><b>Remain untouched</b><span>11 historical tabs and 3 Tags</span></div>
            <div className="proposal-actions"><button type="button">Cancel</button><button type="button">Apply groups</button></div>
          </div>
          <div className="section-heading right-copy">
            <p className="eyebrow"><span /> AI that asks permission</p>
            <h2>A proposal first.<br />A change only after you approve.</h2>
            <p>Tidy Names and Auto Group first show the provider, exact tabs, URLs, and metadata fields. After you generate a proposal, a separate review shows what will move, rename, merge, and remain untouched. Every applied change creates a visible operation record with one-click Undo.</p>
            <div className="privacy-note"><b>BYOK disclosure</b><span>Ask Space uses up to 12 confirmed live HTTP(S) pages, prioritizes pages you select, and shows the provider, sources, extracted content size, and whether stored text from recent conversation messages will be included. Generated-response Sources appendices stay out of the context sent to your provider.</span></div>
          </div>
        </section>

        <section className="surfaces-section section-wrap">
          <div className="section-heading centered">
            <p className="eyebrow"><span /> Right-sized surfaces</p>
            <h2>Quick in the side panel.<br />Deliberate in the Workbench.</h2>
          </div>
          <div className="surface-grid">
            <article><span className="surface-kicker">SIDE PANEL</span><h3>Switch, find, drag</h3><p>Keep daily retrieval close to the page you are using. Open dormant tabs only when you need them.</p><b>Command palette included →</b></article>
            <article><span className="surface-kicker">WORKBENCH</span><h3>Migrate, back up, ask</h3><p>Give multi-tab AI, migration previews, recovery, and settings the space they deserve.</p><b>Full-page context →</b></article>
          </div>
        </section>

        <section className="final-cta section-wrap">
          <div><p className="eyebrow light"><span /> Built for Arc returners</p><h2>Bring the workflow.<br />Keep control.</h2></div>
          <div><p>Help validate the next Chrome Web Store release with your real Arc workspace. We are looking for thoughtful feedback, not inflated reviews.</p><a href="mailto:lctm2005@gmail.com?subject=Space%20Tabs%20beta">Join the Arc-returner beta</a></div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
