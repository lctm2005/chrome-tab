import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AtRule, Container } from "postcss";
import postcss from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

let stylesheet: ReturnType<typeof postcss.parse>;

beforeAll(async () => {
  const css = await readFile(resolve(process.cwd(), "app/globals.css"), "utf8");
  stylesheet = postcss.parse(css);
});

function mediaRule(params: string) {
  const rule = stylesheet.nodes.find((node): node is AtRule => (
    node.type === "atrule" && node.name === "media" && node.params === params
  ));
  expect(rule, `missing ${params} media query`).toBeDefined();
  return rule!;
}

function declarations(container: Container, selector: string) {
  const result: Record<string, string> = {};
  container.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls((declaration) => {
      result[declaration.prop] = declaration.value;
    });
  });
  return result;
}

describe("responsive stylesheet contracts", () => {
  it("collapses navigation and wide product layouts for tablet widths", () => {
    const tablet = mediaRule("(max-width: 980px)");
    expect(declarations(tablet, ".site-header nav")).toMatchObject({ display: "none" });
    expect(declarations(tablet, ".hero")).toMatchObject({ "grid-template-columns": "1fr" });
    expect(declarations(tablet, ".hero-product-shot")).toMatchObject({ "min-width": "0", transform: "none" });
    expect(declarations(tablet, ".migration-section")).toMatchObject({ "grid-template-columns": "1fr" });
    expect(declarations(tablet, ".faq-section")).toMatchObject({ "grid-template-columns": "1fr" });
  });

  it("uses one-column content and reachable controls on phone widths", () => {
    const phone = mediaRule("(max-width: 680px)");
    expect(declarations(phone, ".proof-strip")).toMatchObject({ "grid-template-columns": "1fr" });
    expect(declarations(phone, ".surface-grid")).toMatchObject({ "grid-template-columns": "1fr" });
    expect(declarations(phone, ".quick-grid")).toMatchObject({ "grid-template-columns": "1fr" });
    expect(declarations(phone, ".legal-summary")).toMatchObject({ "grid-template-columns": "1fr" });
    expect(declarations(phone, ".final-cta")).toMatchObject({ "grid-template-columns": "1fr" });
    expect(declarations(phone, ".legal-content section")).toMatchObject({ "grid-template-columns": "1fr" });
    expect(declarations(phone, ".support-contact")).toMatchObject({ "flex-direction": "column" });
  });

  it("respects reduced motion and reveals the skip link when it receives focus", () => {
    const reducedMotion = mediaRule("(prefers-reduced-motion: reduce)");
    expect(declarations(reducedMotion, "html")).toMatchObject({ "scroll-behavior": "auto" });
    expect(declarations(reducedMotion, ".skip-link")).toMatchObject({ transition: "none" });
    expect(declarations(stylesheet, ".skip-link")).toMatchObject({ position: "absolute" });
    expect(declarations(stylesheet, ".skip-link:focus")).toMatchObject({ transform: "translateY(0)" });
  });
});
