/**
 * Line Manager - Handles sending notifications via LINE Messaging API
 */
var LineManager = (function () {
  function checkAndNotify(scrapedData) {
    if (!Array.isArray(scrapedData) || scrapedData.length === 0) {
      return;
    }

    var scriptProps = PropertiesService.getScriptProperties();
    var lastNotifiedMonthVal = parseInt(
      scriptProps.getProperty(Config.KEY_LAST_NOTIFIED_MONTH) || "0",
      10,
    );
    if (isNaN(lastNotifiedMonthVal)) {
      lastNotifiedMonthVal = 0;
    }

    // Find maximum month in the scraped data
    var maxScrapedVal = 0;
    var maxScrapedStr = "";

    scrapedData.forEach(function (row) {
      if (!row || !row.month) return;
      var val = SheetManager.parseMonthStr(row.month);
      if (val > maxScrapedVal) {
        maxScrapedVal = val;
        maxScrapedStr = SheetManager.formatDate(row.month);
      }
    });

    // If we have a new month that is greater than what we last notified
    if (maxScrapedVal > lastNotifiedMonthVal) {
      console.log("New month detected: " + maxScrapedStr);

      var message =
        "📢 Vietnam Customs Updated\n" +
        "Period: " +
        maxScrapedStr +
        "\n" +
        "PDF download.\n" +
        "Sheet Link: https://docs.google.com/spreadsheets/d/" +
        Config.SHEET_ID;

      var sent = sendLineMessage(message);

      // Only advance LAST_NOTIFIED_MONTH if the notification was actually delivered
      if (sent) {
        scriptProps.setProperty(
          Config.KEY_LAST_NOTIFIED_MONTH,
          maxScrapedVal.toString(),
        );
      } else {
        console.warn(
          "Keeping LAST_NOTIFIED_MONTH at " +
            lastNotifiedMonthVal +
            " so notification for " +
            maxScrapedStr +
            " will be retried on next run.",
        );
      }
    } else {
      console.log(
        "No new month detected. Last notified: " +
          lastNotifiedMonthVal +
          ", Max Scraped: " +
          maxScrapedVal,
      );
    }
  }

  /**
   * Sends a push message via LINE Messaging API.
   * @param {string} textMessage
   * @returns {boolean} True if successfully delivered, false otherwise
   */
  function sendLineMessage(textMessage) {
    var scriptProps = PropertiesService.getScriptProperties();
    var accessToken = scriptProps.getProperty(Config.KEY_LINE_ACCESS_TOKEN);
    var groupId = scriptProps.getProperty(Config.KEY_LINE_GROUP_ID);

    if (!accessToken || !groupId) {
      console.warn(
        "LINE_ACCESS_TOKEN or LINE_GROUP_ID not set in Script Properties. Skipping notification.",
      );
      return false;
    }

    var url = "https://api.line.me/v2/bot/message/push";

    var payload = {
      to: groupId.trim(),
      messages: [
        {
          type: "text",
          text: textMessage,
        },
      ],
    };

    var options = {
      method: "post",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + accessToken.trim(),
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    try {
      var response = UrlFetchApp.fetch(url, options);
      var responseCode = response.getResponseCode();
      var responseBody = response.getContentText();

      if (responseCode === 200 || responseCode === 202) {
        console.log("Line Messaging API notification sent successfully.");
        return true;
      } else {
        console.error(
          "Failed to send Line message. Code: " +
            responseCode +
            ", Body: " +
            responseBody,
        );
        return false;
      }
    } catch (e) {
      console.error("Error calling Line Messaging API: " + e.toString());
      return false;
    }
  }

  return {
    checkAndNotify: checkAndNotify,
    sendLineMessage: sendLineMessage,
  };
})();
