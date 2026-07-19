import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import SupportPage, { metadata } from "../app/support/page";
import { expectNoAccessibilityViolations, expectWorkingSkipLink } from "./accessibility";

describe("support page", () => {
  it("presents a two-step setup and seven independently expandable answers", async () => {
    const user = userEvent.setup();
    const view = render(<SupportPage />);

    expect(metadata).toMatchObject({
      title: "Support",
      description: expect.stringContaining("troubleshooting"),
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Get your Arc workflow settled in Chrome.");
    expect(view.container.querySelectorAll(".quick-grid article")).toHaveLength(2);

    const details = [...view.container.querySelectorAll("details")];
    expect(details).toHaveLength(7);
    expect(details.map((item) => item.open)).toEqual([true, false, false, false, false, false, false]);
    const disclosureIcons = [...view.container.querySelectorAll(".faq-list summary span")];
    expect(disclosureIcons).toHaveLength(7);
    for (const icon of disclosureIcons) expect(icon).toHaveAttribute("aria-hidden", "true");

    const firstSummary = screen.getByText("Why are there two setup steps?").closest("summary");
    const secondSummary = screen.getByText("What Arc file do I select?").closest("summary");
    expect(firstSummary).not.toBeNull();
    expect(secondSummary).not.toBeNull();
    await user.click(firstSummary!);
    await user.click(secondSummary!);
    expect(details[0]).not.toHaveAttribute("open");
    expect(details[1]).toHaveAttribute("open");

    const organizationAnswer = screen.getByText("What is the difference between Tidy and Auto Group?").closest("details");
    expect(organizationAnswer).toHaveTextContent("falls back to local naming without sending tab metadata");
    expect(organizationAnswer).toHaveTextContent("Auto Group requires configured AI");

    const supportLinks = screen.getAllByRole("link", { name: /Email support|lctm2005@gmail.com/ });
    expect(supportLinks).toHaveLength(2);
    for (const link of supportLinks) {
      expect(link.getAttribute("href")).toBe("mailto:lctm2005@gmail.com?subject=Space%20Tabs%20support");
    }

    expectWorkingSkipLink(view);
  });

  it("has no automated accessibility violations", async () => {
    const view = render(<SupportPage />);
    await expectNoAccessibilityViolations(view.container);
  });
});
