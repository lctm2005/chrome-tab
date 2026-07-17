import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PrivacyPage, { metadata } from "../app/privacy/page";
import { expectNoAccessibilityViolations, expectWorkingSkipLink } from "./accessibility";

describe("privacy page", () => {
  it("explains each data path and gives the user a direct contact route", () => {
    const view = render(<PrivacyPage />);

    expect(metadata).toMatchObject({
      title: "Privacy",
      description: expect.stringContaining("workspace data"),
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your workspace stays local. AI goes only where you choose.");
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Data Space Tabs handles",
      "Local storage",
      "Network requests",
      "Permissions",
      "Your control",
      "Contact",
    ]);
    expect(screen.getByText("Last updated July 15, 2026")).toBeVisible();
    expect(screen.getByRole("link", { name: "lctm2005@gmail.com" })).toHaveAttribute("href", "mailto:lctm2005@gmail.com");
    expect(screen.getByText("No proxy server").closest("article")).toHaveTextContent("BYOK requests go directly to your provider.");
    const networkSection = screen.getByRole("heading", { name: "Network requests" }).closest("section");
    expect(networkSection).toHaveTextContent("falls back to local naming rules without sending tab metadata");
    expect(networkSection).toHaveTextContent("Auto Group requires configured AI");
    expect(screen.getByRole("heading", { name: "Local storage" }).closest("section")).toHaveTextContent("cannot be enabled in Incognito mode");
    expect(screen.getByRole("heading", { name: "Data Space Tabs handles" }).closest("section")).toHaveTextContent("Saved local file URLs may be stored and restored, but Space Tabs does not read local file contents");
    const permissionsSection = screen.getByRole("heading", { name: "Permissions" }).closest("section");
    expect(permissionsSection).toHaveTextContent("file:///*");
    expect(permissionsSection).toHaveTextContent("Allow access to file URLs");
    expect(permissionsSection).toHaveTextContent("does not read the file's contents");

    expectWorkingSkipLink(view);
  });

  it("has no automated accessibility violations", async () => {
    const view = render(<PrivacyPage />);
    await expectNoAccessibilityViolations(view.container);
  });
});
