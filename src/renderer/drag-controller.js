/**
 * Drag Controller - Handle avatar dragging
 *
 * Manages mouse interactions for dragging the avatar around the screen
 */

export class DragController {
  constructor(avatar) {
    this.avatar = avatar;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.lastPosition = { x: 0, y: 0 };
    this.container = null;

    // Bind methods
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);
  }

  /**
   * Initialize drag controller
   */
  init() {
    this.container = document.getElementById('avatar-container');

    // Mouse events
    this.container.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);

    // Right-click context menu prevention
    this.container.addEventListener('contextmenu', this.onContextMenu);

    // Touch events for future touch support
    this.container.addEventListener('touchstart', this.onTouchStart.bind(this));
    document.addEventListener('touchmove', this.onTouchMove.bind(this));
    document.addEventListener('touchend', this.onTouchEnd.bind(this));

    console.log('Drag controller initialized');
  }

  /**
   * Handle mouse down - start dragging
   */
  async onMouseDown(event) {
    // Only respond to left click
    if (event.button !== 0) return;

    event.preventDefault();

    this.isDragging = true;
    this.container.classList.add('dragging');

    // Get current window position
    const pos = await window.avatarAPI.getPosition();
    this.lastPosition = pos;

    // Calculate offset from click position to window position
    this.dragOffset = {
      x: event.screenX - pos.x,
      y: event.screenY - pos.y
    };

    // Notify avatar of drag start
    this.avatar.onDragStart();
  }

  /**
   * Handle mouse move - update position while dragging
   */
  async onMouseMove(event) {
    if (!this.isDragging) return;

    // Calculate new position
    const newX = event.screenX - this.dragOffset.x;
    const newY = event.screenY - this.dragOffset.y;

    // Constrain to screen bounds
    const screenInfo = await window.avatarAPI.getScreenInfo();
    const size = await window.avatarAPI.getSize();

    const constrainedX = Math.max(0, Math.min(newX, screenInfo.width - size.width));
    const constrainedY = Math.max(0, Math.min(newY, screenInfo.height - size.height));

    // Update position
    await this.avatar.updatePosition(constrainedX, constrainedY);
    this.lastPosition = { x: constrainedX, y: constrainedY };
  }

  /**
   * Handle mouse up - stop dragging
   */
  onMouseUp(event) {
    if (!this.isDragging) return;

    this.isDragging = false;
    this.container.classList.remove('dragging');

    // Notify avatar of drag end
    this.avatar.onDragEnd();
  }

  /**
   * Handle context menu (right-click)
   */
  onContextMenu(event) {
    // For now, prevent default
    // In future, could show custom menu
    event.preventDefault();
  }

  /**
   * Touch support - touchstart
   */
  onTouchStart(event) {
    if (event.touches.length !== 1) return;

    const touch = event.touches[0];
    // Simulate mouse down
    this.onMouseDown({
      button: 0,
      screenX: touch.screenX,
      screenY: touch.screenY,
      preventDefault: () => {}
    });
  }

  /**
   * Touch support - touchmove
   */
  onTouchMove(event) {
    if (!this.isDragging || event.touches.length !== 1) return;

    const touch = event.touches[0];
    this.onMouseMove({
      screenX: touch.screenX,
      screenY: touch.screenY
    });
  }

  /**
   * Touch support - touchend
   */
  onTouchEnd(event) {
    this.onMouseUp({});
  }

  /**
   * Check if currently dragging
   */
  getIsDragging() {
    return this.isDragging;
  }

  /**
   * Cleanup event listeners
   */
  dispose() {
    if (this.container) {
      this.container.removeEventListener('mousedown', this.onMouseDown);
      this.container.removeEventListener('contextmenu', this.onContextMenu);
    }
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  }
}
