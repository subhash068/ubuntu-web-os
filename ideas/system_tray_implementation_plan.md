# Add System Tray / Control Center

This plan details how we will remove the individual IP address button and add a unified system tray that opens a Control Center popup containing quick settings like Wi-Fi, Bluetooth, Aeroplane mode, Do Not Disturb, and sliders for Brightness and Volume.

## Open Questions
- **Action bindings**: Do you want these toggles (like Bluetooth, Aeroplane mode) to actually invoke backend Python scripts right now, or should they be purely visual UI toggles for now?
- **Tray Icons**: Should the new tray icon display multiple status icons (e.g., Wi-Fi + Volume + Battery side-by-side like Windows 11) or just a single "Settings/Sliders" icon? 

## Proposed Changes

### `index.html`
- **[MODIFY] taskbar-right**: 
  - Remove the `<div id="ip-badge">...</div>`.
  - Replace `<div class="tray-icon-wifi">...</div>` with a unified `<div id="system-tray" class="tray-pill">...</div>` containing small Wi-Fi, Sound, and Battery icons.
  - Add an `onclick` handler to `#system-tray` to toggle the visibility of the new Control Center popup.
- **[NEW] Control Center Popup**: 
  - Add a new `div` for the Control Center popup, positioned absolutely right above the taskbar.
  - It will contain a grid of Quick Action buttons:
    - Wi-Fi (clicking the arrow opens the full Wi-Fi Manager window)
    - Bluetooth
    - Aeroplane Mode
    - Do Not Disturb
  - Sliders section:
    - Display Brightness (Color bar)
    - Volume (Sound bar)

### `main.js` (or inline script)
- **[NEW] Control Center Logic**:
  - Add logic to toggle the Control Center popup when the tray is clicked.
  - Add logic to close the Control Center if the user clicks outside of it.
  - Add state management for the toggles so they highlight when active.

### `style.css` (or inline styles)
- **[NEW] Styling**:
  - Add premium, blurred-glassmorphism CSS for the Control Center popup.
  - Add styles for the circular toggle buttons (active/inactive states).
  - Add styling for the sliders to match the OS aesthetic.

## Verification Plan
- Click the new system tray to verify the popup opens/closes.
- Verify that clicking outside the popup closes it.
- Verify toggle buttons visually change state.
- Verify sliders are draggable and visually appealing.
