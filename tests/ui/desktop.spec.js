const { test, expect } = require('@playwright/test');
const { DesktopPage } = require('../pages/DesktopPage');

test.describe('Desktop Environment UI Tests', () => {
  let desktop;

  test.beforeEach(async ({ page }) => {
    desktop = new DesktopPage(page);
    await desktop.goto();
  });

  test('should load the desktop and shortcuts', async ({ page }) => {
    // Verify desktop container is visible
    await expect(desktop.desktopBody).toBeVisible();
    
    // Verify shortcuts are present
    await expect(desktop.calculatorShortcut).toBeVisible();
    await expect(desktop.terminalShortcut).toBeVisible();
  });

  test('should open Calculator window on double click', async ({ page }) => {
    await desktop.openCalculator();
    
    // Verify the window becomes visible
    await expect(desktop.calculatorWindow).toBeVisible();
    
    // Close the window
    await desktop.closeWindow('calculator');
    await expect(desktop.calculatorWindow).toBeHidden();
  });

  test('should open Terminal window on double click', async ({ page }) => {
    await desktop.openTerminal();
    
    // Verify the window becomes visible
    await expect(desktop.terminalWindow).toBeVisible();
    
    // Close the window
    await desktop.closeWindow('terminal');
    await expect(desktop.terminalWindow).toBeHidden();
  });
});
