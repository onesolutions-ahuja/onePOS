export const IMPORT_CSV_FIELDS = [
  "product_id",
  "sku",
  "ean",
  "name",
  "description",
  "category",
  "vat_rate",
  "unit",
  "cost_price",
  "price",
  "active",
  "store_id",
  "store_code",
  "store_enabled",
  "store_price",
  "reorder_level",
  "minimum_stock",
];

export function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result.map((v) => v.trim());
}

export function parseCsv(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length < 1) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] !== undefined ? values[idx] : "";
    });
    rows.push({ row, lineNumber: i + 1 });
  }
  return rows;
}

function isValidVatRate(value) {
  if (value === "" || value === null || value === undefined) return true;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 && num <= 100;
}

function isValidNumber(value) {
  if (value === "" || value === null || value === undefined) return true;
  return Number.isFinite(Number(value));
}

function isValidBoolean(value) {
  if (value === "" || value === null || value === undefined) return true;
  const lower = String(value).toLowerCase();
  return ["true", "false", "1", "0", "yes", "no", "y", "n"].includes(lower);
}

function parseBoolean(value) {
  if (value === "" || value === null || value === undefined) return null;
  const lower = String(value).toLowerCase();
  if (["true", "1", "yes", "y"].includes(lower)) return true;
  if (["false", "0", "no", "n"].includes(lower)) return false;
  return null;
}

