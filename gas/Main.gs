/**
 * Main Entry Point
 */
function main() {
  var startTimeMs = Date.now();
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    console.warn(
      "Another instance of Vietnam Customs Scraper is already running. Exiting.",
    );
    return;
  }

  try {
    console.log("Starting Vietnam Customs Scraper...");

    // 1. Fetch Data
    var allRows = Scraper.fetchAllData(Config.DEFAULT_MAX_PAGES);
    console.log("Fetched " + allRows.length + " rows.");

    if (allRows.length === 0) {
      console.log("No data found. Exiting.");
      return;
    }

    // 2. Save to Sheets (Single-batch read/write)
    try {
      SheetManager.saveToSheet(allRows);
    } catch (sheetErr) {
      console.error("SheetManager failed: " + sheetErr.toString());
    }

    // 3. Process Downloads (Files with folder/file caching & timeout guardrail)
    try {
      DriveManager.processDownloads(allRows, startTimeMs);
    } catch (driveErr) {
      console.error("DriveManager failed: " + driveErr.toString());
    }

    // 4. Check for New Month & Notify LINE
    try {
      LineManager.checkAndNotify(allRows);
    } catch (lineErr) {
      console.error("LineManager failed: " + lineErr.toString());
    }

    var elapsedSec = ((Date.now() - startTimeMs) / 1000).toFixed(2);
    console.log("Execution completed in " + elapsedSec + "s.");
  } finally {
    lock.releaseLock();
  }
}

/**
 * Setup function to run once if needed to initialize Script Properties
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var latestMonth = SheetManager.getLatestMonthInSheet();
  if (latestMonth && !props.getProperty(Config.KEY_LAST_NOTIFIED_MONTH)) {
    props.setProperty(Config.KEY_LAST_NOTIFIED_MONTH, String(latestMonth));
    console.log("Initialized LAST_NOTIFIED_MONTH to " + latestMonth);
  } else {
    console.log(
      "Current LAST_NOTIFIED_MONTH: " +
        (props.getProperty(Config.KEY_LAST_NOTIFIED_MONTH) || "not set"),
    );
  }
}
