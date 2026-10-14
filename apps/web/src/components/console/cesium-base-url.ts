import { CESIUM_BASE_URL } from "./globe-config";

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}

if (typeof window !== "undefined") {
  window.CESIUM_BASE_URL = CESIUM_BASE_URL;
}
