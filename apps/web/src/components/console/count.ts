const COUNT = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return COUNT.format(value);
}
