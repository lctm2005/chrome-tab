import axe from "axe-core";
import type { RenderResult } from "@testing-library/react";
import { expect } from "vitest";

export async function expectNoAccessibilityViolations(container: RenderResult["container"]) {
  const result = await axe.run(container, {
    rules: {
      // jsdom does not implement canvas pixel reads, which axe needs for this rule.
      "color-contrast": { enabled: false },
    },
  });
  expect(result.violations.map((violation) => ({
    id: violation.id,
    targets: violation.nodes.map((node) => node.target),
  }))).toEqual([]);
}

export function expectWorkingSkipLink(view: RenderResult) {
  const skipLink = view.getByRole("link", { name: "Skip to main content" });
  const main = view.container.querySelector("main#main-content");
  expect(skipLink).toHaveAttribute("href", "#main-content");
  expect(main).toHaveAttribute("tabindex", "-1");
}
