/**
 * Window Sitter - Avatar window sitting system
 *
 * Handles detection and positioning for sitting on window edges and taskbar
 */

export class WindowSitter {
  constructor(avatar) {
    this.avatar = avatar;
    this.isSitting = false;
    this.sittingTarget = null;
    this.sittingType = null; // 'window' or 'taskbar'
    this.windows = [];
    this.taskbarInfo = null;

    // Configuration
    this.config = {
      snapThreshold: 30,      // Pixels to snap to window edge
      followInterval: 100,    // ms between position updates when sitting
      windowRefreshRate: 500  // ms between window list refreshes
    };

    // Timers
    this.followTimer = null;
    this.windowRefreshTimer = null;

    // Sitting offset (to position avatar ON TOP of window, not inside)
    this.sittingOffset = { x: 0, y: 0 };
  }

  /**
   * Initialize the window sitter
   */
  async init() {
    // Get initial window list
    await this.refreshWindows();

    // Get taskbar info
    this.taskbarInfo = await window.avatarAPI.getTaskbarInfo();

    // Start periodic window refresh
    this.windowRefreshTimer = setInterval(() => {
      this.refreshWindows();
    }, this.config.windowRefreshRate);

    console.log('Window sitter initialized');
    console.log('Taskbar info:', this.taskbarInfo);
  }

  /**
   * Refresh the list of windows
   */
  async refreshWindows() {
    try {
      this.windows = await window.avatarAPI.getWindows();
    } catch (e) {
      console.error('Failed to refresh windows:', e);
    }
  }

  /**
   * Check if avatar should sit on a window
   * Called when dragging ends
   */
  async checkForSitting() {
    const pos = await window.avatarAPI.getPosition();
    const size = await window.avatarAPI.getSize();

    // Avatar bottom position (where "feet" would be)
    const avatarBottom = pos.y + size.height;
    const avatarCenterX = pos.x + size.width / 2;

    // First check taskbar
    if (this.taskbarInfo) {
      const taskbarMatch = this.checkTaskbarProximity(avatarCenterX, avatarBottom);
      if (taskbarMatch) {
        await this.sitOnTaskbar(taskbarMatch);
        return;
      }
    }

    // Then check windows
    const windowMatch = this.findBestWindowToSit(avatarCenterX, avatarBottom);
    if (windowMatch) {
      await this.sitOnWindow(windowMatch);
      return;
    }

    // No match - ensure idle animation
    if (!this.avatar.state.isDragging) {
      this.avatar.setAnimation('idle');
    }
  }

  /**
   * Check if avatar is near the taskbar
   */
  checkTaskbarProximity(x, y) {
    if (!this.taskbarInfo) return null;

    const tb = this.taskbarInfo;
    const threshold = this.config.snapThreshold;

    // Check based on taskbar position
    switch (tb.position) {
      case 'bottom':
        if (Math.abs(y - tb.y) <= threshold && x >= tb.x && x <= tb.x + tb.width) {
          return { type: 'taskbar', edge: 'top', ...tb };
        }
        break;
      case 'top':
        if (Math.abs(y - (tb.y + tb.height)) <= threshold && x >= tb.x && x <= tb.x + tb.width) {
          return { type: 'taskbar', edge: 'bottom', ...tb };
        }
        break;
      case 'left':
        if (Math.abs(x - (tb.x + tb.width)) <= threshold && y >= tb.y && y <= tb.y + tb.height) {
          return { type: 'taskbar', edge: 'right', ...tb };
        }
        break;
      case 'right':
        if (Math.abs(x - tb.x) <= threshold && y >= tb.y && y <= tb.y + tb.height) {
          return { type: 'taskbar', edge: 'left', ...tb };
        }
        break;
    }

    return null;
  }

  /**
   * Find the best window to sit on
   */
  findBestWindowToSit(avatarX, avatarY) {
    const threshold = this.config.snapThreshold;
    let bestMatch = null;
    let bestDistance = Infinity;

    for (const win of this.windows) {
      // Check if avatar X is within window horizontal bounds
      if (avatarX < win.x - 50 || avatarX > win.x + win.width + 50) {
        continue;
      }

      // Check distance to window top edge
      const distanceToTop = Math.abs(avatarY - win.y);

      if (distanceToTop <= threshold && distanceToTop < bestDistance) {
        bestDistance = distanceToTop;
        bestMatch = {
          type: 'window',
          ...win
        };
      }
    }

    return bestMatch;
  }