export async function validateCsvImport(db, companyId, rows) {
  const errors = [];

  const skuCount = new Map();
  const eanCount = new Map();

  for (const { row, lineNumber } of rows) {
    const rowErrs = [];

    const name = (row.name || "").trim();
    if (!name) {
      rowErrs.push({ field: "name", message: "Product name is required" });
    }

    const sku = (row.sku || "").trim();
    if (sku && sku.length > 100) {
      rowErrs.push({ field: "sku", message: "SKU exceeds maximum length" });
    }

    const ean = (row.ean || "").trim();
    if (ean && !/^[0-9]{8,14}$/.test(ean)) {
      rowErrs.push({ field: "ean", message: "EAN/barcode must be 8-14 digits" });
    }

    if (!isValidVatRate(row.vat_rate)) {
      rowErrs.push({ field: "vat_rate", message: "Invalid VAT/tax rate (must be 0-100)" });
    }

    if (!isValidNumber(row.cost_price)) {
      rowErrs.push({ field: "cost_price", message: "Invalid cost price" });
    }
    if (!isValidNumber(row.price)) {
      rowErrs.push({ field: "price", message: "Invalid price" });
    }

    if (!isValidBoolean(row.active)) {
      rowErrs.push({ field: "active", message: "Invalid boolean value for active" });
    }

    if (row.store_enabled && !isValidBoolean(row.store_enabled)) {
      rowErrs.push({ field: "store_enabled", message: "Invalid boolean value for store_enabled" });
    }

    if (row.minimum_stock && !isValidNumber(row.minimum_stock)) {
      rowErrs.push({ field: "minimum_stock", message: "Invalid minimum stock value" });
    }

    if (row.reorder_level && !isValidNumber(row.reorder_level)) {
      rowErrs.push({ field: "reorder_level", message: "Invalid reorder level value" });
    }

    if (row.product_id) {
      const pid = String(row.product_id).trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid)) {
        rowErrs.push({ field: "product_id", message: "Invalid product ID format" });
      }
    }

    if (row.category && row.category.trim()) {
      const catCheck = await db(
        "SELECT id FROM categories WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND active = true",
        [companyId, row.category.trim()]
      );
      if (!catCheck.rows.length) {
        rowErrs.push({ field: "category", message: `Unknown category: ${row.category}` });
      }
    }

    skuCount.set(sku.toLowerCase(), (skuCount.get(sku.toLowerCase()) || 0) + 1);
    eanCount.set(ean.toLowerCase(), (eanCount.get(ean.toLowerCase()) || 0) + 1);

    if (rowErrs.length) {
      errors.push({ lineNumber, sku: sku || ean || "(unknown)", errors: rowErrs });
    }
  }

  for (const { row, lineNumber } of rows) {
    const sku = (row.sku || "").trim();
    const ean = (row.ean || "").trim();

    if (sku && skuCount.get(sku.toLowerCase()) > 1) {
      const firstLine = rows.find((r) => r.row.sku?.trim().toLowerCase() === sku.toLowerCase())?.lineNumber;
      if (firstLine !== lineNumber) {
        errors.push({
          lineNumber,
          sku: sku || ean || "(unknown)",
          errors: [{ field: "sku", message: `Duplicate SKU (first seen on row ${firstLine})` }],
        });
      }
    }

    if (ean && eanCount.get(ean.toLowerCase()) > 1) {
      const firstLine = rows.find((r) => r.row.ean?.trim().toLowerCase() === ean.toLowerCase())?.lineNumber;
      if (firstLine !== lineNumber) {
        errors.push({
          lineNumber,
          sku: sku || ean || "(unknown)",
          errors: [{ field: "ean", message: `Duplicate EAN (first seen on row ${firstLine})` }],
        });
      }
    }
  }

  for (const { row, lineNumber } of rows) {
    const sku = (row.sku || "").trim();
    const ean = (row.ean || "").trim();
    const productId = (row.product_id || "").trim();

    if (productId) {
      const productCheck = await db(
        "SELECT id FROM products WHERE id = $1 AND company_id = $2",
        [productId, companyId]
      );
      if (!productCheck.rows.length) {
        errors.push({
          lineNumber,
          sku: sku || ean || "(unknown)",
          errors: [{ field: "product_id", message: `Product ID not found: ${productId}` }],
        });
      }
    }

    if (sku) {
      const existing = await db(
        "SELECT id, name, barcode FROM products WHERE company_id = $1 AND LOWER(sku) = LOWER($2)",
        [companyId, sku]
      );
      if (existing.rows.length) {
        const existingProduct = existing.rows[0];
        const rowProductId = (row.product_id || "").trim();
        if (rowProductId && String(existingProduct.id).toLowerCase() !== rowProductId.toLowerCase()) {
          errors.push({
            lineNumber,
            sku,
            errors: [{ field: "sku", message: `SKU ${sku} already belongs to a different product (ID: ${existingProduct.id})` }],
          });
        }
      }
    }

    if (ean) {
      const existing = await db(
        "SELECT id, name, sku FROM products WHERE company_id = $1 AND LOWER(barcode) = LOWER($2)",
        [companyId, ean]
      );
      if (existing.rows.length) {
        const existingProduct = existing.rows[0];
        const rowProductId = (row.product_id || "").trim();
        if (rowProductId && String(existingProduct.id).toLowerCase() !== rowProductId.toLowerCase()) {
          errors.push({
            lineNumber,
            sku: sku || ean,
            errors: [{ field: "ean", message: `EAN ${ean} already belongs to a different product (ID: ${existingProduct.id})` }],
          });
        }
      }
    }
  }

  return errors;
}

