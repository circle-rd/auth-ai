import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED_PACKAGES = new Set(["zod", "react", "vue"]);
const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^"';]*?from\s+["']([^"']+)["']/g;

/** Every package a module pulls in, following its relative imports. */
function packagesReachedFrom(entry: string): Map<string, string> {
  const reached = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(IMPORT)) {
      if (!specifier) continue;
      if (specifier.startsWith(".")) {
        queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
      } else {
        reached.set(specifier, file);
      }
    }
  }
  return reached;
}

describe("browser entry points", () => {
  it.each(["browser/index.ts", "react/index.ts", "vue/index.ts"])(
    "%s reaches no server-only package",
    (entry) => {
      const packages = packagesReachedFrom(join(SRC, entry));
      const forbidden = [...packages].filter(
        ([name]) => !ALLOWED_PACKAGES.has(name),
      );
      expect(forbidden).toEqual([]);
    },
  );

  it("sees a forbidden import when there is one", () => {
    const packages = packagesReachedFrom(join(SRC, "client.ts"));
    expect([...packages.keys()]).toContain("openid-client");
  });
});
