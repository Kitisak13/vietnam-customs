/**
 * Teams Manager - Handles notifications via Microsoft Teams Incoming Webhook
 */
var TeamsManager = (function () {
  /**
   * Checks if new report rows or file downloads were detected.
   * If updates exist, sends an Adaptive Card alert to MS Teams.
   * @param {Object} sheetStats - Summary from SheetManager { added, updated, total, newItems }
   * @param {Object} downloadStats - Summary from DriveManager { downloaded, skipped, failed, downloadedFiles }
   * @returns {boolean} True if notification sent, false otherwise
   */
  function checkAndNotify(sheetStats, downloadStats) {
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
        "). Sending Teams notification...",
    );

    return sendTeamsCard({
      sheetStats: sheetStats || { added: 0, updated: 0, newItems: [] },
      downloadStats: downloadStats || {
        downloaded: 0,
        skipped: 0,
        failed: 0,
        downloadedFiles: [],
      },
      sheetId: Config.getSheetId(),
      folderId: Config.getRootFolderId(),
    });
  }

  /**
   * Sends an Adaptive Card message to Microsoft Teams Incoming Webhook
   * @param {Object} info
   * @returns {boolean} True if HTTP 200/202 received
   */
  function sendTeamsCard(info) {
    var webhookUrl = Config.getTeamsWebhookUrl();
    if (!webhookUrl) {
      console.warn(
        "TEAMS_WEBHOOK_URL is not configured in Script Properties. Skipping Teams alert.",
      );
      return false;
    }

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

    var adaptiveCardPayload = {
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

    var options = {
      method: "post",
      contentType: "application/json; charset=UTF-8",
      payload: JSON.stringify(adaptiveCardPayload),
      muteHttpExceptions: true,
    };

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

      console.error(
        "Failed to send Teams notification. HTTP " +
          statusCode +
          ": " +
          response.getContentText().substring(0, 300),
      );
      return false;
    } catch (e) {
      console.error("Exception sending Teams webhook: " + e.message);
      return false;
    }
  }

  return {
    checkAndNotify: checkAndNotify,
    sendTeamsCard: sendTeamsCard,
  };
})();
