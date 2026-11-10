/**
 * Drive Manager - Handles File Downloading and Folder Management with Folder/File Caching & Retry
 */
var DriveManager = (function () {
  /**
   * Main function to handle the download logic for report rows.
   * Priority Logic: Official > Adjusted > Preliminary
   * @param {Array} rows - Scraped report rows
   * @param {number} [startTimeMs] - Execution start timestamp for timeout protection
   * @returns {Object} Summary { downloaded, skipped, failed, downloadedFiles }
   */
  function processDownloads(rows, startTimeMs) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { downloaded: 0, skipped: 0, failed: 0, downloadedFiles: [] };
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
    var downloadedFiles = [];

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
        var blob = fetchFileWithRetry(target.url, fileName);

        if (blob) {
          blob.setName(fileName);
          yearFolder.createFile(blob);
          existingFiles[fileName] = true;
          downloadedCount++;
          downloadedFiles.push(fileName);
        } else {
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
      downloadedFiles: downloadedFiles,
    };
  }

  /**
   * Downloads a file with retry logic and direct-connection fallback
   * to handle ScraperAPI HTTP 500 timeouts on large PDF files.
   */
  function fetchFileWithRetry(rawUrl, fileName) {
    var maxAttempts = 3;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      // Attempt 1 & 2: Use ScraperAPI (if enabled). Attempt 3: Fallback to direct URL fetch.
      var useProxy = Config.USE_SCRAPER_API && attempt < maxAttempts;
      var downloadUrl = useProxy
        ? Config.buildScraperUrl(rawUrl, false)
        : rawUrl;

      try {
        var response = UrlFetchApp.fetch(downloadUrl, {
          muteHttpExceptions: true,
          followRedirects: true,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        var statusCode = response.getResponseCode();

        if (statusCode >= 200 && statusCode < 300) {
          var headers = response.getHeaders() || {};
          var contentType = (
            headers["Content-Type"] ||
            headers["content-type"] ||
            ""
          ).toLowerCase();

          // Reject HTML error/maintenance pages from upstream or proxy
          if (contentType.indexOf("text/html") !== -1) {
            console.warn(
              "Attempt " +
                attempt +
                " rejected for " +
                fileName +
                ": returned HTML instead of binary file (" +
                contentType +
                ").",
            );
          } else {
            var blob = response.getBlob();
            if (blob.getBytes().length >= 100) {
              return blob;
            }
            console.warn(
              "Attempt " +
                attempt +
                " rejected for " +
                fileName +
                ": file content too small (< 100 bytes).",
            );
          }
        } else {
          console.warn(
            "Attempt " +
              attempt +
              "/" +
              maxAttempts +
              " failed for " +
              fileName +
              " (HTTP " +
              statusCode +
              " via " +
              (useProxy ? "ScraperAPI" : "Direct") +
              "): " +
              Config.sanitizeLog(rawUrl),
          );
        }
      } catch (e) {
        console.warn(
          "Attempt " +
            attempt +
            "/" +
            maxAttempts +
            " exception for " +
            fileName +
            ": " +
            Config.sanitizeLog(e.message),
        );
      }

      if (attempt < maxAttempts) {
        Utilities.sleep(attempt * 2000);
      }
    }

    console.error(
      "Failed to download " +
        fileName +
        " after " +
        maxAttempts +
        " attempts: " +
        Config.sanitizeLog(rawUrl),
    );
    return null;
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
