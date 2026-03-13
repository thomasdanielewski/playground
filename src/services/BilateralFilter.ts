/**
 * Edge-preserving bilateral filter for depth maps.
 * Smooths noise while preserving sharp depth discontinuities at object boundaries.
 */
export function bilateralFilter(
  depthData: Uint8Array,
  width: number,
  height: number,
  kernelRadius = 3,
  spatialSigma = 2.5,
  rangeSigma = 15
): Uint8Array {
  const output = new Uint8Array(depthData.length);

  // Pre-compute spatial Gaussian weights (same for every pixel)
  const kernelSize = kernelRadius * 2 + 1;
  const spatialWeights = new Float64Array(kernelSize * kernelSize);
  const spatialDenom = 2 * spatialSigma * spatialSigma;

  for (let dy = -kernelRadius; dy <= kernelRadius; dy++) {
    for (let dx = -kernelRadius; dx <= kernelRadius; dx++) {
      const idx = (dy + kernelRadius) * kernelSize + (dx + kernelRadius);
      spatialWeights[idx] = Math.exp(-(dx * dx + dy * dy) / spatialDenom);
    }
  }

  const rangeDenom = 2 * rangeSigma * rangeSigma;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const centerVal = depthData[y * width + x];
      let weightedSum = 0;
      let totalWeight = 0;

      for (let dy = -kernelRadius; dy <= kernelRadius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;

        for (let dx = -kernelRadius; dx <= kernelRadius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;

          const neighborVal = depthData[ny * width + nx];
          const diff = neighborVal - centerVal;

          const spatialIdx = (dy + kernelRadius) * kernelSize + (dx + kernelRadius);
          const rangeWeight = Math.exp(-(diff * diff) / rangeDenom);
          const weight = spatialWeights[spatialIdx] * rangeWeight;

          weightedSum += neighborVal * weight;
          totalWeight += weight;
        }
      }

      output[y * width + x] = Math.round(weightedSum / totalWeight);
    }
  }

  return output;
}
