/**
 * Avatar Renderer - Three.js 3D avatar rendering
 *
 * Handles loading and rendering GLB/GLTF models with animations
 */

// Note: Three.js will be loaded from node_modules
// In production, we'll bundle this properly

export class AvatarRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.model = null;
    this.mixer = null;
    this.animations = {};
    this.currentAnimation = null;
    this.clock = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the Three.js scene
   */
  async init() {
    // Dynamic import of Three.js
    const THREE = await this.loadThreeJS();
    if (!THREE) {
      console.error('Failed to load Three.js');
      return false;
    }

    this.THREE = THREE;
    this.clock = new THREE.Clock();

    // Create scene
    this.scene = new THREE.Scene();

    // Create camera (orthographic for 2D-like view)
    const aspect = this.canvas.width / this.canvas.height;
    const frustumSize = 2;
    this.camera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      1000
    );
    this.camera.position.z = 5;

    // Create renderer with transparency
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false
    });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 0);

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 1, 2);
    this.scene.add(directionalLight);

    // Try to load model
    await this.loadModel();

    // Start render loop
    this.animate();

    // Handle resize
    window.addEventListener('resize', () => this.onResize());

    this.isInitialized = true;
    return true;
  }

  /**
   * Load Three.js dynamically
   */
  async loadThreeJS() {
    try {
      // In Electron, we can require directly
      const THREE = require('three');
      return THREE;
    } catch (e) {
      console.error('Could not load Three.js:', e);
      return null;
    }
  }

  /**
   * Load the 3D model
   */
  async loadModel() {
    try {
      const { GLTFLoader } = require('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();

      // Try to load user's model
      const modelPath = '../assets/models/avatar.glb';

      return new Promise((resolve) => {
        loader.load(
          modelPath,
          (gltf) => {
            this.model = gltf.scene;
            this.scene.add(this.model);

            // Center and scale the model
            this.fitModelToView();

            // Setup animations
            if (gltf.animations && gltf.animations.length > 0) {
              this.mixer = new this.THREE.AnimationMixer(this.model);
              gltf.animations.forEach((clip) => {
                this.animations[clip.name.toLowerCase()] = clip;
              });

              // Play idle animation if available
              this.playAnimation('idle');
            }

            console.log('Model loaded successfully');
            resolve(true);
          },
          (progress) => {
            console.log('Loading model:', (progress.loaded / progress.total * 100).toFixed(0) + '%');
          },
          (error) => {
            console.log('No custom model found, using placeholder');
            this.createPlaceholderModel();
            resolve(false);
          }
        );
      });
    } catch (e) {
      console.log('GLTFLoader not available, using placeholder');
      this.createPlaceholderModel();
    }
  }

  /**
   * Create a placeholder model when no GLB is provided
   */
  createPlaceholderModel() {
    const THREE = this.THREE;

    // Create a simple avatar placeholder (capsule shape)
    const group = new THREE.Group();

    // Body
    const bodyGeometry = new THREE.CapsuleGeometry(0.3, 0.6, 4, 8);
    const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x9370DB }); // Purple
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0;
    group.add(body);

    // Head
    const headGeometry = new THREE.SphereGeometry(0.25, 16, 16);
    const headMaterial = new THREE.MeshLambertMaterial({ color: 0xFFE4C4 }); // Skin tone
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 0.7;
    group.add(head);

    // Eyes
    const eyeGeometry = new THREE.SphereGeometry(0.05, 8, 8);
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x333333 });

    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    leftEye.position.set(-0.08, 0.75, 0.2);
    group.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    rightEye.position.set(0.08, 0.75, 0.2);
    group.add(rightEye);

    // Position the model
    group.position.y = -0.5;

    this.model = group;
    this.scene.add(this.model);
  }

  /**
   * Fit model to camera view
   */
  fitModelToView() {
    if (!this.model) return;

    const THREE = this.THREE;
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Scale to fit
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 1.5 / maxDim;
    this.model.scale.setScalar(scale);

    // Center horizontally, align to bottom
    this.model.position.x = -center.x * scale;
    this.model.position.y = -box.min.y * scale - 0.8;
    this.model.position.z = -center.z * scale;
  }

  /**
   * Play an animation by name
   */
  playAnimation(name) {
    if (!this.mixer || !this.animations[name]) {
      // Simple bobbing animation for placeholder
      this.animatePlaceholder(name);
      return;
    }

    if (this.currentAnimation) {
      this.currentAnimation.fadeOut(0.2);
    }

    const clip = this.animations[name];
    this.currentAnimation = this.mixer.clipAction(clip);
    this.currentAnimation.reset();
    this.currentAnimation.fadeIn(0.2);
    this.currentAnimation.play();
  }

  /**
   * Simple animation for placeholder model
   */
  animatePlaceholder(state) {
    // Will be enhanced with GSAP or similar
    this.placeholderState = state;
  }

  /**
   * Animation loop
   */
  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();

    // Update animation mixer
    if (this.mixer) {
      this.mixer.update(delta);
    }

    // Update placeholder animation
    if (this.model && !this.mixer) {
      this.updatePlaceholderAnimation(delta);
    }

    // Render
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Update placeholder model animation
   */
  updatePlaceholderAnimation(delta) {
    if (!this.model) return;

    const time = this.clock.getElapsedTime();

    // Idle bobbing
    if (this.placeholderState === 'idle' || !this.placeholderState) {
      this.model.position.y = -0.5 + Math.sin(time * 2) * 0.02;
    }
    // Sitting - lean back slightly
    else if (this.placeholderState === 'sitting') {
      this.model.rotation.x = 0.1;
      this.model.position.y = -0.6;
    }
    // Dragging - slight rotation
    else if (this.placeholderState === 'dragging') {
      this.model.rotation.z = Math.sin(time * 10) * 0.1;
    }
  }

  /**
   * Handle window resize
   */
  onResize() {
    if (!this.renderer || !this.camera) return;

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    this.renderer.setSize(width, height);

    const aspect = width / height;
    const frustumSize = 2;
    this.camera.left = -frustumSize * aspect / 2;
    this.camera.right = frustumSize * aspect / 2;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Cleanup resources
   */
  dispose() {
    if (this.renderer) {
      this.renderer.dispose();
    }
    if (this.scene) {
      this.scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(m => m.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
    }
  }
}
