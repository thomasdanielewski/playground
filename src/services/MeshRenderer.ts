import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { MeshData } from './ImageProcessor';

export type RendererType = 'webgpu' | 'webgl';
export type MaterialMode = 'clay' | 'textured';

/**
 * Three.js mesh renderer with texture mapping, normals, and lighting.
 * Supports clay (white) and textured material modes.
 *
 * Use the static `create()` factory (async) instead of `new`.
 */
export class MeshRenderer {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private renderer!: any;
  private controls!: OrbitControls;
  private mesh: THREE.Mesh | null = null;
  private currentTexture: THREE.Texture | null = null;
  private animationFrameId = 0;
  private mountElement!: HTMLElement;
  private _rendererType: RendererType = 'webgl';
  private _materialMode: MaterialMode = 'clay';
  private _disposed = false;

  private constructor() {}

  static async create(mountElement: HTMLElement): Promise<MeshRenderer> {
    const r = new MeshRenderer();
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

    // Lighting — 3-point + rim for clay material
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    r.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(1, 1, 2);
    r.scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-1, -0.5, -1);
    r.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.4);
    rim.position.set(0, 0, -2);
    r.scene.add(rim);

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

  private async initRenderer(mount: HTMLElement): Promise<any> {
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

    const gl = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    gl.setSize(mount.clientWidth, mount.clientHeight);
    gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._rendererType = 'webgl';
    return gl;
  }

  private animate = (): void => {
    if (this._disposed) return;
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private createMaterial(): THREE.Material {
    if (this._materialMode === 'clay') {
      return new THREE.MeshStandardMaterial({
        color: 0xe8e8e8,
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.FrontSide,
      });
    }
    return new THREE.MeshStandardMaterial({
      map: this.currentTexture,
      side: THREE.FrontSide,
      roughness: 0.8,
      metalness: 0.0,
    });
  }

  // ── Public API ──────────────────────────────────────────

  async setMesh(meshData: MeshData, imageUrl: string): Promise<void> {
    this.clearMesh();

    // Build geometry
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    geo.computeVertexNormals();

    // Load texture (needed for textured mode toggle)
    const texture = await new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(
        imageUrl,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.flipY = false;
          resolve(tex);
        },
        undefined,
        reject
      );
    });
    this.currentTexture = texture;

    this.mesh = new THREE.Mesh(geo, this.createMaterial());

    // Centre on Z
    geo.computeBoundingBox();
    if (geo.boundingBox) {
      const centre = new THREE.Vector3();
      geo.boundingBox.getCenter(centre);
      this.mesh.position.z = -centre.z;
    }

    this.scene.add(this.mesh);
  }

  setMaterialMode(mode: MaterialMode): void {
    this._materialMode = mode;
    if (this.mesh) {
      (this.mesh.material as THREE.Material).dispose();
      this.mesh.material = this.createMaterial();
    }
  }

  getMaterialMode(): MaterialMode { return this._materialMode; }

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

  exportGLB(): Promise<Blob> {
    if (!this.mesh) return Promise.reject(new Error('No mesh to export'));

    const exportMesh = new THREE.Mesh(
      this.mesh.geometry,
      new THREE.MeshStandardMaterial({
        map: this.currentTexture,
        side: THREE.FrontSide,
        roughness: 0.8,
        metalness: 0.0,
      })
    );
    exportMesh.position.copy(this.mesh.position);

    return new Promise((resolve, reject) => {
      new GLTFExporter().parse(
        exportMesh,
        (result) => {
          (exportMesh.material as THREE.Material).dispose();
          if (result instanceof ArrayBuffer) {
            resolve(new Blob([result], { type: 'model/gltf-binary' }));
          } else {
            reject(new Error('Unexpected GLTFExporter output'));
          }
        },
        (error) => {
          (exportMesh.material as THREE.Material).dispose();
          reject(error);
        },
        { binary: true }
      );
    });
  }

  dispose(): void {
    this._disposed = true;
    cancelAnimationFrame(this.animationFrameId);
    this.clearMesh();
    this.controls.dispose();
    if (this.mountElement?.contains(this.renderer.domElement)) {
      this.mountElement.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }

  private clearMesh(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh = null;
    if (this.currentTexture) {
      this.currentTexture.dispose();
      this.currentTexture = null;
    }
  }
}
