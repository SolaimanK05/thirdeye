import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));
const CHECKED = /\.(ts|tsx|js|jsx|mjs|css)$/;
const TOKENS_FILE = join("app", "globals.css");
const HEX = /(?<![&\w])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;

describe("colours come from the VOID tokens", () => {
  test("the pattern catches hex colours and ignores entities", () => {
    expect('fill="#00ff41"'.match(HEX)).toEqual(["#00ff41"]);
    expect("bg-[#050606]".match(HEX)).toEqual(["#050606"]);
    expect("color: #fff;".match(HEX)).toEqual(["#fff"]);
    expect("&#160; and #main and #section-2".match(HEX)).toBeNull();
  });

  test("no hex colour outside globals.css", () => {
    const problems: string[] = [];
    const files = readdirSync(SRC, { recursive: true, encoding: "utf8" });

    for (const file of files) {
      if (!CHECKED.test(file) || file.includes(".test.")) continue;
      if (file === TOKENS_FILE) continue;
      const text = readFileSync(join(SRC, file), "utf8");
      for (const match of text.matchAll(HEX)) {
        problems.push(`${file}: ${match[0]}`);
      }
    }

    expect(problems).toEqual([]);
  });
});
