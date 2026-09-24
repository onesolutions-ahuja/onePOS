/*
 * Product Master — barcode format validation helpers.
 *
 * Pure functions, no I/O: consumed by the ProductFormModal (non-blocking
 * format warning) and unit-tested in tests/productMaster.test.mjs.
 *
 * Policy (deliberately narrow):
 *   - VALIDATION IS ADVISORY in the UI: the form WARNS but still allows
 *     saving. Migration imports from other EPOS systems must not be blocked
 *     by a strict gate, and legacy bespoke labels exist in the wild.
 *   - The DATABASE stores barcodes as VARCHAR(100) — never numeric — so
 *     leading zeroes are preserved and EAN-8/UPC-E stay intact.
 *   - Uniqueness (per company, active products) is enforced by the API
 *     duplicate checks (409) and the guarded partial unique indexes.
 *
 * Supported formats (matches the POS camera scanner hints exactly):
 *   EAN-13, EAN-8, UPC-A (12), UPC-E (6/7/8), Code 128 (variable length).
 */

/* GS1 check digit (mod-10) used by EAN-8/UPC-A(12)/EAN-13/GTIN-14. */
export function gs1ChecksumValid(digits) {
  if (!/^[0-9]+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length - 1; i += 1) {
    /* From the RIGHT, weights alternate 3,1,3,1… */
    const positionFromRight = digits.length - 2 - i;
    sum += Number(digits[i]) * (positionFromRight % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/*
 * UPC-E is a zero-compressed UPC-A; its embedded check digit follows the
 * same GS1 mod-10 rule once expanded. Rather than implementing the six
 * expansion patterns (out of scope for an advisory warning), 8-digit
 * inputs starting with 0/1 are accepted as UPC-E WITHOUT checksum
 * verification — a wrong-but-plausible UPC-E still scans correctly at the
 * till because lookup is by exact stored string.
 */
function upceAccepted(digits) {
  return /^[01][0-9]{7}$/.test(digits);
}

/**
 * Classify a product barcode string.
 * Returns { format, valid, message }:
 *   format: "EAN-13" | "EAN-8" | "UPC-A" | "UPC-E" | "CODE128" | "unknown"
 *   valid:  true when the string matches the format's shape (and checksum
 *           where implemented) — false for unknown/invalid shapes.
 */
export function validateBarcode(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { format: "unknown", valid: false, message: "No barcode" };

  if (/^[0-9]{13}$/.test(value)) {
    return gs1ChecksumValid(value)
      ? { format: "EAN-13", valid: true, message: "EAN-13 (checksum OK)" }
      : { format: "EAN-13", valid: false, message: "EAN-13 check digit is wrong — check the label" };
  }
  if (/^[0-9]{8}$/.test(value)) {
    /* 8 digits: EAN-8, or UPC-E when it zero-compresses (leading 0/1). */
    if (/^[01]/.test(value)) {
      return upceAccepted(value)
        ? { format: "UPC-E", valid: true, message: "UPC-E" }
        : { format: "UPC-E", valid: false, message: "UPC-E must start with 0 or 1" };
    }
    return gs1ChecksumValid(value)
      ? { format: "EAN-8", valid: true, message: "EAN-8 (checksum OK)" }
      : { format: "EAN-8", valid: false, message: "EAN-8 check digit is wrong — check the label" };
  }
  if (/^[0-9]{12}$/.test(value)) {
    return gs1ChecksumValid(value)
      ? { format: "UPC-A", valid: true, message: "UPC-A (checksum OK)" }
      : { format: "UPC-A", valid: false, message: "UPC-A check digit is wrong — check the label" };
  }
  if (/^[0-9]{14}$/.test(value)) {
    /* GTIN-14 (ITF-14 / carton codes) — same mod-10 check. */
    return gs1ChecksumValid(value)
      ? { format: "EAN-13", valid: true, message: "GTIN-14 (carton code, checksum OK)" }
      : { format: "EAN-13", valid: false, message: "GTIN-14 check digit is wrong — check the label" };
  }
  if (/^[0-9]{6}$/.test(value)) {
    return { format: "UPC-E", valid: true, message: "UPC-E (6-digit zero-compressed form)" };
  }
  /* Code 128: variable length, full ASCII — accept printable ASCII. */
  if (/^[\x20-\x7E]{1,48}$/.test(value)) {
    return { format: "CODE128", valid: true, message: "Code 128" };
  }
  return { format: "unknown", valid: false, message: "Not a recognised EAN/UPC/Code-128 barcode" };
}

/*
 * Server-side IDENTITY gate (routes/products.js create/edit).
 *
 * STRICT for exactly 13-digit numeric barcodes: such a string is by
 * definition an EAN-13/GTIN-13, and a wrong check digit is a data error
 * that would make the barcode silently unfindable at every till (keyboard
 * scan, camera Search Code and search all match the stored string). Those
 * are rejected with a clear 400 — identity data must not be corrupted.
 *
 * Every other shape stays ADVISORY (see validateBarcode): UPC-E check
 * digits are expansion-dependent, short/Code-128 style shop codes are
 * legitimate, 12/14-digit legacy imports must keep loading, and migration
 * data may contain bespoke labels. Returns null when the value is
 * acceptable, or a human-readable message for the API's 400.
 */
export function ean13IdentityError(raw) {
  const value = String(raw ?? "").trim();
  if (!/^[0-9]{13}$/.test(value)) return null;
  if (gs1ChecksumValid(value)) return null;
  return "Barcode is a 13-digit EAN but its check digit is invalid — re-scan or enter the number exactly as printed.";
}
