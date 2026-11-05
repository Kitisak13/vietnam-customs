var Config = {
  // Google Sheets ID
  SHEET_ID: "1BG1hbTFyM-fKuGBvrWeBi1Kbtg-N6526r7vb8cDk6SQ",
  SHEET_NAME: "Data", // Default sheet name

  // Google Drive Root Folder ID
  ROOT_FOLDER_ID: "1xzIgYuZvtcoercgHVFIKgdfbBn0W4LFG",

  // Target Website Config
  BASE_URL: "https://www.customs.gov.vn",
  API_ENDPOINT:
    "https://www.customs.gov.vn/bridge?url=/customs/api/GetTKHQInfo",

  // Scraper & Execution Guardrails
  DEFAULT_MAX_PAGES: 6,
  PAGE_SIZE: 20,
  MAX_RETRIES: 3,
  MAX_EXECUTION_TIME_MS: 270000, // 4.5 minutes safety limit (GAS hard limit is 6 mins)

  // Language Configuration
  LANGUAGE: "TIENG_ANH", // Change this to 'TIENG_VIET' or 'TIENG_ANH'

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

  // Script Properties Keys (for state management & secrets)
  KEY_LAST_NOTIFIED_MONTH: "LAST_NOTIFIED_MONTH",
  KEY_LINE_GROUP_ID: "LINE_GROUP_ID",
  KEY_LINE_ACCESS_TOKEN: "LINE_ACCESS_TOKEN",
};
