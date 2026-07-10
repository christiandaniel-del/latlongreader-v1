# Aviation Data Integrator Pro

A powerful tool for visualizing aviation data including Navtech routes, VONA (Volcano Observatory Notice for Aviation), NOTAMs, and Tropical Cyclone warnings.

## GitHub Pages Deployment

This application is now ready to be hosted on GitHub Pages as a static web app.

### How to host:
1.  Push this entire directory to a GitHub repository.
2.  Go to **Settings** > **Pages** in your repository.
3.  Select the branch (usually `main`) and the folder (usually `/ (root)`).
4.  Click **Save**.
5.  Your app will be live at `https://<your-username>.github.io/<your-repo-name>/`.

### Key Changes for Migration:
-   **Static Rendering**: Removed Google Apps Script (GAS) server-side templates (`include`).
-   **Consolidated Logic**: All application logic is now in `script.js`.
-   **Serverless**: The app no longer depends on a GAS backend. The "Save to Spreadsheet" feature from the original GAS version is disabled as it requires a server-side environment.

## Usage
-   **Navtech**: Paste waypoints with coordinates.
-   **VONA**: Paste VONA advisory text.
-   **NOTAM**: Paste NOTAM text.
-   **TC**: Paste Tropical Cyclone warning text.
-   **Ruler**: Use the ruler tool to measure distances and headings on the map.
