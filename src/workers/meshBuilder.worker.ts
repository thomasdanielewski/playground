import { bilateralFilter } from '../services/BilateralFilter';
import { estimateNormals } from '../services/normalEstimation';
import { buildMeshData } from '../services/meshBuilder';

export interface MeshWorkerInput {
  depthData: Uint8Array;
  width: number;
  height: number;
  mask: Uint8Array | null;
  kernelRadius: number;
  spatialSigma: number;
  rangeSigma: number;
  depthScale: number;
  shellThickness: number;
  normalStrength: number;
}

self.onmessage = (e: MessageEvent<MeshWorkerInput>) => {
  const { depthData, width, height, mask, kernelRadius, spatialSigma, rangeSigma, depthScale, shellThickness, normalStrength } = e.data;

  // Two-pass bilateral filter
  const pass1 = bilateralFilter(depthData, width, height, kernelRadius, spatialSigma, rangeSigma);
  const smoothed = bilateralFilter(pass1, width, height, kernelRadius, spatialSigma, rangeSigma);

  // Compute surface normals from smoothed depth
  const normalData = estimateNormals(smoothed, width, height, mask, normalStrength);

  // Build mesh with normals
  const meshData = buildMeshData(smoothed, width, height, mask, depthScale, shellThickness, normalData);

  // Transfer ArrayBuffers back for zero-copy
  const transfers = [meshData.positions.buffer, meshData.normals.buffer, meshData.indices.buffer, meshData.uvs.buffer];
  (self as unknown as Worker).postMessage(meshData, transfers);
};
