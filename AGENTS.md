# Vietnam Customs Scraper (Google Apps Script)

Automated pipeline that scrapes scheduled statistical reports from Vietnam Customs (`customs.gov.vn`), maintains an up-to-date Google Sheet table, archives report files into year-partitioned Google Drive folders, and sends push notifications via the LINE Messaging API when a new reporting month is published.

## Architecture & Modules (`gas/`)

- [`Code.gs`](gas/Code.gs) (`Config`): Central configuration for Google Sheet ID, Google Drive Root Folder ID, upstream API endpoint, language/cookie settings, execution guardrails (`MAX_EXECUTION_TIME_MS`, `DEFAULT_MAX_PAGES`), and Script Property keys.
- [`Main.gs`](gas/Main.gs) (`main`, `setup`): Entry point guarded by `LockService.getScriptLock()` to prevent overlapping runs, with isolated error handling per stage.
- [`Scraper.gs`](gas/Scraper.gs) (`Scraper`): Paginates `GetTKHQInfo` via POST requests, validates HTTP 2xx status codes with exponential backoff retries, strips unreachable RFC1918/internal links, and normalizes URLs.
- [`SheetManager.gs`](gas/SheetManager.gs) (`SheetManager`): Performs single-batch reads/writes against Google Sheets, formats the `Month` column (`MM-YYYY`) as plain text (`@`) while gracefully handling `Date` objects, updates existing rows only when hyperlink formulas change, and sorts rows in memory (`YYYYMM` descending).
- [`DriveManager.gs`](gas/DriveManager.gs) (`DriveManager`): Archives the highest-priority file per row (`[Official]` > `[Adjusted]` > `[Preliminary]`) into `<ROOT_FOLDER>/<YYYY>/`. Pre-indexes existing folder contents once per run and respects `Config.MAX_EXECUTION_TIME_MS`.
- [`LineManager.gs`](gas/LineManager.gs) (`LineManager`): Sends LINE Messaging API push alerts when a newer `YYYYMM` period is found, advancing `LAST_NOTIFIED_MONTH` only after confirmed HTTP 200/202 delivery.

## Script Properties Setup

Configure the following keys in **Project Settings > Script Properties** in the Google Apps Script editor:

| Property | Description |
| :--- | :--- |
| `LINE_ACCESS_TOKEN` | Channel access token for the LINE Messaging API bot |
| `LINE_GROUP_ID` | Target LINE Group ID or User ID to receive push alerts |
| `LAST_NOTIFIED_MONTH` | Last notified period in `YYYYMM` format (e.g., `202512`); can be initialized via `setup()` |

