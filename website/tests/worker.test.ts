import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appFetch: vi.fn(),
  optimize: vi.fn(),
}));

vi.mock("vinext/server/app-router-entry", () => ({
  default: { fetch: mocks.appFetch },
}));

vi.mock("vinext/server/image-optimization", () => ({
  DEFAULT_DEVICE_SIZES: [640, 1280],
  DEFAULT_IMAGE_SIZES: [16, 32],
  handleImageOptimization: mocks.optimize,
}));

import worker from "../worker/index";

describe("Cloudflare worker routing", () => {
  beforeEach(() => {
    mocks.appFetch.mockReset();
    mocks.optimize.mockReset();
  });

  it("forwards ordinary requests to the application router without changing its context", async () => {
    const request = new Request("https://space-tabs.example/support?from=test");
    const response = new Response("support", { status: 202 });
    const env = { ASSETS: { fetch: vi.fn() }, IMAGES: { input: vi.fn() } };
    const context = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
    mocks.appFetch.mockResolvedValue(response);

    await expect(worker.fetch(request, env as never, context)).resolves.toBe(response);
    expect(mocks.appFetch).toHaveBeenCalledExactlyOnceWith(request, env, context);
    expect(mocks.optimize).not.toHaveBeenCalled();
  });

  it("routes image requests through the bound asset fetcher and image transformer", async () => {
    const request = new Request("https://space-tabs.example/_vinext/image?url=%2Fog.png&w=640&q=80");
    const optimizedResponse = new Response("optimized", {
      headers: { "content-type": "image/webp" },
    });
    const sourceBody = new ReadableStream();
    const transformed = { response: vi.fn().mockResolvedValue(optimizedResponse) };
    const output = vi.fn().mockReturnValue(transformed);
    const transform = vi.fn().mockReturnValue({ output });
    const input = vi.fn().mockReturnValue({ transform });
    const assetFetch = vi.fn().mockResolvedValue(new Response("asset"));
    const env = { ASSETS: { fetch: assetFetch }, IMAGES: { input } };
    const context = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

    mocks.optimize.mockImplementation(async (_request, options, widths) => {
      expect(_request).toBe(request);
      expect(widths).toEqual([640, 1280, 16, 32]);

      await options.fetchAsset("/og.png");
      const resized = await options.transformImage(sourceBody, {
        width: 640,
        format: "webp",
        quality: 80,
      });
      const originalSize = await options.transformImage(sourceBody, {
        width: 0,
        format: "png",
        quality: 100,
      });
      expect(resized).toBe(optimizedResponse);
      expect(originalSize).toBe(optimizedResponse);
      return optimizedResponse;
    });

    await expect(worker.fetch(request, env as never, context)).resolves.toBe(optimizedResponse);
    expect(assetFetch).toHaveBeenCalledTimes(1);
    expect(assetFetch.mock.calls[0][0]).toBeInstanceOf(Request);
    expect(assetFetch.mock.calls[0][0].url).toBe("https://space-tabs.example/og.png");
    expect(input).toHaveBeenNthCalledWith(1, sourceBody);
    expect(input).toHaveBeenNthCalledWith(2, sourceBody);
    expect(transform).toHaveBeenNthCalledWith(1, { width: 640 });
    expect(transform).toHaveBeenNthCalledWith(2, {});
    expect(output).toHaveBeenNthCalledWith(1, { format: "webp", quality: 80 });
    expect(output).toHaveBeenNthCalledWith(2, { format: "png", quality: 100 });
    expect(transformed.response).toHaveBeenCalledTimes(2);
    expect(mocks.appFetch).not.toHaveBeenCalled();
  });
});
