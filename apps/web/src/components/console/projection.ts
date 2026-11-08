export type ScreenPoint = { x: number; y: number };

export class ScreenProjection {
  private readonly matrix = new Float64Array(16);
  private width = 0;
  private height = 0;

  update(columnMajor: ArrayLike<number>, width: number, height: number): void {
    for (let i = 0; i < 16; i++) this.matrix[i] = columnMajor[i];
    this.width = width;
    this.height = height;
  }

  project(x: number, y: number, z: number, out: ScreenPoint): boolean {
    const m = this.matrix;
    const depth = m[2] * x + m[6] * y + m[10] * z + m[14];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (depth < 0 || w === 0) return false;
    const inverse = 0.5 / w;
    const clipX = m[0] * x + m[4] * y + m[8] * z + m[12];
    const clipY = m[1] * x + m[5] * y + m[9] * z + m[13];
    out.x = (clipX * inverse + 0.5) * this.width;
    out.y = (0.5 - clipY * inverse) * this.height;
    return true;
  }
}