export async function previewCsvImport(db, pool, companyId, rows) {
  const preview = {
    newProducts: [],
    updatedProducts: [],
    newStoreMappings: [],
    storeChanges: [],
    validationErrors: [],
    summary: { new: 0, update: 0, storeMappings: 0 },
  };

  const allProducts = await db(
    "SELECT id, company_id, name, sku, barcode, description, price, cost_price, vat_rate, active, category_id FROM products WHERE company_id = $1",
    [companyId]
  );
  const skuToProduct = new Map();
  const eanToProduct = new Map();
  const productIdToProduct = new Map();
  for (const p of allProducts.rows) {
    if (p.sku) skuToProduct.set(p.sku.toLowerCase(), p);
    if (p.barcode) eanToProduct.set(p.barcode.toLowerCase(), p);
    productIdToProduct.set(String(p.id).toLowerCase(), p);
  }

  const allStores = await db(
    "SELECT id, code, name, active FROM stores WHERE company_id = $1",
    [companyId]
  );
  const storeByCode = new Map();
  for (const s of allStores.rows) {
    storeByCode.set(s.code.toLowerCase(), s);
  }

  for (const { row, lineNumber } of rows) {
    const productIdRaw = (row.product_id || "").trim();
    const sku = (row.sku || "").trim();
    const ean = (row.ean || "").trim();
    const name = (row.name || "").trim();
    const description = (row.description || "").trim() || null;
    const categoryName = (row.category || "").trim();
    const vatRate = row.vat_rate !== "" ? Number(row.vat_rate) : null;
    const costPrice = row.cost_price !== "" ? Number(row.cost_price) : null;
    const price = row.price !== "" ? Number(row.price) : null;
    const active = parseBoolean(row.active);

    const storeCode = (row.store_code || "").trim();
    const storeEnabled = parseBoolean(row.store_enabled);
    const storePrice = row.store_price !== "" ? Number(row.store_price) : null;
    const reorderLevel = row.reorder_level !== "" ? Number(row.reorder_level) : null;
    const minimumStock = row.minimum_stock !== "" ? Number(row.minimum_stock) : null;

    let existingProduct = null;
    let identificationMethod = null;

    if (productIdRaw) {
      existingProduct = productIdToProduct.get(productIdRaw.toLowerCase()) || null;
      if (existingProduct) identificationMethod = "product_id";
    }
    if (!existingProduct && sku) {
      existingProduct = skuToProduct.get(sku.toLowerCase()) || null;
      if (existingProduct) identificationMethod = "sku";
    }
    if (!existingProduct && ean) {
      existingProduct = eanToProduct.get(ean.toLowerCase()) || null;
      if (existingProduct) identificationMethod = "ean";
    }

    const store = storeCode ? storeByCode.get(storeCode.toLowerCase()) || null : null;

    if (existingProduct) {
      const changes = [];
      if (name && existingProduct.name !== name) changes.push({ field: "name", from: existingProduct.name, to: name });
      if (description !== null && existingProduct.description !== description) changes.push({ field: "description" });
      if (vatRate !== null && existingProduct.vat_rate !== vatRate) changes.push({ field: "vat_rate" });
      if (costPrice !== null && existingProduct.cost_price !== costPrice) changes.push({ field: "cost_price" });
      if (price !== null && existingProduct.price !== price) changes.push({ field: "price" });
      if (active !== null && existingProduct.active !== active) changes.push({ field: "active" });

      if (categoryName) {
        const catCheck = await db(
          "SELECT id FROM categories WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND active = true",
          [companyId, categoryName]
        );
        if (catCheck.rows.length && existingProduct.category_id !== catCheck.rows[0].id) {
          changes.push({ field: "category_id" });
        }
      }

      if (changes.length) {
        preview.updatedProducts.push({ lineNumber, productId: existingProduct.id, productName: existingProduct.name, identificationMethod, changes });
        preview.summary.update++;
      }

      if (store) {
        preview.storeChanges.push({
          lineNumber,
          productId: existingProduct.id,
          productName: existingProduct.name,
          storeId: store.id,
          storeCode: store.code,
          identificationMethod,
          storeEnabled,
          storePrice,
          reorderLevel,
          minimumStock,
        });
        preview.summary.storeMappings++;
      }
    } else {
      preview.newProducts.push({
        lineNumber,
        name,
        sku: sku || null,
        barcode: ean || null,
        description,
        identificationMethod: "new",
      });
      preview.summary.new++;

      if (store) {
        preview.newStoreMappings.push({
          lineNumber,
          storeId: store.id,
          storeCode: store.code,
          productName: name,
          storeEnabled,
          storePrice,
          reorderLevel,
          minimumStock,
        });
      }
    }
  }

  return preview;
}

