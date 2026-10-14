import { describe, expect, test } from "vitest";
import { API_URL, ApiRequestError, unwrap } from "./client";

const response = (status: number, statusText = "") =>
  new Response(null, { status, statusText });

describe("unwrap", () => {
  test("returns data", () => {
    expect(unwrap({ data: [1, 2], response: response(200) })).toEqual([1, 2]);
  });

  test("throws the API's own error message with the status", () => {
    const run = () =>
      unwrap({
        error: { error: { code: "not_found", message: "No event 'x'" } },
        response: response(404),
      });
    expect(run).toThrow(ApiRequestError);
    expect(run).toThrow("No event 'x'");
    try {
      run();
    } catch (error) {
      expect((error as ApiRequestError).status).toBe(404);
    }
  });

  test("falls back to the HTTP status when the body isn't ours", () => {
    expect(() =>
      unwrap({ error: "boom", response: response(502, "Bad Gateway") }),
    ).toThrow("502 Bad Gateway");
  });
});

test("the API defaults to the local dev server", () => {
  expect(API_URL).toBe("http://localhost:8000");
});
