#!/usr/bin/env python3
"""
Vietnam Customs Scraper (Python CLI)
Scrapes statistical reports from Vietnam Customs (customs.gov.vn) via ScraperAPI,
merges metadata with existing records in CSV/JSON, and downloads report files into
year-partitioned output folders.
"""

import os
import re
import csv
import json
import time
import argparse
import urllib.parse
from pathlib import Path
from datetime import datetime
import requests

# Default Configuration
BASE_URL = "https://www.customs.gov.vn"
API_ENDPOINT = "https://www.customs.gov.vn/bridge?url=/customs/api/GetTKHQInfo"
SCRAPER_API_BASE = "https://api.scraperapi.com/"
DEFAULT_COUNTRY = "vn"
PAGE_SIZE = 20
DEFAULT_MAX_PAGES = 1  # Check page 1 (20 latest items) by default; historical files are preserved
INTERNAL_IP_REGEX = re.compile(
    r"^https?://(?:10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.|localhost)",
    re.IGNORECASE,
)

LANG_CONFIG = {
    "TIENG_VIET": {
        "REFERER": "https://www.customs.gov.vn/index.jsp?pageId=5002&group=undefined&category=Scheduled%20data%20(2009%20-%20Year%20to%20date)",
        "COOKIE": "ngon_ngu_session=TIENG_VIET",
    },
    "TIENG_ANH": {
        "REFERER": "https://www.customs.gov.vn/index.jsp?pageId=4971&ngon_ngu=en-US",
        "COOKIE": "ngon_ngu_session=TIENG_ANH",
    },
}


def sanitize_log(msg: object) -> str:
    """Masks SCRAPER_API_KEY from logs and error messages."""
    if not msg:
        return ""
    return re.sub(r"api_key=[^&\s'\"]+", "api_key=***", str(msg), flags=re.IGNORECASE)


def load_env_key() -> str:
    """Reads SCRAPER_API_KEY from environment or .env file."""
    if os.environ.get("SCRAPER_API_KEY"):
        return os.environ["SCRAPER_API_KEY"].strip()

    env_path = Path(".env")
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("SCRAPER_API_KEY"):
                match = re.search(r'=\s*["\']?([^"\']+)["\']?', line)
                if match:
                    return match.group(1).strip()
    return ""


def build_scraper_url(target_url: str, api_key: str, keep_headers: bool = False) -> str:
    """Wraps target URL with ScraperAPI gateway using country_code=vn."""
    params = {
        "api_key": api_key,
        "country_code": DEFAULT_COUNTRY,
        "url": target_url,
    }
    if keep_headers:
        params["keep_headers"] = "true"
    return f"{SCRAPER_API_BASE}?{urllib.parse.urlencode(params)}"


def normalize_link(raw_url: str) -> str:
    """Cleans up and normalizes report file URLs, filtering out unreachable internal IPs."""
    if not raw_url or not isinstance(raw_url, str):
        return ""
    url_str = raw_url.strip()
    if not url_str or url_str.lower() == "null":
        return ""

    if "10.224.128.185" in url_str or INTERNAL_IP_REGEX.search(url_str):
        return ""

    if not re.match(r"^https?://", url_str, re.IGNORECASE):
        prefix = "" if url_str.startswith("/") else "/"
        url_str = f"{BASE_URL}{prefix}{url_str}"

    return url_str.replace(" ", "%20")


def format_month(month_val: str) -> str:
    """Normalizes month string to MM-YYYY format."""
    if not month_val:
        return ""
    match = re.search(r"(\d{1,2})[-/](\d{4})", str(month_val).strip())
    if match:
        mm = int(match.group(1))
        yyyy = match.group(2)
        return f"{mm:02d}-{yyyy}"
    return str(month_val).strip()


def parse_month_int(month_str: str) -> int:
    """Parses 'MM-YYYY' into integer YYYYMM for sorting."""
    norm = format_month(month_str)
    match = re.search(r"(\d{2})-(\d{4})", norm)
    if match:
        return int(match.group(2)) * 100 + int(match.group(1))
    return 0


def fetch_page(api_key: str, skip: int, take: int, language: str = "TIENG_ANH", max_retries: int = 3):
    """Fetches a single page of report metadata via ScraperAPI."""
    lang_info = LANG_CONFIG.get(language, LANG_CONFIG["TIENG_ANH"])
    target_api = API_ENDPOINT
    proxy_url = build_scraper_url(target_api, api_key, keep_headers=True)

    payload = {
        "skip": skip,
        "take": take,
        "ky": "",
        "textSearch": "",
        "the_loai": "0",
        "thoigianCongBo": "",
        "typeName": "GetListSoLieu",
        "language": language,
    }

    headers = {
        "Content-Type": "application/json; charset=UTF-8",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": BASE_URL,
        "Referer": lang_info["REFERER"],
        "Cookie": lang_info["COOKIE"],
    }

    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(
                proxy_url,
                headers=headers,
                data=json.dumps(payload),
                timeout=30,
            )
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, dict) and "arr" in data and isinstance(data["arr"], list):
                    return data["arr"]
                print(f"[Warning] Response did not contain 'arr' array: {resp.text[:150]}")
                return []
            raise requests.HTTPError(f"HTTP {resp.status_code}: {resp.text[:150]}")
        except Exception as e:
            print(f"[Attempt {attempt}/{max_retries}] Fetch failed: {sanitize_log(e)}")
            if attempt < max_retries:
                sleep_sec = attempt * 2
                time.sleep(sleep_sec)
            else:
                raise


