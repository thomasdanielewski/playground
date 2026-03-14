import { bilateralFilter } from '../services/BilateralFilter';
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
}

self.onmessage = (e: MessageEvent<MeshWorkerInput>) => {
  const { depthData, width, height, mask, kernelRadius, spatialSigma, rangeSigma, depthScale, shellThickness } = e.data;

  // Two-pass bilateral filter
  const pass1 = bilateralFilter(depthData, width, height, kernelRadius, spatialSigma, rangeSigma);
  const smoothed = bilateralFilter(pass1, width, height, kernelRadius, spatialSigma, rangeSigma);

  // Build mesh
  const meshData = buildMeshData(smoothed, width, height, mask, depthScale, shellThickness);

  // Transfer ArrayBuffers back for zero-copy
  const transfers = [meshData.positions.buffer, meshData.indices.buffer, meshData.uvs.buffer];
  (self as unknown as Worker).postMessage(meshData, transfers);
};
