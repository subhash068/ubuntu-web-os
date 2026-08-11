class DesktopPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
    this.desktopBody = page.locator('#desktop-body');
    this.startMenuBtn = page.locator('.start-menu-btn'); // Assuming there's a start menu button, though we can just interact with shortcuts
    this.startMenu = page.locator('#start-menu');
    this.calculatorShortcut = page.locator('.shortcut:has-text("Calculator")');
    this.terminalShortcut = page.locator('.shortcut:has-text("Terminal")');
    this.calculatorWindow = page.locator('#win-calculator');
    this.terminalWindow = page.locator('#win-terminal');
  }

  async goto() {
    await this.page.goto('/');
  }

  async openCalculator() {
    await this.calculatorShortcut.dblclick();
  }

  async openTerminal() {
    await this.terminalShortcut.dblclick();
  }

  async closeWindow(windowId) {
    const win = this.page.locator(`#win-${windowId}`);
    await win.locator('.win-close').click();
  }
}

module.exports = { DesktopPage };
