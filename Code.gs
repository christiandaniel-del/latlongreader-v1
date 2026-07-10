/**
 * Aviation Data Integrator - Backend (Google Apps Script)
 * Menara ATC: Mengelola aliran data antara UI Leaflet dan Google Sheets Database.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('SkyControl - Aviation Data Integrator')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Helper function to include HTML/CSS/JS files in the main Index.html template.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Saves aviation data payload to Google Spreadsheet.
 * @param {string} jsonString - The stringified storedData object.
 */
function saveAviationData(jsonString) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = JSON.parse(jsonString);
  const timestamp = new Date();
  
  // 1. Save to Master Routes
  if (data.navtech && data.navtech.coords && data.navtech.coords.length > 0) {
    const routeSheet = getOrCreateSheet(ss, 'DB_Routes');
    const origin = data.navtech.coords[0].name;
    const destination = data.navtech.coords[data.navtech.coords.length - 1].name;
    routeSheet.appendRow([timestamp, origin + '-' + destination, jsonString]);
  }
  
  // 2. Save NOTAMs if present (for historical tracking)
  if (data.notam && data.notam.length > 0) {
    const notamSheet = getOrCreateSheet(ss, 'DB_NOTAM');
    data.notam.forEach(n => {
      notamSheet.appendRow([timestamp, n.id, n.type, JSON.stringify(n.coords || n.center), n.eline]);
    });
  }
  
  // 3. Save VONA/TC if present
  if (data.vona || data.tc) {
    const weatherSheet = getOrCreateSheet(ss, 'DB_VONA_TC');
    if (data.vona) {
      weatherSheet.appendRow([timestamp, 'VONA', data.vona.volcano, data.vona.dtg, JSON.stringify(data.vona.coords)]);
    }
    if (data.tc) {
      weatherSheet.appendRow([timestamp, 'TC', data.tc.name, data.tc.points[0].dtg, JSON.stringify(data.tc.points)]);
    }
  }

  return true;
}

/**
 * Helper to get a sheet by name or create it with headers if it doesn't exist.
 */
function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    // Add default headers based on sheet name
    if (name === 'DB_Routes') sheet.appendRow(['Timestamp', 'Route', 'Payload_JSON']);
    if (name === 'DB_NOTAM') sheet.appendRow(['Timestamp', 'NOTAM_ID', 'Type', 'Geometry_JSON', 'Content']);
    if (name === 'DB_VONA_TC') sheet.appendRow(['Timestamp', 'Type', 'Name', 'DTG', 'Payload_JSON']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
