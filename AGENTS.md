# Vietnam Customs Scraper (Google Apps Script & Python CLI)

Automated pipeline that scrapes scheduled statistical reports from Vietnam Customs (`customs.gov.vn`), maintains an up-to-date Google Sheet table, archives report files into year-partitioned folders (Google Drive or local `output/`), and sends push notifications via Microsoft Teams Channel Webhook when new reports or files are published. Bypasses Vietnam Geo-blocking via ScraperAPI (`country_code=vn`).

## Architecture & Modules

### Google Apps Script (`gas/`)

- [`Code.gs`](gas/Code.gs) (`Config`): Central configuration with strict Script Property getters for Google Sheet ID, Google Drive Root Folder ID, ScraperAPI proxy routing, upstream API endpoint, language settings, execution guardrails, and validation helper `validateRequiredProperties()`. Defaults to `DEFAULT_MAX_PAGES = 1` (20 latest reports).
- [`Main.gs`](gas/Main.gs) (`main`, `setupTriggers`, `setup`): Entry point guarded by `LockService.getScriptLock()` to prevent overlapping runs, weekend execution bypass (skips Saturday/Sunday), and time-driven trigger setup for 11:00 and 15:00 daily.
- [`Scraper.gs`](gas/Scraper.gs) (`Scraper`): Paginates `GetTKHQInfo` via POST requests (`application/json`), proxies via ScraperAPI, validates HTTP 2xx status codes with exponential backoff retries, strips unreachable RFC1918/internal links, and normalizes URLs.
- [`SheetManager.gs`](gas/SheetManager.gs) (`SheetManager`): Performs single-batch reads/writes against Google Sheets, formats the `Month` column (`MM-YYYY`) as plain text (`@`), tracks new/updated rows indexed by unique `(Title + Month)`, and sorts rows in memory (`YYYYMM` descending).
- [`DriveManager.gs`](gas/DriveManager.gs) (`DriveManager`): Archives the highest-priority file per row (`[Official]` > `[Adjusted]` > `[Preliminary]`) into `<ROOT_FOLDER>/<YYYY>/` via ScraperAPI download. Skips files that already exist on Drive, tracks newly downloaded filenames, and respects `Config.MAX_EXECUTION_TIME_MS`.
- [`TeamsManager.gs`](gas/TeamsManager.gs) (`TeamsManager`): Sends rich Adaptive Card notifications to Microsoft Teams Incoming Webhook whenever new reports are published or new files are downloaded, listing the exact titles of the published reports.

### Python Local Pipeline (`scraper.py`)

- Standalone CLI equivalent designed to run locally or in cron/task scheduler.
- Reads `SCRAPER_API_KEY` from `.env`.
- Checks latest reports (default `--pages 1`), merges metadata into `output/reports.csv` and `output/reports.json` while preserving historical records.
- Downloads newly published files into `output/<YYYY>/` using ScraperAPI (`country_code=vn`), skipping existing files.

## Script Properties Setup (Google Apps Script)

Configure the following keys in **Project Settings > Script Properties** in the Google Apps Script editor:

| Property            | Description                                            | Example / Required                                        |
| :------------------ | :----------------------------------------------------- | :-------------------------------------------------------- |
| `SHEET_ID`          | Google Spreadsheet ID to store report metadata         | `1BG1hbTFyM-fKuGBvrWeBi1Kbtg-N6526r7vb8cDk6SQ` (Required) |
| `ROOT_FOLDER_ID`    | Google Drive Root Folder ID for PDF/Excel archiving    | `1xzIgYuZvtcoercgHVFIKgdfbBn0W4LFG` (Required)            |
| `SCRAPER_API_KEY`   | API Key from ScraperAPI to bypass Vietnam geo-blocking | From `.env` (Required)                                    |
| `TEAMS_WEBHOOK_URL` | Microsoft Teams Incoming Webhook URL                   | `https://outlook.office.com/webhook/...` (Required)       |

## Automation & Triggers Setup

Run the `setup()` function in the Apps Script Editor once:

1. Automatically registers 2 daily triggers: **11:00 AM** and **3:00 PM (15:00)**.
2. Validates the existence of all 4 mandatory Script Properties.
3. When triggers fire on weekends (Saturday / Sunday), execution terminates early immediately without consuming quota.
4. Each scheduled run only fetches the latest page (20 items) and checks against existing sheet records and drive files. If no new reports were published, the run completes in ~2-3 seconds using only 1 ScraperAPI credit and sends no notification.
