var Config = {
  // Target Sheet Tab Name
  SHEET_NAME: "Data",

  // Target Website Config
  BASE_URL: "https://www.customs.gov.vn",
  API_ENDPOINT:
    "https://www.customs.gov.vn/bridge?url=/customs/api/GetTKHQInfo",

  // ScraperAPI Configuration (Bypasses Vietnam Geo-blocking)
  USE_SCRAPER_API: true,
  SCRAPER_API_BASE_URL: "https://api.scraperapi.com/",
  SCRAPER_API_COUNTRY_CODE: "vn",

  // Scraper & Execution Guardrails
  // Default to 1 page (20 latest items) since historical data is already archived.
  // 20 items comfortably covers 3-4 weeks of reports (first half, second half, full month, FDI).
  DEFAULT_MAX_PAGES: 1,
  PAGE_SIZE: 20,
  MAX_RETRIES: 3,
  MAX_EXECUTION_TIME_MS: 270000, // 4.5 minutes safety limit (GAS hard limit is 6 mins)

  // Language Configuration
  LANGUAGE: "TIENG_ANH", // 'TIENG_VIET' or 'TIENG_ANH'

  LANG_CONFIG: {
    TIENG_VIET: {
      REFERER:
        "https://www.customs.gov.vn/index.jsp?pageId=5002&group=undefined&category=Scheduled%20data%20(2009%20-%20Year%20to%20date)",
      COOKIE: "ngon_ngu_session=TIENG_VIET",
    },
    TIENG_ANH: {
      REFERER:
        "https://www.customs.gov.vn/index.jsp?pageId=4971&ngon_ngu=en-US",
      COOKIE: "ngon_ngu_session=TIENG_ANH",
    },
  },

  // Script Properties Keys (Managed strictly via Project Settings > Script Properties)
  KEY_SHEET_ID: "SHEET_ID",
  KEY_ROOT_FOLDER_ID: "ROOT_FOLDER_ID",
  KEY_SCRAPER_API_KEY: "SCRAPER_API_KEY",
  KEY_TEAMS_WEBHOOK_URL: "TEAMS_WEBHOOK_URL",
  KEY_PENDING_TEAMS_NOTIFICATION: "PENDING_TEAMS_NOTIFICATION",

  // In-memory cache for Script Properties to prevent redundant RPC calls during loops
  _propsCache: null,

  getProps: function () {
    if (!this._propsCache) {
      this._propsCache =
        PropertiesService.getScriptProperties().getProperties() || {};
    }
    return this._propsCache;
  },

  /**
   * Retrieves Google Sheet ID from Script Properties (Strict: No hardcoding)
   */
  getSheetId: function () {
    var id = this.getProps()[this.KEY_SHEET_ID];
    if (!id || id.trim() === "") {
      throw new Error(
        "Missing Script Property '" +
          this.KEY_SHEET_ID +
          "'. Please set your Google Sheet ID in Project Settings > Script Properties.",
      );
    }
    return id.trim();
  },

  get SHEET_ID() {
    return this.getSheetId();
  },

  /**
   * Retrieves Google Drive Root Folder ID from Script Properties (Strict: No hardcoding)
   */
  getRootFolderId: function () {
    var id = this.getProps()[this.KEY_ROOT_FOLDER_ID];
    if (!id || id.trim() === "") {
      throw new Error(
        "Missing Script Property '" +
          this.KEY_ROOT_FOLDER_ID +
          "'. Please set your Google Drive Folder ID in Project Settings > Script Properties.",
      );
    }
    return id.trim();
  },

  get ROOT_FOLDER_ID() {
    return this.getRootFolderId();
  },

  /**
   * Retrieves ScraperAPI key from Script Properties
   */
  getScraperApiKey: function () {
    return (this.getProps()[this.KEY_SCRAPER_API_KEY] || "").trim();
  },

  /**
   * Retrieves Microsoft Teams Incoming Webhook URL from Script Properties
   */
  getTeamsWebhookUrl: function () {
    return (this.getProps()[this.KEY_TEAMS_WEBHOOK_URL] || "").trim();
  },

  /**
   * Sanitizes strings (URL queries, errors) to prevent leaking SCRAPER_API_KEY in logs
   */
  sanitizeLog: function (msg) {
    if (!msg) return "";
    return String(msg).replace(/api_key=[^&\s'"]+/gi, "api_key=***");
  },

  /**
   * Validates presence of mandatory Script Properties before executing pipeline.
   * Note: Missing TEAMS_WEBHOOK_URL logs a warning instead of aborting Sheet/Drive sync.
   */
  validateRequiredProperties: function () {
    var props = this.getProps();
    var missing = [];

    if (!props[this.KEY_SHEET_ID]) {
      missing.push(this.KEY_SHEET_ID);
    }
    if (!props[this.KEY_ROOT_FOLDER_ID]) {
      missing.push(this.KEY_ROOT_FOLDER_ID);
    }
    if (this.USE_SCRAPER_API && !props[this.KEY_SCRAPER_API_KEY]) {
      missing.push(this.KEY_SCRAPER_API_KEY);
    }

    if (missing.length > 0) {
      throw new Error(
        "Missing required Script Properties: [" +
          missing.join(", ") +
          "]. Please configure them in Project Settings > Script Properties.",
      );
    }

    if (!props[this.KEY_TEAMS_WEBHOOK_URL]) {
      console.warn(
        "Warning: Script Property '" +
          this.KEY_TEAMS_WEBHOOK_URL +
          "' is not configured. Teams notifications will be skipped.",
      );
    }
  },

  /**
   * Wraps target URL with ScraperAPI gateway using country_code=vn
   */
  buildScraperUrl: function (targetUrl, keepHeaders) {
    var apiKey = this.getScraperApiKey();
    if (!apiKey) return targetUrl;

    var url =
      this.SCRAPER_API_BASE_URL +
      "?api_key=" +
      encodeURIComponent(apiKey) +
      "&country_code=" +
      encodeURIComponent(this.SCRAPER_API_COUNTRY_CODE) +
      (keepHeaders ? "&keep_headers=true" : "") +
      "&url=" +
      encodeURIComponent(targetUrl);

    return url;
  },
};
