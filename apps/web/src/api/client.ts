import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export type ApiSchemas = components["schemas"];
export type ModuleInfo = ApiSchemas["ModuleOut"];
export type HealthState = ApiSchemas["HealthState"];
export type Layer = ApiSchemas["Layer"];
export type EventRow = ApiSchemas["EventRow"];
export type EventDetail = ApiSchemas["EventDetail"];
export type EntityDetail = ApiSchemas["EntityDetail"];
export type EntityRow = ApiSchemas["EntityRow"];
export type EntityKind = ApiSchemas["EntityKind"];
export type Position = ApiSchemas["Position"];
export type Watchlist = ApiSchemas["Watchlist"];
export type WatchItem = ApiSchemas["WatchItem"];
export type SearchHit = ApiSchemas["SearchHit"];
export type SearchResults = ApiSchemas["SearchResults"];
export type ApiError = ApiSchemas["ErrorBody"];

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const api = createClient<paths>({ baseUrl: API_URL });

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

type Result<T> = {
  data?: T;
  error?: ApiError | unknown;
  response: Response;
};

export function unwrap<T>({ data, error, response }: Result<T>): T {
  if (data !== undefined) return data;
  const message =
    error && typeof error === "object" && "error" in error
      ? (error as ApiError).error.message
      : `${response.status} ${response.statusText}`;
  throw new ApiRequestError(response.status, message);
}
