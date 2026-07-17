import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteFooter, SiteHeader } from "../app/site-shell";

describe("shared site navigation", () => {
  it("offers named landmarks, safe external links, and a keyboard skip target", () => {
    const view = render(<><SiteHeader /><main id="main-content">Content</main><SiteFooter /></>);

    const header = screen.getByRole("banner");
    const primaryNavigation = within(header).getByRole("navigation", { name: "Primary navigation" });
    expect(within(primaryNavigation).getByRole("link", { name: "Migration" })).toHaveAttribute("href", "/#migration");
    expect(within(primaryNavigation).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(within(primaryNavigation).getByRole("link", { name: "Support" })).toHaveAttribute("href", "/support");

    const homeLink = within(header).getByRole("link", { name: "Space Tabs: Arc-like Spaces and BYOK AI home" });
    expect(homeLink).toHaveAttribute("href", "/");
    const installLink = within(header).getByRole("link", { name: "Install" });
    expect(installLink).toHaveAttribute("target", "_blank");
    expect(installLink).toHaveAttribute("rel", "noreferrer");

    const skipLink = within(header).getByRole("link", { name: "Skip to main content" });
    expect(skipLink).toHaveAttribute("href", "#main-content");

    const footer = screen.getByRole("contentinfo");
    const footerNavigation = within(footer).getByRole("navigation", { name: "Footer navigation" });
    expect(within(footerNavigation).getByRole("link", { name: "Contact" })).toHaveAttribute("href", "mailto:lctm2005@gmail.com");
    expect(view.container.querySelectorAll('img[alt=""]')).toHaveLength(2);
  });
});
