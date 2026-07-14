import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header section-wrap">
      <Link className="brand" href="/" aria-label="Space Tabs home"><span>S</span><b>Space Tabs</b></Link>
      <nav aria-label="Primary navigation"><Link href="/#migration">Migration</Link><Link href="/privacy">Privacy</Link><Link href="/support">Support</Link></nav>
      <a className="header-cta" href="mailto:lctm2005@gmail.com?subject=Space%20Tabs%20beta">Join beta <span>↗</span></a>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer section-wrap">
      <div className="brand footer-brand"><span>S</span><b>Space Tabs</b></div>
      <p>Keep Chrome. Bring your Arc workflow. Add private BYOK AI.</p>
      <nav aria-label="Footer navigation"><Link href="/privacy">Privacy</Link><Link href="/support">Support</Link><a href="mailto:lctm2005@gmail.com">Contact</a></nav>
      <small>© 2026 Space Tabs. Chrome and Arc are trademarks of their respective owners.</small>
    </footer>
  );
}