def scrape_latest_reports(api_key: str, max_pages: int, language: str = "TIENG_ANH"):
    """Paginates through latest report lists and parses rows."""
    all_rows = []
    skip = 0
    take = PAGE_SIZE

    print(f"\n[Scraping] Checking latest reports (up to {max_pages} pages, {take} items/page)...")
    for page in range(1, max_pages + 1):
        print(f" -> Fetching page {page} (skip: {skip})...", end=" ", flush=True)
        raw_items = fetch_page(api_key, skip, take, language=language)
        if not raw_items:
            print("No items returned. Done.")
            break

        parsed_items = []
        for item in raw_items:
            title = (item.get("TIEU_DE") or "").strip()
            month = (item.get("NGAY_CONG_BO") or "").strip()
            if not title or not month:
                continue

            parsed_items.append({
                "content": title,
                "month": format_month(month),
                "prelim_url": normalize_link(item.get("FILE_SO_BO")),
                "adj_url": normalize_link(item.get("FILE_DIEU_CHINH")),
                "official_url": normalize_link(item.get("FILE_CHINH_THUC")),
            })

        print(f"Received {len(parsed_items)} items.")
        all_rows.extend(parsed_items)

        if len(raw_items) < take:
            break

        skip += take
        time.sleep(1)

    return all_rows


