import Image from "next/image";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header section-wrap">
      <Link className="brand" href="/" aria-label="Space Tabs: Arc-like Spaces and BYOK AI home">
        <Image className="brand-icon" src="/icon.png" alt="" width={32} height={32} priority unoptimized />
        <span className="brand-copy"><b>Space Tabs</b><small>Arc-like Spaces &amp; BYOK AI</small></span>
      </Link>
      <nav aria-label="Primary navigation"><Link href="/#migration">Migration</Link><Link href="/privacy">Privacy</Link><Link href="/support">Support</Link></nav>
      <Link className="header-cta" href="/#product">See product <span>↓</span></Link>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer section-wrap">
      <div className="brand footer-brand">
        <Image className="brand-icon" src="/icon.png" alt="" width={28} height={28} unoptimized />
        <span className="brand-copy"><b>Space Tabs</b><small>Arc-like Spaces &amp; BYOK AI</small></span>
      </div>
      <p>Keep Chrome. Bring your Arc workflow. Add private BYOK AI.</p>
      <nav aria-label="Footer navigation"><Link href="/privacy">Privacy</Link><Link href="/support">Support</Link><a href="mailto:lctm2005@gmail.com">Contact</a></nav>
      <small>© 2026 Space Tabs. Chrome and Arc are trademarks of their respective owners.</small>
    </footer>
  );
}
