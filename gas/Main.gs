/**
 * Main Entry Point
 * @param {Object} [e] - Event object passed by time-driven trigger
 */
function main(e) {
  // Weekend Guard: Skip execution on Saturday (6) and Sunday (0) ONLY when invoked by time-driven trigger.
  // Allows manual runs from the Apps Script Editor anytime, including weekends.
  var now = new Date();
  var dayOfWeek = now.getDay();
  var isTriggerInvocation = Boolean(e && e.triggerUid);

  if (isTriggerInvocation && (dayOfWeek === 0 || dayOfWeek === 6)) {
    console.log(
      "Weekend detected (Day " +
        dayOfWeek +
        ") for scheduled trigger. Execution bypassed.",
    );
    return;
  }

  var startTimeMs = Date.now();
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    console.warn(
      "Another instance of Vietnam Customs Scraper is already running. Exiting.",
    );
    return;
  }

  try {
    console.log("Checking Vietnam Customs for latest updates...");

    // Validate that all required Script Properties are present
    Config.validateRequiredProperties();

    // 1. Fetch Latest Data (Default: Page 1 = 20 latest items)
    var allRows = Scraper.fetchAllData(Config.DEFAULT_MAX_PAGES);
    console.log("Fetched " + allRows.length + " latest items from web.");

    if (allRows.length === 0) {
      console.log("No data returned from upstream API. Exiting.");
      return;
    }

    // 2. Save to Sheets (Checks if row or link formula is new/modified)
    var sheetStats = { added: 0, updated: 0, newItems: [] };
    try {
      sheetStats = SheetManager.saveToSheet(allRows);
    } catch (sheetErr) {
      console.error("SheetManager failed: " + sheetErr.toString());
    }

    // 3. Process Downloads (Downloads only if file is not already in Drive folder)
    var downloadStats = {
      downloaded: 0,
      skipped: 0,
      failed: 0,
      downloadedFiles: [],
    };
    try {
      downloadStats = DriveManager.processDownloads(allRows, startTimeMs);
    } catch (driveErr) {
      console.error("DriveManager failed: " + driveErr.toString());
    }

    // 4. Notify Microsoft Teams Channel IF and ONLY IF new reports or downloads occurred
    try {
      TeamsManager.checkAndNotify(sheetStats, downloadStats);
    } catch (teamsErr) {
      console.error("TeamsManager failed: " + teamsErr.toString());
    }

    var elapsedSec = ((Date.now() - startTimeMs) / 1000).toFixed(2);
    console.log("Execution completed in " + elapsedSec + "s.");
  } finally {
    lock.releaseLock();
  }
}

/**
 * Automatically creates time-driven triggers:
 * 11:00 AM and 3:00 PM (15:00) daily.
 * Weekend runs are automatically bypassed by the guard in main(e).
 */
function setupTriggers() {
  // Remove existing triggers for main to prevent duplicates
  var allTriggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < allTriggers.length; i++) {
    if (allTriggers[i].getHandlerFunction() === "main") {
      ScriptApp.deleteTrigger(allTriggers[i]);
    }
  }

  // Trigger 1: 11:00 AM
  ScriptApp.newTrigger("main").timeBased().atHour(11).everyDays(1).create();

  // Trigger 2: 3:00 PM (15:00)
  ScriptApp.newTrigger("main").timeBased().atHour(15).everyDays(1).create();

  console.log(
    "Successfully created triggers for main() at 11:00 and 15:00 daily.",
  );
}

/**
 * Setup function: Validates Script Properties and sets up triggers
 */
function setup() {
  console.log("Running system setup & validation...");

  // 1. Setup Triggers
  setupTriggers();

  // 2. Check Script Properties
  var props = PropertiesService.getScriptProperties();
  console.log("--- Current Script Properties Status ---");
  console.log(
    "SHEET_ID: " +
      (props.getProperty(Config.KEY_SHEET_ID) ? "Configured" : "MISSING"),
  );
  console.log(
    "ROOT_FOLDER_ID: " +
      (props.getProperty(Config.KEY_ROOT_FOLDER_ID) ? "Configured" : "MISSING"),
  );
  console.log(
    "SCRAPER_API_KEY: " +
      (props.getProperty(Config.KEY_SCRAPER_API_KEY)
        ? "Configured"
        : "MISSING"),
  );
  console.log(
    "TEAMS_WEBHOOK_URL: " +
      (props.getProperty(Config.KEY_TEAMS_WEBHOOK_URL)
        ? "Configured"
        : "OPTIONAL / NOT SET"),
  );

  console.log("Setup complete.");
}
