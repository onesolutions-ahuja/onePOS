// Global reference data only; never writes store products or inventory.
export const CSV_FIELDS = ['ean', 'name', 'brand', 'pack_size', 'category', 'image_url', 'source'];
export const DB_FIELDS = ['ean', 'product_name', 'brand', 'unit_description', 'category', 'image_url', 'source'];
export function validGtin(ean) {
  if (typeof ean !== 'string' || !/^(?:[0-9]{8}|[0-9]{12,14})$/.test(ean) || /^0+$/.test(ean)) return false;
  const sum = [...ean.slice(0, -1)].reverse().reduce((n, d, i) => n + Number(d) * (i % 2 ? 1 : 3), 0);
  return (10 - sum % 10) % 10 === Number(ean.at(-1));
}
export function validateRecords(records, expectedCount = null) {
  if (!Array.isArray(records) || records.length === 0) throw new Error('No records to import');
  if (expectedCount !== null && records.length !== expectedCount) throw new Error(`Expected ${expectedCount} records; found ${records.length}`);
  const seen = new Set();
  for (const r of records) {
    if (CSV_FIELDS.some((k) => typeof r[k] !== 'string') || !validGtin(r.ean)) throw new Error('Invalid record or GTIN');
    const identity = r.ean.padStart(14, '0');
    if (seen.has(identity)) throw new Error('Duplicate GTIN in input');
    seen.add(identity);
    if (!r.name.trim() || r.name.length > 255 || r.brand.length > 200 || r.category.length > 200 || r.pack_size.length > 255) throw new Error('Invalid product metadata length');
  }
}
// Handles quoted commas/newlines/escaped quotes; never trims or coerces data.
export function parseMasterCsv(text, expectedCount = null) {
  const rows = []; let row = []; let cell = ''; let quoted = false; let closed = false;
  const input = text.replace(/^\uFEFF/, '');
  const endCell = () => { row.push(cell); cell = ''; closed = false; };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; }
      } else cell += ch;
    } else if (ch === ',') endCell();
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      endCell(); rows.push(row); row = [];
    } else if (ch === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || ch === '"') throw new Error('Malformed CSV quoting');
      cell += ch;
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (cell || row.length || closed) { endCell(); rows.push(row); }
  if (JSON.stringify(rows.shift()) !== JSON.stringify(CSV_FIELDS)) throw new Error('Unexpected CSV columns');
  const records = rows.map((values) => {
    if (values.length !== CSV_FIELDS.length) throw new Error('Unexpected CSV field count');
    return Object.fromEntries(CSV_FIELDS.map((field, i) => [field, values[i]]));
  });
  validateRecords(records, expectedCount);
  return records;
}
export function mapRecord(record) {
  return Object.fromEntries(DB_FIELDS.map((field, i) => [field, record[CSV_FIELDS[i]]]));
}


export async function importGlobalMaster(client, records, { expectedCount = null, migration = null } = {}) {
  validateRecords(records, expectedCount);
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    if (migration) await client.query(migration);
    await client.query('LOCK TABLE public.ean_product_master IN SHARE ROW EXCLUSIVE MODE');
    const before = Number((await client.query('SELECT count(*) AS total FROM public.ean_product_master')).rows[0].total);
    const existing = (await client.query('SELECT ean, product_name, brand, unit_description, category, image_url, source FROM public.ean_product_master WHERE lpad(ean, 14, $1) = ANY($2::text[])', ['0', records.map((r) => r.ean.padStart(14, '0'))])).rows;
    const byGtin = new Map(existing.map((r) => [r.ean.padStart(14, '0'), r]));
    const conflicts = [];
    for (const r of records) {
      const old = byGtin.get(r.ean.padStart(14, '0'));
      if (!old) continue;
      const mapped = mapRecord(r);
      const fields = DB_FIELDS.filter((k) => (old[k] ?? '') !== mapped[k]);
      if (fields.length) conflicts.push({ ean: r.ean, existingEan: old.ean, fields });
    }
    if (conflicts.length) {
      const error = new Error('Existing EAN conflicts: no records changed');
      error.conflicts = conflicts;
      throw error;
    }
    let inserted = 0;
    for (const r of records) {
      if (byGtin.has(r.ean.padStart(14, '0'))) continue;
      const result = await client.query('INSERT INTO public.ean_product_master (ean, product_name, brand, unit_description, category, image_url, source) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (ean) DO NOTHING RETURNING ean', Object.values(mapRecord(r)));
      if (result.rows.length !== 1) throw new Error('Concurrent EAN conflict; import rolled back');
      inserted++;
    }
    const verified = (await client.query('SELECT ean, product_name, brand, unit_description, category, image_url, source FROM public.ean_product_master WHERE ean = ANY($1::text[])', [records.map((r) => r.ean)])).rows;
    const byEan = new Map(verified.map((r) => [r.ean, r]));
    for (const r of records) {
      const saved = byEan.get(r.ean); const mapped = mapRecord(r);
      if (!saved || DB_FIELDS.some((k) => (saved[k] ?? '') !== mapped[k])) throw new Error('Database round-trip verification failed');
    }
    const finalCount = Number((await client.query('SELECT count(*) AS total FROM public.ean_product_master')).rows[0].total);
    if (finalCount !== before + inserted || verified.length !== records.length) throw new Error('Database count verification failed');
    await client.query('COMMIT');
    return { input: records.length, inserted, skippedExisting: records.length - inserted, conflicts: [], failures: 0, duplicates: 0, invalidEans: 0, finalCount, verified: verified.length, leadingZerosPreserved: records.filter((r) => r.ean.startsWith('0')).length, samples: records.slice(0, 20).map((r) => byEan.get(r.ean)) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
