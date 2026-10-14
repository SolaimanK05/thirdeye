import { expect, test } from "vitest";
import { formatCount } from "./count";

test("counts get thousands separators", () => {
  expect(formatCount(7)).toBe("7");
  expect(formatCount(3000)).toBe("3,000");
  expect(formatCount(250000)).toBe("250,000");
});
