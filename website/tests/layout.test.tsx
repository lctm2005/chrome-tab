import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const headersMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({ headers: headersMock }));

import RootLayout, { generateMetadata } from "../app/layout";

describe("root layout metadata", () => {
  beforeEach(() => headersMock.mockReset());

  const metadataCases: Array<{ name: string; headers: Record<string, string>; origin: string }> = [
    {
      name: "forwarded deployment origin",
      headers: { "x-forwarded-host": "preview.example.com", "x-forwarded-proto": "http" },
      origin: "http://preview.example.com",
    },
    {
      name: "local Host header",
      headers: { host: "localhost:4173" },
      origin: "http://localhost:4173",
    },
    {
      name: "secure public Host header",
      headers: { host: "space-tabs.example" },
      origin: "https://space-tabs.example",
    },
    {
      name: "missing proxy headers",
      headers: {},
      origin: "http://localhost:3000",
    },
  ];

  it.each(metadataCases)("builds absolute social metadata for the $name", async ({ headers, origin }) => {
    headersMock.mockResolvedValue(new Headers(headers));

    const metadata = await generateMetadata();

    expect(metadata.metadataBase).toEqual(new URL(origin));
    expect(metadata.title).toEqual({
      default: "Space Tabs: Arc-like Spaces & BYOK AI — Keep Chrome. Bring your Arc workflow.",
      template: "%s · Space Tabs",
    });
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      url: origin,
      images: [{ url: `${origin}/og.png`, width: 1280, height: 800 }],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: [`${origin}/og.png`],
    });
  });

  it("sets the document language, fonts, and page content", () => {
    const html = renderToStaticMarkup(<RootLayout><main>Product content</main></RootLayout>);

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('class="font-geist-sans font-geist-mono"');
    expect(html).toContain("Product content");
  });
});
