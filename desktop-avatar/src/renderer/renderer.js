/**
 * Desktop Avatar - Main Renderer
 *
 * Initializes the avatar rendering system and coordinates all components
 */

import { AvatarRenderer } from './avatar-renderer.js';
import { DragController } from './drag-controller.js';
import { WindowSitter } from './window-sitter.js';
import { SpriteRenderer } from './sprite-renderer.js';

class DesktopAvatar {
  constructor() {
    this.mode = 'sprite'; // '3d' or 'sprite'
    this.avatarRenderer = null;
    this.spriteRenderer = null;
    this.dragController = null;
    this.windowSitter = null;
    this.isInitialized = false;
    this.debugMode = false;

    // Avatar state
    this.state = {
      animation: 'idle',
      isSitting: false,
      sittingOn: null,
      isDragging: false,
      position: { x: 0, y: 0 }
    };

    this.init();
  }

  /**
   * Initialize the avatar system
   */
  async init() {
    console.log('Initializing Desktop Avatar...');
    console.log('Platform:', window.avatarAPI.platform);

    // Get initial position
    this.state.position = await window.avatarAPI.getPosition();

    // Check what assets are available
    const hasModel = await this.checkForModel();
    const hasSprite = await this.checkForSprite();

    if (hasModel) {
      this.mode = '3d';
      await this.init3DMode();
    } else if (hasSprite) {
      this.mode = 'sprite';
      await this.initSpriteMode();
    } else {
      // Use default placeholder
      this.mode = 'sprite';
      await this.initSpriteMode(true);
    }

    // Initialize drag controller
    this.dragController = new DragController(this);
    this.dragController.init();

    // Initialize window sitter
    this.windowSitter = new WindowSitter(this);
    await this.windowSitter.init();

    // Setup debug mode toggle (press D)
    this.setupDebugMode();

    this.isInitialized = true;
    console.log(`Desktop Avatar initialized in ${this.mode} mode`);
  }

  /**
   * Check if a 3D model exists
   */
  async checkForModel() {
    // Will be implemented when user adds models
    return false;
  }

  /**
   * Check if sprites exist
   */
  async checkForSprite() {
    // Check for default sprite
    return true; // For now, we'll use placeholder
  }

  /**
   * Initialize 3D rendering mode
   */
  async init3DMode() {
    const canvas = document.getElementById('avatar-canvas');
    document.getElementById('sprite-container').style.display = 'none';
    canvas.style.display = 'block';

    this.avatarRenderer = new AvatarRenderer(canvas);
    await this.avatarRenderer.init();
  }

  /**
   * Initialize sprite rendering mode
   */
  async initSpriteMode(usePlaceholder = false) {
    const canvas = document.getElementById('avatar-canvas');
    const spriteContainer = document.getElementById('sprite-container');

    canvas.style.display = 'none';
    spriteContainer.style.display = 'flex';

    this.spriteRenderer = new SpriteRenderer(spriteContainer);
    await this.spriteRenderer.init(usePlaceholder);
  }

  /**
   * Set animation state
   */
  setAnimation(name) {
    if (this.state.animation === name) return;

    this.state.animation = name;

    if (this.mode === '3d' && this.avatarRenderer) {
      this.avatarRenderer.playAnimation(name);
    } else if (this.mode === 'sprite' && this.spriteRenderer) {
      this.spriteRenderer.playAnimation(name);
    }
  }

  /**
   * Get current renderer
   */
  getRenderer() {
    return this.mode === '3d' ? this.avatarRenderer : this.spriteRenderer;
  }

  /**
   * Handle drag start
   */
  onDragStart() {
    this.state.isDragging = true;
    this.setAnimation('dragging');

    // Exit sitting state
    if (this.state.isSitting) {
      this.windowSitter.exitSitting();
    }
  }

  /**
   * Handle drag end
   */
  onDragEnd() {
    this.state.isDragging = false;

    // Check if we should sit on a window
    this.windowSitter.checkForSitting();
  }

  /**
   * Handle sitting on window
   */
  onSitStart(window) {
    this.state.isSitting = true;
    this.state.sittingOn = window;
    this.setAnimation('sitting');
  }

  /**
   * Handle exiting sitting
   */
  onSitEnd() {
    this.state.isSitting = false;
    this.state.sittingOn = null;
    this.setAnimation('idle');
  }

  /**
   * Update avatar position
   */
  async updatePosition(x, y) {
    this.state.position = { x, y };
    await window.avatarAPI.setPosition(x, y);
  }

  /**
   * Setup debug mode
   */
  setupDebugMode() {
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'd' && e.ctrlKey) {
        this.toggleDebugMode();
      }
    });
  }

  /**
   * Toggle debug overlay
   */
  toggleDebugMode() {
    this.debugMode = !this.debugMode;
    const overlay = document.getElementById('debug-overlay');
    overlay.style.display = this.debugMode ? 'block' : 'none';

    if (this.debugMode) {
      this.updateDebugInfo();
    }
  }

  /**
   * Update debug information
   */
  updateDebugInfo() {
    if (!this.debugMode) return;

    const info = document.getElementById('debug-info');
    info.textContent = `
Mode: ${this.mode}
State: ${this.state.animation}
Position: ${this.state.position.x}, ${this.state.position.y}
Sitting: ${this.state.isSitting}
Dragging: ${this.state.isDragging}
    `.trim();

    requestAnimationFrame(() => this.updateDebugInfo());
  }
}

// Start the application
const avatar = new DesktopAvatar();

// Expose for debugging
window.desktopAvatar = avatar;
