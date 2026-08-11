# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui\desktop.spec.js >> Desktop Environment UI Tests >> should open Terminal window on double click
- Location: tests\ui\desktop.spec.js:32:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5000/
Call log:
  - navigating to "http://localhost:5000/", waiting until "load"

```

# Test source

```ts
  1  | class DesktopPage {
  2  |   /**
  3  |    * @param {import('@playwright/test').Page} page
  4  |    */
  5  |   constructor(page) {
  6  |     this.page = page;
  7  |     this.desktopBody = page.locator('#desktop-body');
  8  |     this.startMenuBtn = page.locator('.start-menu-btn'); // Assuming there's a start menu button, though we can just interact with shortcuts
  9  |     this.startMenu = page.locator('#start-menu');
  10 |     this.calculatorShortcut = page.locator('.shortcut:has-text("Calculator")');
  11 |     this.terminalShortcut = page.locator('.shortcut:has-text("Terminal")');
  12 |     this.calculatorWindow = page.locator('#win-calculator');
  13 |     this.terminalWindow = page.locator('#win-terminal');
  14 |   }
  15 | 
  16 |   async goto() {
> 17 |     await this.page.goto('/');
     |                     ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5000/
  18 |   }
  19 | 
  20 |   async openCalculator() {
  21 |     await this.calculatorShortcut.dblclick();
  22 |   }
  23 | 
  24 |   async openTerminal() {
  25 |     await this.terminalShortcut.dblclick();
  26 |   }
  27 | 
  28 |   async closeWindow(windowId) {
  29 |     const win = this.page.locator(`#win-${windowId}`);
  30 |     await win.locator('.win-close').click();
  31 |   }
  32 | }
  33 | 
  34 | module.exports = { DesktopPage };
  35 | 
```