  /**
   * Sit on a window
   */
  async sitOnWindow(target) {
    this.isSitting = true;
    this.sittingTarget = target;
    this.sittingType = 'window';

    // Calculate position to sit on top edge
    const size = await window.avatarAPI.getSize();
    const pos = await window.avatarAPI.getPosition();

    // Position avatar so it sits ON the window edge
    // Avatar bottom should align with window top
    const newY = target.y - size.height;

    // Keep X position (where user dropped it) but constrain to window width
    const minX = target.x - size.width / 2;
    const maxX = target.x + target.width - size.width / 2;
    const newX = Math.max(minX, Math.min(pos.x, maxX));

    // Store offset from window for following
    this.sittingOffset = {
      x: newX - target.x,
      y: 0 // Always sit on top edge
    };

    // Update position
    await this.avatar.updatePosition(newX, newY);

    // Notify avatar
    this.avatar.onSitStart(target);

    // Start following the window
    this.startFollowing();

    console.log(`Sitting on window: ${target.title}`);
  }

  /**
   * Sit on the taskbar
   */
  async sitOnTaskbar(target) {
    this.isSitting = true;
    this.sittingTarget = target;
    this.sittingType = 'taskbar';

    const size = await window.avatarAPI.getSize();
    const pos = await window.avatarAPI.getPosition();

    let newX = pos.x;
    let newY = pos.y;

    // Position based on taskbar edge
    switch (target.position) {
      case 'bottom':
        newY = target.y - size.height;
        break;
      case 'top':
        newY = target.y + target.height;
        break;
      case 'left':
        newX = target.x + target.width;
        break;
      case 'right':
        newX = target.x - size.width;
        break;
    }

    // Constrain to taskbar width/height
    if (target.position === 'bottom' || target.position === 'top') {
      newX = Math.max(target.x, Math.min(newX, target.x + target.width - size.width));
    } else {
      newY = Math.max(target.y, Math.min(newY, target.y + target.height - size.height));
    }

    this.sittingOffset = {
      x: newX - target.x,
      y: newY - target.y
    };

    await this.avatar.updatePosition(newX, newY);
    this.avatar.onSitStart(target);

    // Taskbar doesn't move, but we still follow for consistency
    this.startFollowing();

    console.log('Sitting on taskbar');
  }

  /**
   * Start following the target window
   */
  startFollowing() {
    this.stopFollowing(); // Clear any existing timer

    this.followTimer = setInterval(async () => {
      if (!this.isSitting || !this.sittingTarget) {
        this.stopFollowing();
        return;
      }

      if (this.sittingType === 'window') {
        await this.followWindow();
      }
      // Taskbar doesn't need following (it doesn't move)
    }, this.config.followInterval);
  }

  /**
   * Follow a window as it moves
   */
  async followWindow() {
    // Refresh window positions
    await this.refreshWindows();

    // Find the target window in the updated list
    const target = this.windows.find(w =>
      w.title === this.sittingTarget.title ||
      (Math.abs(w.x - this.sittingTarget.x) < 50 &&
       Math.abs(w.y - this.sittingTarget.y) < 50)
    );

    if (!target) {
      // Window closed or not found
      console.log('Target window lost, exiting sitting');
      this.exitSitting();
      return;
    }

    // Update sitting target
    this.sittingTarget = { ...target, type: 'window' };

    // Calculate new position
    const size = await window.avatarAPI.getSize();
    const newX = target.x + this.sittingOffset.x;
    const newY = target.y - size.height;

    // Update position
    await this.avatar.updatePosition(newX, newY);
  }

  /**
   * Stop following
   */
  stopFollowing() {
    if (this.followTimer) {
      clearInterval(this.followTimer);
      this.followTimer = null;
    }
  }

  /**
   * Exit sitting state
   */
  exitSitting() {
    this.stopFollowing();
    this.isSitting = false;
    this.sittingTarget = null;
    this.sittingType = null;
    this.sittingOffset = { x: 0, y: 0 };

    // Notify avatar
    this.avatar.onSitEnd();

    console.log('Exited sitting');
  }

  /**
   * Get current sitting status
   */
  getSittingStatus() {
    return {
      isSitting: this.isSitting,
      target: this.sittingTarget,
      type: this.sittingType
    };
  }

  /**
   * Cleanup resources
   */
  dispose() {
    this.stopFollowing();
    if (this.windowRefreshTimer) {
      clearInterval(this.windowRefreshTimer);
      this.windowRefreshTimer = null;
    }
  }
}
