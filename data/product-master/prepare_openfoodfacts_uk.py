"""Review-only OFF UK starter extract. No database/application dependencies.

Run with the existing local Python runtime:
  prepare_openfoodfacts_uk.py --download
  prepare_openfoodfacts_uk.py
  prepare_openfoodfacts_uk.py --test

The bounded official global TSV snapshot is NOT a complete UK export.
OFF data is ODbL; product images have separate licensing (see OFF data terms).
"""
import argparse
import csv
import hashlib
import io
import json
import re
import unittest
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

OUT = Path(__file__).resolve().parent
RAW = OUT / "openfoodfacts_official_starter_raw.tsv"
META = OUT / "openfoodfacts_uk_download.json"
DEST = OUT / "onepos_global_product_master_openfoodfacts_uk.csv"
AUDIT = OUT / "openfoodfacts_uk_inspection.json"
URL = "https://openfoodfacts-ds.s3.eu-west-3.amazonaws.com/en.openfoodfacts.org.products.csv"
FIELDS = ["ean", "name", "brand", "pack_size", "category", "image_url", "source"]
csv.field_size_limit(16 * 1024 * 1024)


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def reject_gtin(value):
    if not value:
        return "blank_ean"
    if not re.fullmatch(r"(?:[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})", value):
        return "invalid_ean"
    if len(set(value)) == 1:
        return "placeholder_repeating_ean"
    # Conservatively reject repeated short patterns and common sequential placeholders.
    if any(value == (value[:n] * ((len(value) + n - 1) // n))[:len(value)]
           for n in (2, 3, 4) if len(value) >= n * 2):
        return "placeholder_repeating_ean"
    if value in {"12345670", "123456789012", "1234567890128", "0123456789012", "01234567890128"}:
        return "placeholder_repeating_ean"
    weighted = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(value[:-1])))
    return None if (10 - weighted % 10) % 10 == int(value[-1]) else "invalid_ean"


def is_uk(row):
    return "en:united-kingdom" in {x.strip().lower() for x in row.get("countries_tags", "").split(",")}


def image_url(row):
    for field in ("image_front_url", "image_url"):
        value = row.get(field, "").strip()
        try:
            parsed = urlsplit(value)
            if parsed.scheme in ("https", "http") and parsed.hostname and not parsed.username and not parsed.password and not re.search(r"\s", value):
                return value
        except ValueError:
            pass
    return ""


def download(limit):
    import requests  # existing user-local runtime, not installed system-wide
    metadata = json.loads(META.read_text(encoding="utf-8")) if META.exists() else {"attempts": []}
    extra = [
        {"url": "https://world.openfoodfacts.org/country/united-kingdom/products.csv", "status": 404},
        {"url": "https://uk.openfoodfacts.org/cgi/search.pl?action=process&json=1&page_size=100&page=1", "status": 503},
        {"url": "https://world.openfoodfacts.org/cgi/search.pl?action=process&tagtype_0=countries&tag_contains_0=contains&tag_0=united-kingdom&json=1&page_size=100&page=1", "status": 503},
        {"url": "https://world.openfoodfacts.org/api/v2/search?countries_tags_en=united-kingdom&page_size=100", "status": 503},
        {"url": "https://mirabelle.openfoodfacts.org/products.json", "error": "ReadTimeout after 60 seconds"},
        {"url": "https://mirabelle.openfoodfacts.org/products/products.json?_size=1", "error": "ReadTimeout after 60 seconds"},
    ]
    for item in extra:
        if item not in metadata["attempts"]:
            metadata["attempts"].append(item)
    tmp = RAW.with_suffix(".download")
    try:
        with requests.get(URL, stream=True, timeout=(20, 120), headers={"User-Agent": "onePOS-ProductMasterResearch/1.0"}) as response:
            response.raise_for_status()
            response.raw.decode_content = True
            reader = csv.reader(io.TextIOWrapper(response.raw, encoding="utf-8", newline=""), delimiter="\t", strict=True)
            columns = next(reader)
            assert {"code", "countries_tags", "product_name", "brands", "quantity", "categories", "image_url"} <= set(columns)
            count = 0
            with tmp.open("w", encoding="utf-8", newline="") as f:
                writer = csv.writer(f, delimiter="\t")
                writer.writerow(columns)
                for row in reader:
                    assert len(row) == len(columns), "Malformed raw source row"
                    writer.writerow(row)
                    count += 1
                    if count % 10000 == 0:
                        print(f"Downloaded {count} complete records", flush=True)
                    if count >= limit:
                        break
            metadata.update({"url": URL, "downloaded_at": datetime.now(timezone.utc).isoformat(),
                "last_modified": response.headers.get("Last-Modified"), "etag": response.headers.get("ETag"),
                "global_content_length": response.headers.get("Content-Length"), "status": response.status_code,
                "raw_rows": count, "row_limit": limit, "partial": True,
                "snapshot_format": "First complete source records, losslessly reserialized as UTF-8 TSV; not original global file bytes",
                "limitation": "Partial, source-order-biased starter extract; NOT the complete UK catalogue",
                "license": "https://world.openfoodfacts.org/data (ODbL; images separately licensed)"})
        tmp.replace(RAW)
        metadata["raw_sha256"] = sha(RAW)
        META.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    finally:
        tmp.unlink(missing_ok=True)


