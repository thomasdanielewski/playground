/**
 * Compute per-pixel surface normals from a depth map using central-difference gradients.
 * No AI model needed — pure math on the existing depth data.
 */

/**
 * Estimate surface normals from depth data.
 * @param depthData - Uint8Array depth map (values 0-255)
 * @param width - Image width
 * @param height - Image height
 * @param mask - Optional foreground mask (pixels < 128 are background)
 * @param strength - Controls normal sharpness (higher = more curvature). Default 2.0.
 * @returns Float32Array of size width*height*3 (nx, ny, nz per pixel)
 */
export function estimateNormals(
  depthData: Uint8Array,
  width: number,
  height: number,
  mask: Uint8Array | null,
  strength: number = 2.0
): Float32Array {
  const normals = new Float32Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const i3 = i * 3;

      // Background pixels get default forward-facing normal
      if (mask && mask[i] < 128) {
        normals[i3] = 0;
        normals[i3 + 1] = 0;
        normals[i3 + 2] = 1;
        continue;
      }

      // Compute gradients using central differences, with one-sided fallback at edges/mask boundaries
      let dx: number, dy: number;

      // X gradient
      const hasLeft = x > 0 && (!mask || mask[i - 1] >= 128);
      const hasRight = x < width - 1 && (!mask || mask[i + 1] >= 128);
      if (hasLeft && hasRight) {
        dx = depthData[i + 1] - depthData[i - 1];
      } else if (hasRight) {
        dx = (depthData[i + 1] - depthData[i]) * 2;
      } else if (hasLeft) {
        dx = (depthData[i] - depthData[i - 1]) * 2;
      } else {
        dx = 0;
      }

      // Y gradient
      const hasUp = y > 0 && (!mask || mask[i - width] >= 128);
      const hasDown = y < height - 1 && (!mask || mask[i + width] >= 128);
      if (hasUp && hasDown) {
        dy = depthData[i + width] - depthData[i - width];
      } else if (hasDown) {
        dy = (depthData[i + width] - depthData[i]) * 2;
      } else if (hasUp) {
        dy = (depthData[i] - depthData[i - width]) * 2;
      } else {
        dy = 0;
      }

      // Normal = normalize(-dx, -dy, strength)
      const nx = -dx;
      const ny = -dy;
      const nz = strength;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      if (len > 0) {
        normals[i3] = nx / len;
        normals[i3 + 1] = ny / len;
        normals[i3 + 2] = nz / len;
      } else {
        normals[i3] = 0;
        normals[i3 + 1] = 0;
        normals[i3 + 2] = 1;
      }
    }
  }

  return normals;
}
