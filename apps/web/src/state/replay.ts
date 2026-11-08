import { create } from "zustand";
import { DAY_MS } from "@/motion/trail";

/** The replay plays the whole 24 h in this many seconds. */
export const REPLAY_SECONDS = 30;
export const REPLAY_RATE = DAY_MS / (REPLAY_SECONDS * 1000);

type ReplayState = {
  /** How far back from now the replay is, in ms; 0 is live. */
  back: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  scrubTo: (back: number) => void;
  live: () => void;
  tick: (elapsedMs: number) => void;
};

const clamp = (back: number) => Math.min(DAY_MS, Math.max(0, back));

export const useReplay = create<ReplayState>((set) => ({
  back: 0,
  playing: false,
  play: () =>
    set((state) => ({
      playing: true,
      back: state.back === 0 ? DAY_MS : state.back,
    })),
  pause: () => set({ playing: false }),
  scrubTo: (back) => set({ back: clamp(back) }),
  live: () => set({ back: 0, playing: false }),
  tick: (elapsedMs) =>
    set((state) => {
      if (!state.playing) return state;
      const back = clamp(state.back - elapsedMs * REPLAY_RATE);
      return back === 0 ? { back: 0, playing: false } : { back };
    }),
}));

export const isLive = (state: { back: number; playing: boolean }) =>
  state.back === 0 && !state.playing;
