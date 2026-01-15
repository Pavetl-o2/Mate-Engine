/**
 * Sprite Renderer - 2D sprite animation system
 *
 * Handles sprite sheets and frame-by-frame animation
 */

export class SpriteRenderer {
  constructor(container) {
    this.container = container;
    this.imageElement = null;
    this.currentAnimation = 'idle';
    this.animations = {};
    this.currentFrame = 0;
    this.frameTimer = null;
    this.isPlaying = false;
    this.usePlaceholder = false;
  }

  /**
   * Initialize the sprite renderer
   */
  async init(usePlaceholder = false) {
    this.usePlaceholder = usePlaceholder;
    this.imageElement = document.getElementById('sprite-image');

    if (usePlaceholder) {
      this.createPlaceholderSprite();
    } else {
      await this.loadSprites();
    }

    // Start idle animation
    this.playAnimation('idle');

    return true;
  }

  /**
   * Load sprite assets from the sprites folder
   */
  async loadSprites() {
    // Define expected animations
    const animationNames = ['idle', 'sitting', 'walking', 'dragging', 'wave'];

    for (const name of animationNames) {
      try {
        // Try to load spritesheet
        const spritePath = `../assets/sprites/${name}.png`;
        const configPath = `../assets/sprites/${name}.json`;

        // Check if sprite exists (we'll use a simple image for now)
        const img = new Image();
        img.src = spritePath;

        await new Promise((resolve, reject) => {
          img.onload = () => {
            this.animations[name] = {
              type: 'image',
              src: spritePath,
              image: img
            };
            resolve();
          };
          img.onerror = () => {
            // Animation not found, will use placeholder
            resolve();
          };
        });
      } catch (e) {
        console.log(`Sprite ${name} not found`);
      }
    }

    // If no animations loaded, use placeholder
    if (Object.keys(this.animations).length === 0) {
      this.createPlaceholderSprite();
    }
  }

  /**
   * Create a placeholder sprite using SVG
   */
  createPlaceholderSprite() {
    // Create SVG-based placeholder sprites for each animation
    const colors = {
      primary: '#9370DB',    // Purple
      skin: '#FFE4C4',       // Skin tone
      eyes: '#333333',
      blush: '#FFB6C1'
    };

    // Base avatar SVG
    const createAvatarSVG = (state = 'idle') => {
      let eyeY = 35;
      let bodyRotation = 0;
      let armRotation = 0;
      let legAngle = 0;

      switch (state) {
        case 'sitting':
          legAngle = -45;
          break;
        case 'dragging':
          bodyRotation = 5;
          break;
        case 'wave':
          armRotation = -45;
          break;
      }

      return `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150" width="100" height="150">
          <!-- Body -->
          <ellipse cx="50" cy="90" rx="25" ry="35" fill="${colors.primary}"
                   transform="rotate(${bodyRotation} 50 90)"/>

          <!-- Head -->
          <circle cx="50" cy="40" r="25" fill="${colors.skin}"/>

          <!-- Hair -->
          <ellipse cx="50" cy="30" rx="27" ry="18" fill="${colors.primary}"/>

          <!-- Eyes -->
          <ellipse cx="42" cy="${eyeY}" rx="4" ry="5" fill="${colors.eyes}"/>
          <ellipse cx="58" cy="${eyeY}" rx="4" ry="5" fill="${colors.eyes}"/>

          <!-- Eye shine -->
          <circle cx="43" cy="${eyeY - 1}" r="1.5" fill="white"/>
          <circle cx="59" cy="${eyeY - 1}" r="1.5" fill="white"/>

          <!-- Blush -->
          <ellipse cx="35" cy="45" rx="5" ry="3" fill="${colors.blush}" opacity="0.5"/>
          <ellipse cx="65" cy="45" rx="5" ry="3" fill="${colors.blush}" opacity="0.5"/>

          <!-- Mouth -->
          <path d="M 45 50 Q 50 55 55 50" stroke="${colors.eyes}" stroke-width="2" fill="none"/>

          <!-- Arms -->
          <ellipse cx="25" cy="85" rx="8" ry="20" fill="${colors.primary}"
                   transform="rotate(${armRotation} 25 85)"/>
          <ellipse cx="75" cy="85" rx="8" ry="20" fill="${colors.primary}"/>

          <!-- Legs -->
          <ellipse cx="40" cy="125" rx="10" ry="20" fill="${colors.primary}"
                   transform="rotate(${legAngle} 40 125)"/>
          <ellipse cx="60" cy="125" rx="10" ry="20" fill="${colors.primary}"
                   transform="rotate(${-legAngle} 60 125)"/>

          <!-- Feet -->
          <ellipse cx="38" cy="142" rx="12" ry="6" fill="${colors.primary}"
                   transform="rotate(${legAngle / 2} 38 142)"/>
          <ellipse cx="62" cy="142" rx="12" ry="6" fill="${colors.primary}"
                   transform="rotate(${-legAngle / 2} 62 142)"/>
        </svg>
      `;
    };

    // Create placeholder animations
    this.animations = {
      idle: {
        type: 'svg',
        frames: [createAvatarSVG('idle')],
        frameRate: 1
      },
      sitting: {
        type: 'svg',
        frames: [createAvatarSVG('sitting')],
        frameRate: 1
      },
      dragging: {
        type: 'svg',
        frames: [createAvatarSVG('dragging')],
        frameRate: 1
      },
      wave: {
        type: 'svg',
        frames: [createAvatarSVG('wave')],
        frameRate: 4
      }
    };

    // Add idle breathing animation
    this.addBreathingAnimation();
  }

