import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// The browser only ever talks to our own API. No feed URLs in the web app.
const SRC = fileURLToPath(new URL(".", import.meta.url));
const CHECKED = /\.(ts|tsx|js|jsx|mjs|css|json)$/;
const URL_PATTERN = /https?:\/\/[^\s"'`)]+/g;
const ALLOWED_HOSTS = ["localhost", "127.0.0.1", "www.w3.org"];

test("apps/web/src contains no upstream URLs", () => {
  const problems: string[] = [];
  const files = readdirSync(SRC, { recursive: true, encoding: "utf8" });

  for (const file of files) {
    if (!CHECKED.test(file) || file.includes(".test.")) continue;
    const text = readFileSync(join(SRC, file), "utf8");
    for (const match of text.matchAll(URL_PATTERN)) {
      const host = new URL(match[0]).hostname;
      if (!ALLOWED_HOSTS.includes(host)) {
        problems.push(`${file}: ${match[0]}`);
      }
    }
  }

  expect(problems).toEqual([]);
});
