export type Rgba = readonly [number, number, number, number];

export function cssToRgba(
  css: string,
  create: () => HTMLCanvasElement = () => document.createElement("canvas"),
): Rgba {
  const canvas = create();
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [255, 255, 255, 1];
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  return [red, green, blue, alpha / 255];
}
