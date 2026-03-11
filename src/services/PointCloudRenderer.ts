import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type RendererType = 'webgpu' | 'webgl';

/**
 * Manages the Three.js scene, renderer, camera and OrbitControls.
 * Attempts WebGPU acceleration with automatic WebGL fallback.
 *
 * Use the static `create()` factory (async) instead of `new`.
 */
export class PointCloudRenderer {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  // Using `any` because WebGPURenderer and WebGLRenderer share
  // the same render()-compatible API but have no common TS base.
  private renderer!: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  private controls!: OrbitControls;
  private points: THREE.Points | null = null;
  private animationFrameId = 0;
  private mountElement!: HTMLElement;
  private _rendererType: RendererType = 'webgl';
  private _disposed = false;

  /* Private — use PointCloudRenderer.create() */
  private constructor() {}

  /** Async factory — sets up scene, renderer (WebGPU→WebGL) and controls. */
  static async create(mountElement: HTMLElement): Promise<PointCloudRenderer> {
    const r = new PointCloudRenderer();
    r.mountElement = mountElement;

    // Scene
    r.scene = new THREE.Scene();
    r.scene.background = new THREE.Color(0x08080a);

    // Camera
    const aspect = mountElement.clientWidth / mountElement.clientHeight;
    r.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    r.camera.position.z = 2;

    // Renderer (WebGPU → WebGL fallback)
    r.renderer = await r.initRenderer(mountElement);

    // Controls
    r.controls = new OrbitControls(r.camera, r.renderer.domElement);
    r.controls.enableDamping = true;
    r.controls.dampingFactor = 0.05;
    r.controls.rotateSpeed = 0.8;
    r.controls.zoomSpeed = 1.2;

    mountElement.appendChild(r.renderer.domElement);
    r.animate();
    return r;
  }

  // ── Renderer initialisation ─────────────────────────────

  private async initRenderer(mount: HTMLElement): Promise<any> {
    // Attempt WebGPU
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
      try {
        const gpu = (navigator as any).gpu; // eslint-disable-line
        const adapter = await gpu.requestAdapter();
        if (adapter) {
          const { WebGPURenderer } = await import(
            /* webpackChunkName: "webgpu" */ 'three/webgpu'
          );
          const wgpu = new WebGPURenderer({ antialias: true });
          await wgpu.init();
          wgpu.setSize(mount.clientWidth, mount.clientHeight);
          wgpu.setPixelRatio(Math.min(window.devicePixelRatio, 2));
          this._rendererType = 'webgpu';
          return wgpu;
        }
      } catch (e) {
        console.warn('[Renderer] WebGPU unavailable, using WebGL:', e);
      }
    }

    // Fallback: WebGL
    const gl = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    gl.setSize(mount.clientWidth, mount.clientHeight);
    gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._rendererType = 'webgl';
    return gl;
  }

  // ── Animation loop ──────────────────────────────────────

  private animate = (): void => {
    if (this._disposed) return;
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  // ── Public API ──────────────────────────────────────────

  setPointCloud(positions: Float32Array, colors: Float32Array, pointSize: number): void {
    this.clearPoints();

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: pointSize,
      vertexColors: true,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geo, mat);

    // Centre on Z
    geo.computeBoundingBox();
    if (geo.boundingBox) {
      const centre = new THREE.Vector3();
      geo.boundingBox.getCenter(centre);
      this.points.position.z = -centre.z;
    }

    this.scene.add(this.points);
  }

  resetCamera(): void {
    this.camera.position.set(0, -0.15, 2);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  resize(): void {
    if (this._disposed || !this.mountElement) return;
    const w = this.mountElement.clientWidth;
    const h = this.mountElement.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  getRendererType(): RendererType { return this._rendererType; }

  dispose(): void {
    this._disposed = true;
    cancelAnimationFrame(this.animationFrameId);
    this.clearPoints();
    this.controls.dispose();
    if (this.mountElement?.contains(this.renderer.domElement)) {
      this.mountElement.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }

  // ── Helpers ─────────────────────────────────────────────

  private clearPoints(): void {
    if (!this.points) return;
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.points = null;
  }
}
