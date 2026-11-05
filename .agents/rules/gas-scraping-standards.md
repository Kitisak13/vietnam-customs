# Standards for Scraping & Google Apps Script (GAS) Pipelines

These standards capture production-grade patterns and guardrails for automated web scraping and Google Apps Script pipelines.

## 1. Credentials & Log Sanitization
- **No Hardcoded Secrets**: Never hardcode Google Sheet IDs, Drive Folder IDs, API keys, or Webhook URLs in source code. Pull strictly from environment variables (`.env`) or Google Apps Script `PropertiesService.getScriptProperties()`.
- **Mask Secrets in Logs**: Proxy URLs and request headers frequently embed API keys (`api_key=<KEY>`). Always redact sensitive tokens before writing to `console.error`, `console.warn`, or logger streams:
  ```javascript
  function sanitizeLog(msg) {
    if (!msg) return "";
    return String(msg).replace(/api_key=[^&\s'"]+/gi, "api_key=***");
  }
  ```
- **PropertiesService In-Memory Cache**: Repeated calls to `PropertiesService.getScriptProperties().getProperty(...)` incur heavy RPC latency. Cache properties once in memory per execution run (`_propsCache`).

## 2. Web Scraping, Proxies & File Integrity
- **Geo-Blocking & WAF Bypass**: When querying geo-locked portals, route requests through a localized proxy (e.g., ScraperAPI with `country_code=<ISO>` and `keep_headers=true`). Send JSON requests with `Content-Type: application/json; charset=UTF-8` to prevent WAF/Captcha rejections.
- **Inspect Response Content-Type (Reject HTML)**: Never trust HTTP `200 OK` alone when expecting binary documents (`.pdf`, `.xlsx`). Upstream gateways often return HTTP 200 with HTML maintenance/error pages. Reject responses if `Content-Type` contains `text/html`.
- **Minimum Byte Size Threshold**: Verify binary file payloads exceed a minimum size (e.g., `>= 100 bytes`) before saving.
- **Atomic File Writes**: In CLI/local pipelines, stream downloads to temporary files (`<filename>.part`) and atomically rename (`temp_path.replace(final_path)`) only upon successful, verified completion. This prevents truncated or corrupted files from lingering and permanently skipping future runs.
- **Proxy Retry Ordering**: In retry loops, inspect `resp.status_code == 200` before rejecting `text/html`, ensuring that transient proxy `502`/`503` HTML error pages trigger subsequent retry attempts.

## 3. Incremental Polling & Multi-Phase Releases
- **Composite Natural Keys**: Avoid keying deduplication solely by coarse time intervals (e.g., `Month / YYYYMM`) when data sources publish multiple sub-period reports within the same month (e.g., First Half, Second Half, Monthly Summary, FDI, Revisions). Index records by `(Title + Month)` and file URL.
- **Incremental Polling**: Poll only the latest page (e.g., Page 1 = 20 items) during routine cron executions to minimize API credits and run time, while merging into existing historical tables.

## 4. Google Apps Script Triggers & Webhook Reliability
- **Trigger vs. Manual Execution Separation**: When implementing scheduling bypasses (e.g., skipping weekend runs), check `Boolean(e && e.triggerUid)`. This ensures automated triggers skip weekends while allowing engineers to manually run and test the script from the Apps Script Editor anytime.
- **Resilient Webhook Delivery**: Webhook alerts (e.g., Microsoft Teams, Slack) must implement retries with backoff. If all attempts fail, persist the payload in `ScriptProperties` (`PENDING_NOTIFICATION`) to automatically flush on the subsequent scheduled run, guaranteeing zero lost alerts.
- **Non-Fatal Notification Warnings**: Missing notification webhooks should log a warning rather than throwing fatal exceptions, allowing core data ingestion (Sheets & Drive) to continue uninterrupted.

