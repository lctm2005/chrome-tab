import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from "react";
import { afterEach, vi } from "vitest";

type MockImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | { src: string };
  alt: string;
  priority?: boolean;
  unoptimized?: boolean;
};

vi.mock("next/image", () => ({
  default: function MockImage({ src, alt, priority = false, unoptimized, ...props }: MockImageProps) {
    void unoptimized;
    const resolvedSrc = typeof src === "string" ? src : src.src;
    // This intentionally models next/image as its final DOM element for component tests.
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} src={resolvedSrc} alt={alt} data-priority={String(priority)} />;
  },
}));

type MockLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string };
  prefetch?: boolean;
};

vi.mock("next/link", () => ({
  default: function MockLink({ href, prefetch, ...props }: MockLinkProps) {
    void prefetch;
    const resolvedHref = typeof href === "string" ? href : href.pathname || "";
    return <a {...props} href={resolvedHref} />;
  },
}));

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-geist-sans" }),
  Geist_Mono: () => ({ variable: "font-geist-mono" }),
}));

afterEach(() => cleanup());
