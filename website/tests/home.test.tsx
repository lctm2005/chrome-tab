import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "../app/page";
import { expectNoAccessibilityViolations, expectWorkingSkipLink } from "./accessibility";

describe("home page", () => {
  it("renders the complete product journey with working in-page and install actions", () => {
    const view = render(<Home />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Keep Chrome. Bring your Arc workflow. Add private BYOK AI.");
    expect(screen.getByRole("list", { name: "Privacy summary" })).toHaveTextContent("No accountNo telemetryNo Space Tabs server");
    expect(screen.getByLabelText("Product promise").children).toHaveLength(4);

    const installLinks = screen.getAllByRole("link", { name: /Install/ });
    expect(installLinks.length).toBeGreaterThanOrEqual(3);
    for (const link of installLinks.filter((item) => item.getAttribute("target") === "_blank")) {
      expect(link).toHaveAttribute("rel", "noreferrer");
      expect(link).toHaveAttribute("href", "https://github.com/lctm2005/chrome-tab#install-from-source");
    }

    expect(screen.getByRole("link", { name: "See Space Tabs in action" })).toHaveAttribute("href", "#product");
    expect(view.container.querySelector("#product")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Migration" })).toHaveAttribute("href", "/#migration");
    expect(view.container.querySelector("#migration")).not.toBeNull();
    expect(screen.getByText(/Tidy Names uses your configured provider when available/)).toHaveTextContent("falls back to local naming rules without sending tab metadata");
    expect(screen.getByText(/Tidy Names uses your configured provider when available/)).toHaveTextContent("Auto Group requires configured AI");

    const screenshots = screen.getAllByRole("img");
    expect(screenshots).toHaveLength(5);
    expect(view.container.querySelectorAll("figure.product-screenshot figcaption")).toHaveLength(5);
    expect(screen.getByAltText(/Launch Space, nested groups/)).toHaveAttribute("data-priority", "true");
    expect(screen.getByAltText(/three-step Arc import preview/)).toHaveAttribute("data-priority", "false");

    expectWorkingSkipLink(view);
  });

  it("has no automated accessibility violations", async () => {
    const view = render(<Home />);
    await expectNoAccessibilityViolations(view.container);
  });
});