def clean():
    metadata = json.loads(META.read_text(encoding="utf-8"))
    assert sha(RAW) == metadata["raw_sha256"], "Raw snapshot changed"
    counts = Counter()
    seen = set()
    records, rejected, originals = [], [], []
    with RAW.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        columns = reader.fieldnames
        for number, row in enumerate(reader, 1):
            counts["raw_rows"] += 1
            assert None not in row and all(v is not None for v in row.values())
            if not is_uk(row):
                counts["non_uk_rows"] += 1
                continue
            counts["uk_rows"] += 1
            ean = row["code"].strip()
            reason = reject_gtin(ean)
            identity = ean.zfill(14)
            if reason is None and identity in seen:
                reason = "duplicate_ean"
            if reason:
                counts[reason] += 1
                rejected.append({"raw_record": number, "ean": ean, "reason": reason})
                continue
            seen.add(identity)
            originals.append(ean)
            records.append({"ean": ean, "name": row["product_name"].strip(),
                "brand": row["brands"].strip(), "pack_size": row["quantity"].strip(),
                "category": row["categories"].strip(), "image_url": image_url(row),
                "source": "openfoodfacts:uk"})
    assert counts["raw_rows"] == metadata["raw_rows"]
    assert counts["raw_rows"] == counts["non_uk_rows"] + counts["uk_rows"]
    assert counts["uk_rows"] == len(records) + len(rejected)
    with DEST.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(records)
    with DEST.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        assert reader.fieldnames == FIELDS
        persisted = list(reader)
    assert persisted == records, "CSV round-trip changed data"
    assert [r["ean"] for r in persisted] == originals, "Leading zeros changed"
    assert len({r["ean"].zfill(14) for r in persisted}) == len(persisted)
    assert all(reject_gtin(r["ean"]) is None for r in persisted)
    with (OUT / "onepos_global_product_master_tesco.csv").open(encoding="utf-8", newline="") as f:
        tesco = {r["ean"].zfill(14) for r in csv.DictReader(f)}
    overlap = seen & tesco
    report = {"download_source": metadata, "filename": RAW.name, "columns": columns,
        "dataset_version": {"last_modified": metadata.get("last_modified"), "etag": metadata.get("etag"), "download_date": metadata.get("downloaded_at")},
        "raw_rows": counts["raw_rows"], "uk_filter": "Exact en:united-kingdom token in comma-separated countries_tags; no inference from barcode prefix",
        "rows_after_uk_filter": counts["uk_rows"], "non_uk_rows": counts["non_uk_rows"],
        "blank_eans": counts["blank_ean"], "invalid_eans": counts["invalid_ean"],
        "placeholder_repeating_eans": counts["placeholder_repeating_ean"], "duplicates": counts["duplicate_ean"],
        "final_rows": len(records), "missing_names": sum(not r["name"] for r in records),
        "missing_brands": sum(not r["brand"] for r in records), "missing_pack_sizes": sum(not r["pack_size"] for r in records),
        "missing_categories": sum(not r["category"] for r in records), "missing_images": sum(not r["image_url"] for r in records),
        "leading_zero_records": sum(r["ean"].startswith("0") for r in records),
        "field_mapping": {"ean": "code (trimmed string, never numeric)", "name": "product_name",
            "brand": "brands", "pack_size": "quantity", "category": "categories",
            "image_url": "Valid image_front_url if present, otherwise image_url (primary/front in this export)",
            "country_filter": "countries_tags", "source": "openfoodfacts:uk"},
        "rejected_records": rejected, "raw_sha256": sha(RAW), "cleaned_sha256": sha(DEST),
        "tesco_comparison": {"tesco_records": len(tesco), "overlap": len(overlap), "new_eans": len(seen - tesco),
            "overlap_percent_of_off": round(100 * len(overlap) / len(records), 4) if records else 0},
        "samples": records[:20], "validation": "PASS: validity, normalized uniqueness, leading zeros, row accounting, exact CSV round-trip",
        "limitations": [metadata["limitation"], "GS1 checksum is not proof of registered product identity.",
            "Missing names and other metadata retained as blanks, not invented.",
            "Image URLs validated syntactically, not individually fetched.", "No merge or database import performed."]}
    AUDIT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in {"columns", "rejected_records", "samples", "download_source"}}, indent=2))


class CleanerTests(unittest.TestCase):
    def test_gtins(self):
        for value in ("96385074", "036000291452", "4006381333931", "05000116125234"):
            self.assertIsNone(reject_gtin(value))
        for value in ("", "4006381333932", "4.006381333931E12", "00000000000000", "11111111", "121212121212", "1234567890128"):
            self.assertIsNotNone(reject_gtin(value))
        self.assertEqual("5000116125234".zfill(14), "05000116125234".zfill(14))

    def test_country(self):
        self.assertTrue(is_uk({"countries_tags": "en:france,en:united-kingdom"}))
        self.assertFalse(is_uk({"countries_tags": "en:united-kingdom-other"}))
        self.assertFalse(is_uk({}))

    def test_images(self):
        self.assertEqual(image_url({"image_front_url": "https://example.com/front.jpg"}), "https://example.com/front.jpg")
        self.assertEqual(image_url({"image_url": "javascript:alert(1)"}), "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--limit", type=int, default=50000)
    parser.add_argument("--test", action="store_true")
    args = parser.parse_args()
    if args.test:
        unittest.main(argv=[__file__])
    else:
        if args.download:
            if args.limit < 1:
                parser.error("--limit must be positive")
            download(args.limit)
        clean()
