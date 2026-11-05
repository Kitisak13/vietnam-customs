/**
 * Teams Manager - Handles notifications via Microsoft Teams Incoming Webhook
 * with retry logic and pending notification queue to prevent lost alerts.
 */
var TeamsManager = (function () {
  /**
   * Checks if new report rows or file downloads were detected.
   * Also flushes any pending failed notifications from previous runs.
   * @param {Object} sheetStats - Summary from SheetManager { added, updated, total, newItems }
   * @param {Object} downloadStats - Summary from DriveManager { downloaded, skipped, failed, downloadedFiles }
   * @returns {boolean} True if current or pending notification sent, false otherwise
   */
  function checkAndNotify(sheetStats, downloadStats) {
    // If Teams webhook URL is not configured, exit early without queueing pending notifications
    if (!Config.getTeamsWebhookUrl()) {
      console.log(
        "TEAMS_WEBHOOK_URL is not configured. Skipping Teams notification.",
      );
      return false;
    }

    var props = PropertiesService.getScriptProperties();

    // 1. Flush any pending notifications that previously failed to deliver
    flushPendingNotification(props);

    var added = (sheetStats && sheetStats.added) || 0;
    var updated = (sheetStats && sheetStats.updated) || 0;
    var downloaded = (downloadStats && downloadStats.downloaded) || 0;

    var hasNewUpdates = added > 0 || updated > 0 || downloaded > 0;

    if (!hasNewUpdates) {
      console.log(
        "No new reports or file updates found. Skipping Teams notification.",
      );
      return false;
    }

    console.log(
      "New updates detected (Added: " +
        added +
        ", Updated: " +
        updated +
        ", Downloaded: " +
        downloaded +
        "). Preparing Teams notification...",
    );

    var cardPayload = buildCardPayload({
      sheetStats: sheetStats || { added: 0, updated: 0, newItems: [] },
      downloadStats:
        downloadStats || {
          downloaded: 0,
          skipped: 0,
          failed: 0,
          downloadedFiles: [],
        },
      sheetId: Config.getSheetId(),
      folderId: Config.getRootFolderId(),
    });

    var sent = sendWithRetry(cardPayload);

    if (!sent) {
      console.warn(
        "Failed to deliver Teams notification after all retries. Saving to PENDING_TEAMS_NOTIFICATION for next run.",
      );
      props.setProperty(
        Config.KEY_PENDING_TEAMS_NOTIFICATION,
        JSON.stringify(cardPayload),
      );
    }

    return sent;
  }

  /**
   * Attempts to resend any queued notification from previous runs
   */
  function flushPendingNotification(props) {
    try {
      var pending = props.getProperty(Config.KEY_PENDING_TEAMS_NOTIFICATION);
      if (pending) {
        console.log("Found pending Teams notification from previous run. Resending...");
        var payload = JSON.parse(pending);
        var sent = sendWithRetry(payload);
        if (sent) {
          props.deleteProperty(Config.KEY_PENDING_TEAMS_NOTIFICATION);
          console.log("Pending Teams notification delivered and cleared.");
        }
      }
    } catch (e) {
      console.warn(
        "Error flushing pending notification: " + Config.sanitizeLog(e.message),
      );
    }
  }

  /**
   * Builds the Adaptive Card JSON structure
   */
  function buildCardPayload(info) {
    var nowStr = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone() || "GMT+7",
      "yyyy-MM-dd HH:mm:ss",
    );

    var sheetUrl = "https://docs.google.com/spreadsheets/d/" + info.sheetId;
    var driveUrl = "https://drive.google.com/drive/folders/" + info.folderId;

    var downloadedCount = info.downloadStats.downloaded || 0;
    var addedCount = info.sheetStats.added || 0;
    var updatedCount = info.sheetStats.updated || 0;

    // Collect titles of newly published/updated reports
    var itemSummaries = [];
    if (
      info.downloadStats.downloadedFiles &&
      info.downloadStats.downloadedFiles.length > 0
    ) {
      itemSummaries = info.downloadStats.downloadedFiles.slice(0, 5);
    } else if (
      info.sheetStats.newItems &&
      info.sheetStats.newItems.length > 0
    ) {
      itemSummaries = info.sheetStats.newItems.slice(0, 5).map(function (it) {
        return "[" + it.month + "] " + it.content;
      });
    }

    var itemsText =
      itemSummaries.length > 0
        ? "\n\n**Published Reports:**\n" +
          itemSummaries
            .map(function (t) {
              return "• " + t;
            })
            .join("\n")
        : "";

    return {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              {
                type: "TextBlock",
                text: "📢 Vietnam Customs Statistical Report Updated",
                weight: "Bolder",
                size: "Large",
                color: "Accent",
              },
              {
                type: "TextBlock",
                text:
                  "New statistical reports have been published and archived into Google Drive & Google Sheet." +
                  itemsText,
                wrap: true,
              },
              {
                type: "FactSet",
                facts: [
                  {
                    title: "New Records Added:",
                    value: addedCount + " item(s)",
                  },
                  {
                    title: "Records Updated:",
                    value: updatedCount + " item(s)",
                  },
                  {
                    title: "New PDFs Downloaded:",
                    value: downloadedCount + " file(s)",
                  },
                  { title: "Updated Time:", value: nowStr },
                ],
              },
            ],
            actions: [
              {
                type: "Action.OpenUrl",
                title: "📊 View Google Sheet",
                url: sheetUrl,
              },
              {
                type: "Action.OpenUrl",
                title: "📁 Open Drive Folder",
                url: driveUrl,
              },
            ],
          },
        },
      ],
    };
  }

  /**
   * Sends payload to Teams Webhook with exponential backoff retries
   */
  function sendWithRetry(payload, maxRetries) {
    var webhookUrl = Config.getTeamsWebhookUrl();
    if (!webhookUrl) {
      console.warn(
        "TEAMS_WEBHOOK_URL is not configured in Script Properties. Skipping Teams alert.",
      );
      return false;
    }

    var retries = maxRetries || 3;
    var options = {
      method: "post",
      contentType: "application/json; charset=UTF-8",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    for (var attempt = 1; attempt <= retries; attempt++) {
      try {
        var response = UrlFetchApp.fetch(webhookUrl, options);
        var statusCode = response.getResponseCode();

        if (statusCode === 200 || statusCode === 202) {
          console.log(
            "Teams notification delivered successfully (HTTP " +
              statusCode +
              ").",
          );
          return true;
        }

        console.warn(
          "Attempt " +
            attempt +
            " to send Teams webhook returned HTTP " +
            statusCode +
            ": " +
            response.getContentText().substring(0, 200),
        );
      } catch (e) {
        console.warn(
          "Attempt " +
            attempt +
            " failed with exception: " +
            Config.sanitizeLog(e.message),
        );
      }

      if (attempt < retries) {
        var backoffMs = attempt * 2000;
        Utilities.sleep(backoffMs);
      }
    }

    console.error("All " + retries + " attempts to send Teams webhook failed.");
    return false;
  }

  return {
    checkAndNotify: checkAndNotify,
    sendTeamsCard: function (info) {
      return sendWithRetry(buildCardPayload(info));
    },
  };
})();
