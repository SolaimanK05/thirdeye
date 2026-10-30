import type { ThirdEyePerf } from "./probe";

declare global {
  interface Window {
    __thirdeyePerf?: ThirdEyePerf;
  }
}
