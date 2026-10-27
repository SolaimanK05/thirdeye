export const MOTION_HZ = 12;

export type FrameScheduler = {
  request: (callback: (timestamp: number) => void) => number;
  cancel: (handle: number) => void;
};

export type MotionLoopOptions = {
  step: (timestamp: number) => boolean;
  frames?: FrameScheduler;
  hz?: number;
};

const browserFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

const FRAME_SLACK_MS = 2;

export class MotionLoop {
  private readonly step: (timestamp: number) => boolean;
  private readonly frames: FrameScheduler;
  private readonly intervalMs: number;
  private handle: number | null = null;
  private last = Number.NEGATIVE_INFINITY;

  constructor({
    step,
    frames = browserFrames,
    hz = MOTION_HZ,
  }: MotionLoopOptions) {
    this.step = step;
    this.frames = frames;
    this.intervalMs = 1000 / hz;
  }

  get running(): boolean {
    return this.handle !== null;
  }

  wake(): void {
    if (this.handle !== null) return;
    this.handle = this.frames.request(this.tick);
  }

  stop(): void {
    if (this.handle === null) return;
    this.frames.cancel(this.handle);
    this.handle = null;
    this.last = Number.NEGATIVE_INFINITY;
  }

  private readonly tick = (timestamp: number): void => {
    this.handle = null;
    if (timestamp - this.last < this.intervalMs - FRAME_SLACK_MS) {
      this.handle = this.frames.request(this.tick);
      return;
    }
    this.last = timestamp;
    if (!this.step(timestamp)) {
      this.last = Number.NEGATIVE_INFINITY;
      return;
    }
    this.handle = this.frames.request(this.tick);
  };
}
