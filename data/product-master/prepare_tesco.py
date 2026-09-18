"""Prepare a review-only Tesco global master; never accesses the onePOS database."""
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

import kagglehub

SOURCE = "kaggle:crawlfeeds/tesco-uk-groceries-dataset"
FIELDS = ["ean", "name", "brand", "pack_size", "category", "image_url", "source"]
OUT = Path(__file__).resolve().parent


def valid_gtin(value):
    if not re.fullmatch(r"(?:[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})", value):
        return False
    if set(value) == {"0"}:
        return False
    weighted = sum(int(digit) * (3 if index % 2 == 0 else 1)
                   for index, digit in enumerate(reversed(value[:-1])))
    return (10 - weighted % 10) % 10 == int(value[-1])


def main():
    # Known check-digit cases; zero-padding must survive unchanged.
    assert valid_gtin("4006381333931")
    assert valid_gtin("96385074")
    assert valid_gtin("036000291452")
    assert valid_gtin("05000116125234")
    assert not valid_gtin("4006381333932")
    assert not valid_gtin("00000000000000")
    assert not valid_gtin("4.006381333931E12")
    assert not valid_gtin("")

    downloaded = Path(kagglehub.dataset_download("crawlfeeds/tesco-uk-groceries-dataset"))
    raw = downloaded / "tesco_groceries_dataset.csv"
    with raw.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        rows = list(reader)
        columns = reader.fieldnames
    assert {"gtin13", "name", "brand", "pack_size", "breadcrumbs", "images"} <= set(columns)
    counts = Counter()
    seen = set()
    clean = []
    rejected = []
    for line, row in enumerate(rows, start=2):
        gtin = row["gtin13"].strip()
        reason = "blank_gtin" if not gtin else "invalid_gtin" if not valid_gtin(gtin) else None
        # Compare equivalent GTIN representations without changing the output string.
        identity = gtin.zfill(14)
        if reason is None and identity in seen:
            reason = "duplicate_gtin"
        if reason:
            counts[reason] += 1
            rejected.append({"csv_record": line, "gtin": gtin, "reason": reason})
            continue
        seen.add(identity)
        images = [part.strip() for part in row["images"].split("~") if part.strip()]
        image = images[0] if images else ""
        if image and (urlsplit(image).scheme not in ("http", "https") or not urlsplit(image).netloc):
            counts["invalid_image_url"] += 1
            image = ""
        clean.append({
            "ean": gtin,
            "name": row["name"].strip(),
            "brand": row["brand"].strip(),
            "pack_size": re.sub(r"^Pack size:\s*", "", row["pack_size"].strip(), flags=re.I),
            "category": " > ".join(part.strip() for part in row["breadcrumbs"].split("~") if part.strip()),
            "image_url": image,
            "source": SOURCE,
        })
    output = OUT / "onepos_global_product_master_tesco.csv"
    with output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(clean)
    with output.open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream)
        assert reader.fieldnames == FIELDS
        persisted = list(reader)
    assert persisted == clean
    assert all(valid_gtin(row["ean"]) for row in persisted)
    assert len({row["ean"].zfill(14) for row in persisted}) == len(persisted)
    assert len(rows) == len(clean) + len(rejected)
    report = {
        "source": SOURCE, "download_path": str(downloaded), "filename": raw.name,
        "raw_sha256": hashlib.sha256(raw.read_bytes()).hexdigest(),
        "input_rows": len(rows), "columns": columns,
        "mapping": {"ean": "gtin13 (preserved string)", "name": "name", "brand": "brand",
                    "pack_size": "pack_size (remove Pack size: label only)",
                    "category": "breadcrumbs (~ becomes >)", "image_url": "images (first URL)", "source": SOURCE},
        "input_gtin_lengths": dict(Counter(len(row["gtin13"].strip()) for row in rows)),
        "scraped_at_values": sorted({row["scraped_at"] for row in rows}),
        "removed_blank": counts["blank_gtin"], "removed_invalid": counts["invalid_gtin"],
        "removed_duplicates": counts["duplicate_gtin"], "invalid_image_urls": counts["invalid_image_url"],
        "output_rows": len(clean), "missing_pack_size": sum(not row["pack_size"] for row in clean),
        "output_path": str(output), "output_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "rejected": rejected, "sample_records": clean[:20],
        "validation": "PASS: checksums, uniqueness, exact CSV round-trip, field whitelist, row accounting",
        "limitations": "Checksum is not GS1 registration verification. Import ean as text in spreadsheets. No prices, database import or schema changes."
    }
    (OUT / "tesco_inspection.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
