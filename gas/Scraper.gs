/**
 * Scraper Service - Handles fetching and parsing data from Vietnam Customs
 */
var Scraper = (function () {
  var INTERNAL_IP_REGEX =
    /^https?:\/\/(?:10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.|localhost)/i;

  /**
   * Fetches data pages from the API until no more data or limit reached.
   * @param {number} maxPages - Safety limit to prevent infinite loops
   * @returns {Array} List of extracted row objects
   */
  function fetchAllData(maxPages) {
    var limit =
      typeof maxPages === "number" && maxPages > 0
        ? maxPages
        : Config.DEFAULT_MAX_PAGES || 5;
    var allData = [];
    var skip = 0;
    var take = Config.PAGE_SIZE || 20;
    var hasMore = true;
    var pageCount = 0;

    while (hasMore && pageCount < limit) {
      console.log("Fetching page: " + (pageCount + 1) + ", skip: " + skip);
      try {
        var rawData = fetchPage(skip, take);
        var rows = parseApiItems(rawData);

        if (rows.length === 0) {
          hasMore = false;
        } else {
          allData = allData.concat(rows);
          skip += take;
          pageCount++;

          if (hasMore && pageCount < limit) {
            // Safety sleep between requests to be polite to the upstream server
            Utilities.sleep(1000);
          }
        }
      } catch (e) {
        console.error(
          "Error fetching page " + (pageCount + 1) + ": " + e.toString(),
        );
        hasMore = false;
      }
    }

    return allData;
  }

  /**
   * Sends POST request to the bridge API with retry and HTTP status validation
   */
  function fetchPage(skip, take) {
    // Payload MUST be a JSON string, sent with application/json
    var payload = {
      skip: skip,
      take: take,
      ky: "",
      textSearch: "",
      the_loai: "0",
      thoigianCongBo: "",
      typeName: "GetListSoLieu",
      language: Config.LANGUAGE,
      // "captcha" field is REMOVED intentionally. Sending it (even empty) causes errors.
    };

    var langSettings = Config.LANG_CONFIG[Config.LANGUAGE];
    if (!langSettings) {
      throw new Error("Invalid Language configuration: " + Config.LANGUAGE);
    }

    var options = {
      method: "post",
      contentType: "application/json; charset=UTF-8",
      payload: JSON.stringify(payload), // Send JSON string as payload
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Origin: Config.BASE_URL,
        Referer: langSettings.REFERER,
        Cookie: langSettings.COOKIE,
      },
      muteHttpExceptions: true,
    };

    var fetchUrl = Config.USE_SCRAPER_API
      ? Config.buildScraperUrl(Config.API_ENDPOINT, true)
      : Config.API_ENDPOINT;

    var response;
    var maxRetries = Config.MAX_RETRIES || 3;
    var attempt = 0;

    while (attempt < maxRetries) {
      try {
        response = UrlFetchApp.fetch(fetchUrl, options);
        var statusCode = response.getResponseCode();

        if (statusCode >= 200 && statusCode < 300) {
          break;
        }

        throw new Error(
          "HTTP " +
            statusCode +
            " response: " +
            response.getContentText().substring(0, 200),
        );
      } catch (e) {
        attempt++;
        console.warn("Attempt " + attempt + " failed: " + e.message);
        if (attempt < maxRetries) {
          var backoffMs = attempt * 2000;
          console.log("Retrying in " + backoffMs / 1000 + " seconds...");
          Utilities.sleep(backoffMs);
        } else {
          console.error("All " + maxRetries + " attempts failed.");
          throw e;
        }
      }
    }

    var content = response.getContentText();

    // The server returns a JSON object with 'arr' containing the list
    try {
      var json = JSON.parse(content);
      if (json && Array.isArray(json.arr)) {
        return json.arr;
      } else {
        console.warn(
          'API returned JSON without a valid "arr" array. Response start: ' +
            content.substring(0, 200),
        );
        return [];
      }
    } catch (e) {
      console.error(
        "Error parsing JSON response: " +
          e.message +
          "\nFull Content Start: " +
          content.substring(0, 500),
      );
      return [];
    }
  }

  /**
   * Parses the JSON array into structured objects
   */
  function parseApiItems(dataArray) {
    if (!Array.isArray(dataArray)) return [];

    return dataArray
      .map(function (item) {
        if (!item) return null;
        var content = item.TIEU_DE ? String(item.TIEU_DE).trim() : "";
        var month = item.NGAY_CONG_BO ? String(item.NGAY_CONG_BO).trim() : "";
        return {
          content: content,
          month: month, // e.g., "12-2025"
          prelim: parseApiLink(item.FILE_SO_BO),
          adj: parseApiLink(item.FILE_DIEU_CHINH),
          official: parseApiLink(item.FILE_CHINH_THUC),
        };
      })
      .filter(function (r) {
        return r && r.content && r.month;
      });
  }

  function parseApiLink(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return null;

    var urlStr = rawUrl.trim();
    if (urlStr === "" || urlStr.toLowerCase() === "null") {
      return null;
    }

    // Block internal/private network IPs (e.g. 10.224.128.185) which are unreachable publicly
    if (
      urlStr.indexOf("10.224.128.185") !== -1 ||
      INTERNAL_IP_REGEX.test(urlStr)
    ) {
      console.log("Skipping internal link: " + urlStr);
      return null;
    }

    // Handle relative paths
    if (!/^https?:\/\//i.test(urlStr)) {
      urlStr = Config.BASE_URL + (urlStr.charAt(0) === "/" ? "" : "/") + urlStr;
    }

    // Encode spaces if any exist in the raw URL
    urlStr = urlStr.replace(/ /g, "%20");

    return {
      url: urlStr,
      text: "",
    };
  }

  return {
    fetchAllData: fetchAllData,
  };
})();