export async function executeCsvImport(db, pool, companyId, userId, rows, { savePlatformRecord = null, req = null } = {}) {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const result = {
      created: [],
      updated: [],
      storeMappings: [],
      errors: [],
    };

    const skuToProduct = new Map();
    const eanToProduct = new Map();

    const existingProducts = await client.query(
      "SELECT id, company_id, name, sku, barcode, description, price, cost_price, vat_rate, active FROM products WHERE company_id = $1",
      [companyId]
    );
    for (const p of existingProducts.rows) {
      if (p.sku) skuToProduct.set(p.sku.toLowerCase(), p);
      if (p.barcode) eanToProduct.set(p.barcode.toLowerCase(), p);
    }

    const allStores = await client.query(
      "SELECT id, code, name, active FROM stores WHERE company_id = $1",
      [companyId]
    );
    const storeByCode = new Map();
    const storeById = new Map();
    for (const s of allStores.rows) {
      storeByCode.set(s.code.toLowerCase(), s);
      storeById.set(String(s.id).toLowerCase(), s);
    }

    for (const { row, lineNumber } of rows) {
      const productIdRaw = (row.product_id || "").trim();
      const sku = (row.sku || "").trim();
      const ean = (row.ean || "").trim();
      const name = (row.name || "").trim();
      const description = (row.description || "").trim() || null;
      const categoryName = (row.category || "").trim();
      const vatRate = row.vat_rate !== "" ? Number(row.vat_rate) : null;
      const costPrice = row.cost_price !== "" ? Number(row.cost_price) : null;
      const price = row.price !== "" ? Number(row.price) : null;
      const active = parseBoolean(row.active);

      const storeCode = (row.store_code || "").trim();
      const storeEnabled = parseBoolean(row.store_enabled);
      const storePrice = row.store_price !== "" ? Number(row.store_price) : null;
      const reorderLevel = row.reorder_level !== "" ? Number(row.reorder_level) : null;
      const minimumStock = row.minimum_stock !== "" ? Number(row.minimum_stock) : null;

      if (!name) {
        result.errors.push({ lineNumber, message: "Product name is required", sku: sku || ean || "(unknown)" });
        continue;
      }

      let existingProduct = null;
      let identificationMethod = null;

      if (productIdRaw) {
        const pidCheck = await client.query(
          "SELECT id FROM products WHERE id = $1 AND company_id = $2",
          [productIdRaw, companyId]
        );
        if (pidCheck.rows.length) {
          existingProduct = pidCheck.rows[0];
          identificationMethod = "product_id";
        }
      }
      if (!existingProduct && sku) {
        const skuCheck = await client.query(
          "SELECT id FROM products WHERE company_id = $1 AND LOWER(sku) = LOWER($2)",
          [companyId, sku]
        );
        if (skuCheck.rows.length) {
          existingProduct = skuCheck.rows[0];
          identificationMethod = "sku";
        }
      }
      if (!existingProduct && ean) {
        const eanCheck = await client.query(
          "SELECT id FROM products WHERE company_id = $1 AND LOWER(barcode) = LOWER($2)",
          [companyId, ean]
        );
        if (eanCheck.rows.length) {
          existingProduct = eanCheck.rows[0];
          identificationMethod = "ean";
        }
      }

      let productId;
      const previous = savePlatformRecord && existingProduct
        ? (await client.query("SELECT * FROM products WHERE id=$1 AND company_id=$2 FOR UPDATE", [existingProduct.id, companyId])).rows[0]
        : null;

      if (existingProduct) {
        productId = existingProduct.id;

        const updateSets = [];
        const updateParams = [];
        let paramCount = 0;

        if (name) { updateSets.push(`name = $${paramCount + 1}`); updateParams.push(name); paramCount++; }
        if (description !== null) { updateSets.push(`description = $${paramCount + 1}`); updateParams.push(description); paramCount++; }
        if (price !== null) { updateSets.push(`price = $${paramCount + 1}`); updateParams.push(price); paramCount++; }
        if (costPrice !== null) { updateSets.push(`cost_price = $${paramCount + 1}`); updateParams.push(costPrice); paramCount++; }
        if (vatRate !== null) { updateSets.push(`vat_rate = $${paramCount + 1}`); updateParams.push(vatRate); paramCount++; }
        if (active !== null) { updateSets.push(`active = $${paramCount + 1}`); updateParams.push(active); paramCount++; }

        if (categoryName) {
          const catResult = await client.query(
            "SELECT id FROM categories WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND active = true",
            [companyId, categoryName]
          );
          if (catResult.rows.length) {
            updateSets.push(`category_id = $${paramCount + 1}`);
            updateParams.push(catResult.rows[0].id);
            paramCount++;
          }
        }

        if (updateSets.length) {
          paramCount++;
          updateParams.push(productId);
          paramCount++;
          updateParams.push(companyId);
          await client.query(
            `UPDATE products SET ${updateSets.join(", ")}, updated_at = NOW() WHERE id = $${paramCount - 1} AND company_id = $${paramCount}`,
            updateParams
          );
          result.updated.push({ lineNumber, productId, name, identificationMethod });
        }
      } else {
        const catResult = categoryName
          ? await client.query("SELECT id FROM categories WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND active = true", [companyId, categoryName])
          : { rows: [] };

        const insertResult = await client.query(
          `INSERT INTO products (company_id, category_id, name, sku, barcode, description, price, cost_price, vat_rate, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            companyId,
            catResult.rows.length ? catResult.rows[0].id : null,
            name,
            sku || null,
            ean || null,
            description,
            price !== null ? price : 0,
            costPrice !== null ? costPrice : 0,
            vatRate !== null ? vatRate : 20,
            active !== null ? active : true,
          ]
        );
        productId = insertResult.rows[0].id;
        result.created.push({ lineNumber, productId, name, sku: sku || null, barcode: ean || null, identificationMethod: "new" });
        if (sku) skuToProduct.set(sku.toLowerCase(), { id: productId });
        if (ean) eanToProduct.set(ean.toLowerCase(), { id: productId });
      }

      if (savePlatformRecord) {
        const saved = (await client.query("SELECT * FROM products WHERE id=$1 AND company_id=$2", [productId, companyId])).rows[0];
        const customFields = Object.fromEntries(Object.entries(row).filter(([header]) => header.startsWith("platform.")).map(([header,value]) => [header.slice(9),value]));
        await savePlatformRecord({ db: client.query.bind(client), key: "product", req: { ...req, body: { platform: { customFields } } }, record: saved, previous });
      }
      const targetStoreId = storeCode ? storeByCode.get(storeCode.toLowerCase())?.id || null : null;

      if (targetStoreId) {
        const storeCheck = await client.query(
          "SELECT id FROM stores WHERE id = $1 AND company_id = $2",
          [targetStoreId, companyId]
        );
        if (storeCheck.rows.length) {
          await client.query(
            `INSERT INTO product_store_stock (company_id, store_id, product_id, quantity, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (company_id, store_id, product_id)
             DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`,
            [companyId, targetStoreId, productId, minimumStock !== null ? minimumStock : 0]
          );
          result.storeMappings.push({ lineNumber, productId, storeId: targetStoreId, sku: sku || ean || null });

          if (storeEnabled !== null) {
            await client.query("UPDATE stores SET active = $1 WHERE id = $2 AND company_id = $3", [storeEnabled, targetStoreId, companyId]);
          }
        }
      }
    }

    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    if (typeof client.release === "function") {
      client.release();
    }
  }
}

export async function exportProductsCsv(db, companyId, storeIdFilter) {
  const queryFn = typeof db === "function" ? db : db?.query?.bind(db) || (async (sql, params) => ({ rows: [] }));
  let storeFilter = "";
  let params = [companyId];

  if (storeIdFilter) {
    params.push(storeIdFilter);
    storeFilter = `AND pss.store_id = $${params.length}`;
  }

  const result = await queryFn(
    `
    SELECT
      p.id AS product_id,
      p.sku,
      p.barcode AS ean,
      p.name,
      p.description,
      COALESCE(c.name, '') AS category,
      p.vat_rate,
      p.cost_price,
      p.price,
      p.active,
      s.id AS store_id,
      s.code AS store_code,
      s.active AS store_enabled,
      p.price AS store_price,
      p.low_stock_level AS reorder_level,
      pss.quantity AS minimum_stock
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
    LEFT JOIN product_store_stock pss ON pss.product_id = p.id AND pss.company_id = p.company_id
    LEFT JOIN stores s ON s.id = pss.store_id AND s.company_id = p.company_id
    WHERE p.company_id = $1
      AND p.active = true
      ${storeFilter}
    ORDER BY p.name, s.name
    `,
    params
  );

  return result.rows || [];
}
