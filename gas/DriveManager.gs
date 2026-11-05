/**
 * Drive Manager - Handles File Downloading and Folder Management with Folder/File Caching
 */
var DriveManager = (function () {
  /**
   * Main function to handle the download logic for report rows.
   * Priority Logic: Official > Adjusted > Preliminary
   * @param {Array} rows - Scraped report rows
   * @param {number} [startTimeMs] - Execution start timestamp for timeout protection
   * @returns {Object} Summary { downloaded, skipped, failed }
   */
  function processDownloads(rows, startTimeMs) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { downloaded: 0, skipped: 0, failed: 0 };
    }

    var startMs = startTimeMs || Date.now();
    var maxExecMs = Config.MAX_EXECUTION_TIME_MS || 270000;
    var rootFolder = DriveApp.getFolderById(Config.ROOT_FOLDER_ID);

    // Per-run caches to eliminate redundant Drive RPC calls
    var yearFolderCache = {};
    var existingFilesCache = {};

    var downloadedCount = 0;
    var skippedCount = 0;
    var failedCount = 0;

    for (var i = 0; i < rows.length; i++) {
      // Guard against Google Apps Script 6-minute execution limit
      if (Date.now() - startMs > maxExecMs) {
        console.warn(
          "Approaching GAS execution time limit. Pausing remaining downloads until next run.",
        );
        break;
      }

      var row = rows[i];
      if (!row || !row.content || !row.month) continue;

      var normalizedMonth = SheetManager.formatDate(row.month);
      var year = "Unknown";
      var monthParts = normalizedMonth.match(/(\d{1,2})[-/](\d{4})/);
      if (monthParts) {
        year = monthParts[2];
      }

      // Determine highest-priority file to download
      var target = null;
      var statusPrefix = "";

      if (row.official && row.official.url) {
        target = row.official;
        statusPrefix = "[Official]";
      } else if (row.adj && row.adj.url) {
        target = row.adj;
        statusPrefix = "[Adjusted]";
      } else if (row.prelim && row.prelim.url) {
        target = row.prelim;
        statusPrefix = "[Preliminary]";
      }

      if (!target) continue;

      var ext = extractExtension(target.url);
      var fileName =
        "[" + normalizedMonth + "]" + statusPrefix + " " + row.content + ext;
      // Sanitize filename of illegal path characters and normalize whitespace
      fileName = fileName
        .replace(/[\\/:*?"<>|\r\n]+/g, "")
        .replace(/\s+/g, " ")
        .trim();

      var yearFolder = getOrCreateYearFolder(
        rootFolder,
        year,
        yearFolderCache,
        existingFilesCache,
      );
      var existingFiles = existingFilesCache[year];

      if (!existingFiles[fileName]) {
        console.log("Downloading: " + fileName);
        try {
          var response = UrlFetchApp.fetch(target.url, {
            muteHttpExceptions: true,
            followRedirects: true,
          });
          var statusCode = response.getResponseCode();

          if (statusCode >= 200 && statusCode < 300) {
            var blob = response.getBlob();
            blob.setName(fileName);
            yearFolder.createFile(blob);
            existingFiles[fileName] = true;
            downloadedCount++;
          } else {
            console.error(
              "Failed to download " +
                fileName +
                " (HTTP " +
                statusCode +
                "): " +
                target.url,
            );
            failedCount++;
          }
        } catch (e) {
          console.error("Failed to download " + fileName + ": " + e.message);
          failedCount++;
        }
      } else {
        skippedCount++;
      }
    }

    console.log(
      "Drive downloads summary: " +
        downloadedCount +
        " downloaded, " +
        skippedCount +
        " skipped (already existed), " +
        failedCount +
        " failed.",
    );

    return {
      downloaded: downloadedCount,
      skipped: skippedCount,
      failed: failedCount,
    };
  }

  /**
   * Retrieves or creates a year subfolder and pre-indexes its existing file names once per run
   */
  function getOrCreateYearFolder(
    rootFolder,
    year,
    yearFolderCache,
    existingFilesCache,
  ) {
    if (yearFolderCache[year]) {
      return yearFolderCache[year];
    }

    var folders = rootFolder.getFoldersByName(year);
    var folder = folders.hasNext()
      ? folders.next()
      : rootFolder.createFolder(year);

    var fileMap = {};
    var files = folder.getFiles();
    while (files.hasNext()) {
      fileMap[files.next().getName()] = true;
    }

    yearFolderCache[year] = folder;
    existingFilesCache[year] = fileMap;
    return folder;
  }

  /**
   * Extracts file extension from URL, defaulting to ".pdf"
   */
  function extractExtension(url) {
    if (!url || typeof url !== "string") return ".pdf";
    var cleanUrl = url.split(/[?#]/)[0];
    var match = cleanUrl.match(/\.(pdf|xlsx|xls|docx|doc|csv|zip)$/i);
    return match ? "." + match[1].toLowerCase() : ".pdf";
  }

  return {
    processDownloads: processDownloads,
  };
})();
