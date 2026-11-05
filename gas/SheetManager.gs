/**
 * Sheet Manager - Handles writing, deduplicating, updating, and sorting data in Google Sheets
 */
var SheetManager = (function () {
  var HEADERS = [
    "Content",
    "Month",
    "Preliminary Link",
    "Adjusted Link",
    "Official Link",
    "Last Updated",
  ];

  /**
   * Saves scraped rows to Google Sheets using single-batch reads/writes.
   * Only updates existing rows when link formulas actually change.
   * @param {Array} data - Scraped row objects
   * @returns {Object} Summary counts { added, updated, total }
   */
  function saveToSheet(data) {
    if (!Array.isArray(data) || data.length === 0) {
      return { added: 0, updated: 0, total: 0 };
    }

    var ss = SpreadsheetApp.openById(Config.SHEET_ID);
    var sheet = ss.getSheetByName(Config.SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(Config.SHEET_NAME);
    }

    // Check format/headers - If invalid or empty, initialize the sheet
    var lastRow = sheet.getLastRow();
    var headers = [];
    if (lastRow > 0) {
      headers = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    }

    if (headers.length === 0 || headers[0] !== "Content") {
      console.log("Sheet format invalid or empty. Initializing headers...");
      sheet.clear();
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      sheet.setFrozenRows(1);
      // Format Month column (B) as Plain Text to prevent Date auto-coercion
      sheet.getRange("B:B").setNumberFormat("@");
      lastRow = 1;
    }

    // Read existing values and formulas in a single batch
    var existingRows = [];
    var keyToIndex = {};

    if (lastRow > 1) {
      var dataRange = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
      var exValues = dataRange.getValues();
      var exFormulas = dataRange.getFormulas();

      for (var i = 0; i < exValues.length; i++) {
        var valRow = exValues[i];
        var formRow = exFormulas[i];

        var contentVal = String(valRow[0] || "").trim();
        var monthVal = formatDate(valRow[1]);
        if (!contentVal && !monthVal) continue;

        var rowRecord = [
          contentVal,
          monthVal,
          formRow[2] || String(valRow[2] || ""),
          formRow[3] || String(valRow[3] || ""),
          formRow[4] || String(valRow[4] || ""),
          valRow[5] || new Date(),
        ];

        var key = contentVal + "_" + monthVal;
        keyToIndex[key] = existingRows.length;
        existingRows.push(rowRecord);
      }
    }

    var addedCount = 0;
    var updatedCount = 0;
    var newItems = [];
    var now = new Date();

    data.forEach(function (row) {
      if (!row || !row.content || !row.month) return;

      var contentNorm = String(row.content).trim();
      var monthNorm = formatDate(row.month);
      var key = contentNorm + "_" + monthNorm;

      var prelimFormula = formatLink(row.prelim ? row.prelim.url : "");
      var adjFormula = formatLink(row.adj ? row.adj.url : "");
      var officialFormula = formatLink(row.official ? row.official.url : "");

      if (Object.prototype.hasOwnProperty.call(keyToIndex, key)) {
        var idx = keyToIndex[key];
        var current = existingRows[idx];

        // Only update if at least one link formula has changed (preserve existing non-empty links if upstream temporarily omits them)
        var nextPrelim = prelimFormula || current[2];
        var nextAdj = adjFormula || current[3];
        var nextOfficial = officialFormula || current[4];

        if (
          current[2] !== nextPrelim ||
          current[3] !== nextAdj ||
          current[4] !== nextOfficial
        ) {
          existingRows[idx] = [
            contentNorm,
            monthNorm,
            nextPrelim,
            nextAdj,
            nextOfficial,
            now,
          ];
          updatedCount++;
          newItems.push({
            content: contentNorm,
            month: monthNorm,
            status: "updated",
          });
        }
      } else {
        var newRow = [
          contentNorm,
          monthNorm,
          prelimFormula,
          adjFormula,
          officialFormula,
          now,
        ];
        keyToIndex[key] = existingRows.length;
        existingRows.push(newRow);
        addedCount++;
        newItems.push({
          content: contentNorm,
          month: monthNorm,
          status: "new",
        });
      }
    });

    if (addedCount > 0 || updatedCount > 0) {
      // Sort in memory by Month (YYYYMM descending), then Content (ascending)
      existingRows.sort(function (a, b) {
        var monthDiff = parseMonthStr(b[1]) - parseMonthStr(a[1]);
        if (monthDiff !== 0) return monthDiff;
        return String(a[0]).localeCompare(String(b[0]));
      });

      // Ensure Month column stays formatted as plain text before batch write
      sheet
        .getRange(2, 2, Math.max(existingRows.length, 1), 1)
        .setNumberFormat("@");

      // Single batch write for all rows
      sheet
        .getRange(2, 1, existingRows.length, HEADERS.length)
        .setValues(existingRows);

      console.log(
        "Sheet updated in batch: " +
          addedCount +
          " added, " +
          updatedCount +
          " updated (total " +
          existingRows.length +
          " rows).",
      );
    } else {
      console.log("No new or modified rows found. Sheet is up to date.");
    }

    return {
      added: addedCount,
      updated: updatedCount,
      total: existingRows.length,
      newItems: newItems,
    };
  }

  /**
   * Normalizes a Date object or month string into "MM-YYYY" format
   */
  function formatDate(val) {
    if (!val) return "";
    if (
      Object.prototype.toString.call(val) === "[object Date]" &&
      !isNaN(val)
    ) {
      var mm = ("0" + (val.getMonth() + 1)).slice(-2);
      var yyyy = val.getFullYear();
      return mm + "-" + yyyy;
    }
    var str = String(val).trim();
    var parts = str.match(/(\d{1,2})[-/](\d{4})/);
    if (parts) {
      var monthPadded = ("0" + parseInt(parts[1], 10)).slice(-2);
      return monthPadded + "-" + parts[2];
    }
    return str;
  }

  /**
   * Parses a month value (Date or "MM-YYYY"/"MM/YYYY" string) into YYYYMM integer (e.g. 202512)
   */
  function parseMonthStr(val) {
    var normalized = formatDate(val);
    if (!normalized) return 0;
    var parts = normalized.match(/(\d{1,2})[-/](\d{4})/);
    if (parts) {
      return parseInt(parts[2], 10) * 100 + parseInt(parts[1], 10);
    }
    return 0;
  }

  /**
   * Returns the maximum YYYYMM integer currently in the sheet, or null if empty
   */
  function getLatestMonthInSheet() {
    var ss = SpreadsheetApp.openById(Config.SHEET_ID);
    var sheet = ss.getSheetByName(Config.SHEET_NAME);
    if (!sheet) return null;

    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return null;

    var monthValues = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    var maxDate = 0;

    for (var i = 0; i < monthValues.length; i++) {
      var currentVal = parseMonthStr(monthValues[i][0]);
      if (currentVal > maxDate) {
        maxDate = currentVal;
      }
    }
    return maxDate > 0 ? maxDate : null;
  }

  function formatLink(url) {
    if (!url) return "";
    var safeUrl = String(url).replace(/"/g, "%22");
    return '=HYPERLINK("' + safeUrl + '", "Download")';
  }

  return {
    saveToSheet: saveToSheet,
    getLatestMonthInSheet: getLatestMonthInSheet,
    formatDate: formatDate,
    parseMonthStr: parseMonthStr,
  };
})();