  /**
   * Add subtle breathing animation to idle
   */
  addBreathingAnimation() {
    const colors = {
      primary: '#9370DB',
      skin: '#FFE4C4',
      eyes: '#333333',
      blush: '#FFB6C1'
    };

    const frames = [];
    const frameCount = 8;

    for (let i = 0; i < frameCount; i++) {
      const breathOffset = Math.sin((i / frameCount) * Math.PI * 2) * 2;
      const eyeBlink = i === 3 ? 1 : 5; // Blink on frame 3

      frames.push(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150" width="100" height="150">
          <!-- Body with breathing -->
          <ellipse cx="50" cy="${90 + breathOffset}" rx="25" ry="${35 + breathOffset}" fill="${colors.primary}"/>

          <!-- Head -->
          <circle cx="50" cy="${40 + breathOffset * 0.3}" r="25" fill="${colors.skin}"/>

          <!-- Hair -->
          <ellipse cx="50" cy="${30 + breathOffset * 0.3}" rx="27" ry="18" fill="${colors.primary}"/>

          <!-- Eyes (with blink) -->
          <ellipse cx="42" cy="35" rx="4" ry="${eyeBlink}" fill="${colors.eyes}"/>
          <ellipse cx="58" cy="35" rx="4" ry="${eyeBlink}" fill="${colors.eyes}"/>

          ${eyeBlink > 1 ? `
            <!-- Eye shine -->
            <circle cx="43" cy="34" r="1.5" fill="white"/>
            <circle cx="59" cy="34" r="1.5" fill="white"/>
          ` : ''}

          <!-- Blush -->
          <ellipse cx="35" cy="45" rx="5" ry="3" fill="${colors.blush}" opacity="0.5"/>
          <ellipse cx="65" cy="45" rx="5" ry="3" fill="${colors.blush}" opacity="0.5"/>

          <!-- Mouth -->
          <path d="M 45 50 Q 50 55 55 50" stroke="${colors.eyes}" stroke-width="2" fill="none"/>

          <!-- Arms -->
          <ellipse cx="25" cy="${85 + breathOffset}" rx="8" ry="20" fill="${colors.primary}"/>
          <ellipse cx="75" cy="${85 + breathOffset}" rx="8" ry="20" fill="${colors.primary}"/>

          <!-- Legs -->
          <ellipse cx="40" cy="125" rx="10" ry="20" fill="${colors.primary}"/>
          <ellipse cx="60" cy="125" rx="10" ry="20" fill="${colors.primary}"/>

          <!-- Feet -->
          <ellipse cx="38" cy="142" rx="12" ry="6" fill="${colors.primary}"/>
          <ellipse cx="62" cy="142" rx="12" ry="6" fill="${colors.primary}"/>
        </svg>
      `);
    }

    this.animations.idle = {
      type: 'svg',
      frames: frames,
      frameRate: 6 // 6 FPS for smooth breathing
    };
  }

  /**
   * Play an animation by name
   */
  playAnimation(name) {
    // Stop current animation
    this.stop();

    // Get animation data
    const anim = this.animations[name] || this.animations.idle;
    if (!anim) return;

    this.currentAnimation = name;
    this.currentFrame = 0;
    this.isPlaying = true;

    // Display first frame
    this.displayFrame(anim, 0);

    // Start animation loop if multiple frames
    if (anim.frames && anim.frames.length > 1) {
      const frameDelay = 1000 / (anim.frameRate || 10);
      this.frameTimer = setInterval(() => {
        this.currentFrame = (this.currentFrame + 1) % anim.frames.length;
        this.displayFrame(anim, this.currentFrame);
      }, frameDelay);
    } else if (anim.type === 'image') {
      // Single image animation
      this.imageElement.src = anim.src;
    }
  }

  /**
   * Display a specific frame
   */
  displayFrame(anim, frameIndex) {
    if (anim.type === 'svg') {
      const svgData = anim.frames[frameIndex];
      const blob = new Blob([svgData], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);

      // Clean up previous URL
      if (this.imageElement.src.startsWith('blob:')) {
        URL.revokeObjectURL(this.imageElement.src);
      }

      this.imageElement.src = url;
    } else if (anim.type === 'spritesheet') {
      // Handle spritesheet (to be implemented)
      // Would use CSS background-position
    }
  }

  /**
   * Stop current animation
   */
  stop() {
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
    this.isPlaying = false;
  }

  /**
   * Get current animation name
   */
  getCurrentAnimation() {
    return this.currentAnimation;
  }

  /**
   * Check if animation exists
   */
  hasAnimation(name) {
    return name in this.animations;
  }

  /**
   * Cleanup resources
   */
  dispose() {
    this.stop();
    if (this.imageElement && this.imageElement.src.startsWith('blob:')) {
      URL.revokeObjectURL(this.imageElement.src);
    }
  }
}