def merge_and_export_metadata(new_rows, output_dir: Path):
    """
    Merges newly scraped rows into existing reports.csv (preserving historical data),
    updates changed file links, and saves to CSV and JSON.
    Sorts by Month descending (YYYYMM), then Title ascending (A -> Z), matching GAS SheetManager.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / "reports.csv"
    json_path = output_dir / "reports.json"

    existing_rows = []
    key_to_idx = {}

    # Read existing historical records if CSV exists
    if csv_path.exists():
        with open(csv_path, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                content = (row.get("Title") or "").strip()
                month = format_month(row.get("Month") or "")
                key = f"{content}_{month}"
                record = {
                    "content": content,
                    "month": month,
                    "prelim_url": row.get("Preliminary Link", "").strip(),
                    "adj_url": row.get("Adjusted Link", "").strip(),
                    "official_url": row.get("Official Link", "").strip(),
                }
                key_to_idx[key] = len(existing_rows)
                existing_rows.append(record)

    added_count = 0
    updated_count = 0

    for nr in new_rows:
        key = f"{nr['content']}_{nr['month']}"
        if key in key_to_idx:
            idx = key_to_idx[key]
            curr = existing_rows[idx]
            # Check if any link formula changed/added
            next_prelim = nr["prelim_url"] or curr["prelim_url"]
            next_adj = nr["adj_url"] or curr["adj_url"]
            next_official = nr["official_url"] or curr["official_url"]

            if (
                curr["prelim_url"] != next_prelim
                or curr["adj_url"] != next_adj
                or curr["official_url"] != next_official
            ):
                curr["prelim_url"] = next_prelim
                curr["adj_url"] = next_adj
                curr["official_url"] = next_official
                updated_count += 1
        else:
            key_to_idx[key] = len(existing_rows)
            existing_rows.append(nr)
            added_count += 1

    # Sort all rows by Month descending (-YYYYMM), then Title ascending (matching GAS SheetManager)
    existing_rows.sort(key=lambda r: (-parse_month_int(r["month"]), r["content"]))

    # Export merged CSV with UTF-8 BOM
    with open(csv_path, mode="w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["Title", "Month", "Preliminary Link", "Adjusted Link", "Official Link"])
        for r in existing_rows:
            writer.writerow([r["content"], r["month"], r["prelim_url"], r["adj_url"], r["official_url"]])

    # Export merged JSON
    with open(json_path, mode="w", encoding="utf-8") as f:
        json.dump(existing_rows, f, indent=2, ensure_ascii=False)

    print(f"\n[Metadata Synced]")
    print(f" -> Added: {added_count}, Updated: {updated_count}, Total in file: {len(existing_rows)} rows")
    return added_count, updated_count, existing_rows


def sanitize_filename(name: str) -> str:
    """Removes invalid filesystem characters."""
    sanitized = re.sub(r'[\\/:*?"<>|\r\n]+', "", name)
    return re.sub(r"\s+", " ", sanitized).strip()


def extract_extension(url: str) -> str:
    """Extracts file extension from URL, defaulting to .pdf (matching GAS DriveManager)."""
    parsed = urllib.parse.urlparse(url)
    ext = os.path.splitext(parsed.path)[1].lower()
    return ext if ext in [".pdf", ".xlsx", ".xls", ".doc", ".docx", ".zip"] else ".pdf"


def download_reports(rows, output_dir: Path, api_key: str):
    """
    Downloads highest priority file per row ([Official] > [Adjusted] > [Preliminary])
    into year-partitioned folders output/<YYYY>/ via ScraperAPI.
    Uses atomic writes (.part -> final) and validates Content-Type to reject HTML error pages.
    """
    print(f"\n[Downloading] Checking for new report files to archive...")
    downloaded = 0
    skipped = 0
    failed = 0

    for i, row in enumerate(rows, start=1):
        month_norm = row["month"]
        year = month_norm.split("-")[1] if "-" in month_norm else "Unknown"
        year_folder = output_dir / year
        year_folder.mkdir(parents=True, exist_ok=True)

        target_url = None
        status_prefix = ""

        if row.get("official_url"):
            target_url = row["official_url"]
            status_prefix = "[Official]"
        elif row.get("adj_url"):
            target_url = row["adj_url"]
            status_prefix = "[Adjusted]"
        elif row.get("prelim_url"):
            target_url = row["prelim_url"]
            status_prefix = "[Preliminary]"

        if not target_url:
            continue

        ext = extract_extension(target_url)
        file_name = sanitize_filename(f"[{month_norm}]{status_prefix} {row['content']}{ext}")
        file_path = year_folder / file_name
        temp_path = year_folder / f"{file_name}.part"

        if file_path.exists() and file_path.stat().st_size >= 100:
            skipped += 1
            continue

        print(f" [{i}/{len(rows)}] Downloading new file: {file_name}...")
        download_proxy_url = build_scraper_url(target_url, api_key, keep_headers=False)

        download_success = False
        for dl_attempt in range(1, 3):
            try:
                with requests.get(download_proxy_url, stream=True, timeout=60) as resp:
                    if resp.status_code == 200:
                        content_type = (resp.headers.get("Content-Type") or "").lower()

                        # Reject HTML error/maintenance pages
                        if "text/html" in content_type:
                            print(f"   [Error] Rejected download for {file_name}: received HTML instead of binary file.")
                            if dl_attempt < 2:
                                time.sleep(2)
                                continue
                            else:
                                break

                        with open(temp_path, "wb") as f:
                            for chunk in resp.iter_content(chunk_size=8192):
                                if chunk:
                                    f.write(chunk)

                        # Atomic rename only if file size is valid (>= 100 bytes)
                        if temp_path.exists() and temp_path.stat().st_size >= 100:
                            temp_path.replace(file_path)
                            downloaded += 1
                            download_success = True
                            break
                        else:
                            print(f"   [Error] Incomplete or corrupted download for {file_name} (< 100 bytes).")
                            if temp_path.exists():
                                temp_path.unlink()
                    elif dl_attempt < 2:
                        time.sleep(2)
                    else:
                        print(f"   [Error] HTTP {resp.status_code} for {file_name}")
            except Exception as e:
                if temp_path.exists():
                    temp_path.unlink()
                if dl_attempt < 2:
                    time.sleep(2)
                else:
                    print(f"   [Error] Download failed for {file_name}: {sanitize_log(e)}")

        if not download_success:
            failed += 1

        time.sleep(0.5)

    print(f"\n[Download Summary]")
    print(f" -> Newly Downloaded: {downloaded}")
    print(f" -> Already Existed (Skipped): {skipped}")
    print(f" -> Failed: {failed}")
    return downloaded


def main():
    parser = argparse.ArgumentParser(description="Vietnam Customs Scraper CLI (Python)")
    parser.add_argument("--pages", type=int, default=DEFAULT_MAX_PAGES, help="Max pages to scrape (default: 1)")
    parser.add_argument("--lang", type=str, default="TIENG_ANH", choices=["TIENG_ANH", "TIENG_VIET"], help="Language")
    parser.add_argument("--output", type=str, default="output", help="Output directory path (default: output)")
    parser.add_argument("--no-download", action="store_true", help="Only save metadata without downloading files")
    args = parser.parse_args()

    api_key = load_env_key()
    if not api_key:
        print("[Error] SCRAPER_API_KEY not found! Please define it in your .env file or environment.")
        return

    output_dir = Path(args.output)
    scraped_rows = scrape_latest_reports(api_key, max_pages=args.pages, language=args.lang)

    if not scraped_rows:
        print("No reports returned from website.")
        return

    added, updated, all_rows = merge_and_export_metadata(scraped_rows, output_dir)

    new_downloads = 0
    if not args.no_download:
        new_downloads = download_reports(scraped_rows, output_dir, api_key)

    if added == 0 and updated == 0 and new_downloads == 0:
        print("\nAll files and metadata are already up-to-date. No new publications detected.")
    else:
        print(f"\nFinished processing updates ({added} added, {updated} updated, {new_downloads} downloaded).")


if __name__ == "__main__":
    main()
