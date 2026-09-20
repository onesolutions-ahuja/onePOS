import express from "express";

export default function createProductsRouter({ authenticate, authorize, db, pool, createInventoryMovement, writeAudit }) {
  const router = express.Router();

  /*
   * GET /api/categories
   *
   * Returns active categories when no query parameter is given (used by POS product selector).
   * When ?all=true is passed, returns all categories (including inactive) with product counts
   * (used by the admin Categories management page).
   */
  router.get("/categories", authenticate, authorize("category.view"), async (req, res) => {
    try {
      const includeAll = req.query.all === "true";

      const result = await db(
        `
        SELECT
          c.id,
          c.name,
          c.display_order,
          c.active,
          COUNT(p.id) AS product_count
        FROM categories c
        LEFT JOIN products p
          ON p.category_id = c.id
          AND p.company_id = c.company_id
          AND p.active = true
        WHERE c.company_id = $1
        ${includeAll ? "" : "  AND c.active = true"}
        GROUP BY c.id
        ORDER BY ${includeAll ? "c.active DESC, c.display_order, c.name" : "c.display_order, c.name"}
        `,
        [req.user.companyId]
      );

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      console.error("Categories error:", error);

      res.status(500).json({
        success: false,
        message: "Unable to load categories",
      });
    }
  });

  /*
   * POST /api/products/misc-line
   *
   * Till "Misc Item" support. sale_items.product_id is NOT NULL, so a
   * manual-price line needs a catalogue row to reference. This endpoint
   * find-or-creates the company's ONE invisible MISC placeholder product
   * (sku='MISC', inactive — it never appears in the till grid, global
   * search or product lists, and its stock is never touched: misc lines
   * carry item_type='MISC' and the sale engine skips stock movement for
   * them). The cashier's typed description is stored per-line on
   * sale_items.product_name, so no product is created per transaction.
   *
   * Permission: sale.create (the same gate as completing the sale itself).
   */
  router.post("/products/misc-line", authenticate, authorize("sale.create"), async (req, res) => {
    try {
      const inserted = await db(
        `
        INSERT INTO products (
          company_id,
          name,
          sku,
          price,
          cost_price,
          vat_rate,
          vat_applicable,
          track_stock,
          stock_quantity,
          active
        )
        VALUES ($1, 'Misc Item', 'MISC', 0, 0, 20, false, false, 0, false)
        ON CONFLICT (company_id) WHERE sku = 'MISC' AND active = false
        DO UPDATE SET updated_at = NOW()
        RETURNING id
        `,
        [req.user.companyId]
      );

      res.status(201).json({
        success: true,
        data: { productId: inserted.rows[0].id },
      });
    } catch (error) {
      console.error("Misc placeholder product error:", error);

      res.status(500).json({
        success: false,
        message: "Unable to prepare misc item",
      });
    }
  });

  /*
   * GET /api/products/most-selling
   *
   * Till "Most Selling" pseudo-category. Ranks products by how FREQUENTLY
   * they appear in sales — COUNT(DISTINCT si.sale_id) — not by total
   * quantity: a product sold 100 units in 1 transaction must rank BELOW a
   * product appearing in 50 separate transactions.
   *
   * Scope: the authenticated company; store-scoped when the caller has a
   * store context (matching the till). Only active products are returned.
   *
   * Time range: ?days=N (default 30, capped at 365). There is no existing
   * best-seller period convention in the app (reports take explicit date
   * ranges), so 30 days is the documented default — a bounded window keeps
   * the aggregate cheap on every till load.
   *
   * Deterministic ordering: frequency DESC, then latest sale recency DESC,
   * then product name ASC (stable tie-breaker).
   */
  router.get("/products/most-selling", authenticate, authorize("product.view"), async (req, res) => {
    try {
      const daysRaw = Number(req.query.days);
      const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.floor(daysRaw), 365) : 30;
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;

      const result = await db(
        `
        SELECT
          p.id,
          p.name,
          p.sku,
          p.barcode,
          p.image_url,
          p.price,
          p.category_id,
          c.name AS category_name,
          COUNT(DISTINCT si.sale_id)::int AS sale_frequency,
          MAX(s.created_at) AS last_sold_at
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
          AND s.company_id = $1
          AND s.status = 'completed'
          ${req.user.storeId ? "AND s.store_id = $2" : ""}
          AND s.created_at >= NOW() - ($${req.user.storeId ? "3" : "2"}::text || ' days')::interval
        INNER JOIN products p ON p.id = si.product_id
          AND p.company_id = $1
          AND p.active = true
          AND p.sku IS DISTINCT FROM 'MISC' /* Misc Item lines are not a product ranking. IS DISTINCT FROM is NULL-safe: a plain "sku <> 'MISC'" comparison evaluates to NULL for SKU-less rows and silently drops them from the ranking. */
        LEFT JOIN categories c ON c.id = p.category_id
        GROUP BY p.id, c.name
        ORDER BY
          sale_frequency DESC,
          last_sold_at DESC NULLS LAST,
          p.name ASC
        LIMIT $${req.user.storeId ? "4" : "3"}
        `,
        req.user.storeId
          ? [req.user.companyId, req.user.storeId, String(days), limit]
          : [req.user.companyId, String(days), limit]
      );

      res.json({ success: true, data: result.rows, days });
    } catch (error) {
      console.error("Most-selling error:", error);
      res.status(500).json({ success: false, message: "Unable to load most-selling products" });
    }
  });

  /*
   * POST /api/categories
   */
  router.post("/categories", authenticate, authorize("category.create"), async (req, res) => {
    try {
      const { name, displayOrder = 0 } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Category name is required",
        });
      }

      const result = await db(
        `
        INSERT INTO categories (
          company_id,
          name,
          display_order
        )
        VALUES ($1, $2, $3)
        RETURNING
          id,
          name,
          display_order,
          active
        `,
        [
          req.user.companyId,
          name.trim(),
          Number(displayOrder) || 0,
        ]
      );

       res.status(201).json({
         success: true,
         data: result.rows[0],
       });
     } catch (error) {
       console.error("Create category error:", error);

       res.status(500).json({
         success: false,
         message: "Unable to create category",
       });
     }
   });

   /*
    * PUT /api/categories/:id
    * Updates category name, display_order, and active status.
    */
   router.put("/categories/:id", authenticate, authorize("category.edit"), async (req, res) => {
     try {
       const { name, displayOrder = 0, active = true } = req.body;

       if (!name || !name.trim()) {
         return res.status(400).json({
           success: false,
           message: "Category name is required",
         });
       }

       const result = await db(
         `
         UPDATE categories
         SET
           name = $1,
           display_order = $2,
           active = $3
         WHERE id = $4
           AND company_id = $5
         RETURNING
           id,
           name,
           display_order,
           active
         `,
         [
           name.trim(),
           Number(displayOrder) || 0,
           Boolean(active),
           req.params.id,
           req.user.companyId
         ]
       );

       if (!result.rows.length) {
         return res.status(404).json({
           success: false,
           message: "Category not found",
         });
       }

       res.json({
         success: true,
         message: "Category updated",
         data: result.rows[0],
       });
     } catch (error) {
       console.error("Update category error:", error);

       res.status(500).json({
         success: false,
         message: "Unable to update category",
       });
     }
   });

   /*
    * DELETE /api/categories/:id
    * Soft delete — sets active = false so existing products are not broken.
    */
   router.delete("/categories/:id", authenticate, authorize("category.delete"), async (req, res) => {
     try {
       const result = await db(
         `
         UPDATE categories
         SET
           active = false
         WHERE id = $1
           AND company_id = $2
         RETURNING id
         `,
         [req.params.id, req.user.companyId]
       );

       if (!result.rows.length) {
         return res.status(404).json({
           success: false,
           message: "Category not found",
         });
       }

       res.json({
         success: true,
         message: "Category deactivated",
       });
     } catch (error) {
       console.error("Delete category error:", error);

       res.status(500).json({
         success: false,
         message: "Unable to deactivate category",
       });
     }
   });

  /*
   * GET /api/products
   */
  router.get("/products", authenticate, authorize("product.view"), async (req, res) => {
    try {
      const result = await db(
        `
        SELECT
          p.id,
          p.name,
          p.sku,
          p.barcode,
          p.description,
          p.price,
          p.cost_price,
          p.vat_rate,
          p.vat_applicable,
          p.age_restricted,
          p.image_url,
          p.stock_quantity,
          p.low_stock_level,
          p.track_stock,
          p.available_on_uber,
          p.available_on_deliveroo,
          p.uber_item_id,
          p.deliveroo_item_id,
          p.category_id,
          p.active,
          c.name AS category_name,
          p.created_at,
          p.updated_at
        FROM products p
        LEFT JOIN categories c
          ON c.id = p.category_id
        WHERE p.company_id = $1
          AND p.active = true
          /* Exclude only the MISC placeholder. The legacy "sku <> 'MISC'" form is NOT NULL-safe:
           * for a row with sku IS NULL (e.g. every product added from the
           * Global Product Master, which has no SKU) the comparison yields
           * NULL and the row silently disappears from the Products page and
           * the till grid even though the create returned 201. */
          AND p.sku IS DISTINCT FROM 'MISC'
        ORDER BY p.name
        `,
        [req.user.companyId]
      );

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      console.error("Load products error:", error);

      res.status(500).json({
        success: false,
        message: "Unable to load products",
      });
    }
  });

  /*
   * GET /api/products/:id
   */
  router.get("/products/:id", authenticate, authorize("product.view"), async (req, res) => {
    try {
      const result = await db(
        `
        SELECT
          p.id,
          p.name,
          p.sku,
          p.barcode,
          p.description,
          p.price,
          p.cost_price,
          p.vat_rate,
          p.image_url,
          p.stock_quantity,
          p.low_stock_level,
          p.track_stock,
          p.category_id,
          p.active,
          c.name AS category_name
        FROM products p
        LEFT JOIN categories c
          ON c.id = p.category_id
        WHERE p.id = $1
          AND p.company_id = $2
        `,
        [req.params.id, req.user.companyId]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      console.error("Get product error:", error);

      res.status(500).json({
        success: false,
        message: "Unable to load product",
      });
    }
  });

  /*
   * POST /api/products
   */
  router.post("/products", authenticate, authorize("product.create"), async (req, res) => {
    if (!pool) {
      return res.status(500).json({
        success: false,
        message: "DATABASE_URL is not configured",
      });
    }

    const client = await pool.connect();
    let transactionStarted = false;

    try {
      const {
        name,
        sku = null,
        barcode = null,
        description = null,
        price = 0,
        costPrice = 0,
        vatRate = 20,
        vatApplicable = true,
        ageRestricted = false,
        stockQuantity = undefined,
        openingStock = undefined,
        lowStockLevel = 0,
        trackStock = true,
        categoryId = null,
        availableOnUber = false,
        availableOnDeliveroo = false,
        uberItemId = null,
        deliverooItemId = null,
        imageUrl = null,
      } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Product name is required",
        });
      }

      if (sku) {
        const duplicateSku = await client.query(
          `
          SELECT id
          FROM products
          WHERE company_id = $1
            AND LOWER(sku) = LOWER($2)
            AND active = true
          LIMIT 1
          `,
          [req.user.companyId, sku.trim()]
        );

        if (duplicateSku.rows.length) {
          return res.status(409).json({
            success: false,
            message: "A product with this SKU already exists",
          });
        }
      }

      if (barcode) {
        const duplicateBarcode = await client.query(
          `
          SELECT id
          FROM products
          WHERE company_id = $1
            AND barcode = $2
            AND active = true
          LIMIT 1
          `,
          [req.user.companyId, barcode.trim()]
        );

        if (duplicateBarcode.rows.length) {
          return res.status(409).json({
            success: false,
            message: "A product with this barcode already exists",
          });
        }
      }

      await client.query("BEGIN");
      transactionStarted = true;

      const result = await client.query(
        `
        INSERT INTO products (
          company_id,
          category_id,
          name,
          sku,
          barcode,
          description,
          price,
          cost_price,
          vat_rate,
          vat_applicable,
          stock_quantity,
          low_stock_level,
          track_stock,
          active,
          available_on_uber,
          available_on_deliveroo,
          uber_item_id,
          deliveroo_item_id,
          age_restricted,
          image_url
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,true,$13,$14,$15,$16,$17,$18
        )
        RETURNING
          id,
          name,
          sku,
          barcode,
          description,
          price,
          cost_price,
          vat_rate,
          vat_applicable,
          age_restricted,
          image_url,
          stock_quantity,
          low_stock_level,
          track_stock,
          available_on_uber,
          available_on_deliveroo,
          uber_item_id,
          deliveroo_item_id,
          category_id,
          active,
          created_at,
          updated_at
        `,
        [
          req.user.companyId,
          categoryId || null,
          name.trim(),
          sku ? sku.trim() : null,
          barcode ? barcode.trim() : null,
          description || null,
          Number(price) || 0,
          Number(costPrice) || 0,
          Number(vatRate) || 0,
          vatApplicable !== false,
          Number(lowStockLevel) || 0,
          Boolean(trackStock),
          Boolean(availableOnUber),
          Boolean(availableOnDeliveroo),
          uberItemId || null,
          deliverooItemId || null,
          /* T10C: age_restricted is the LAST insert column/param so the
           * pre-existing parameter layout (positions 1-16) is unchanged. */
          Boolean(ageRestricted),
          /* Product image (data URL or remote URL); null = no image. */
          typeof imageUrl === "string" && imageUrl.trim() ? imageUrl.trim().slice(0, 500_000) : null,
        ]
      );

      /*
       * Opening stock (store-specific, create-only).
       *
       * The products.stock_quantity column is the store's running balance for
       * this product (all movements are written against the operator's
       * store). The OPENING movement type exists in the inventory ledger, so
       * the initial quantity is established through the EXISTING mechanism:
       * traceable (inventory_movements row, reason "Opening stock"), never
       * duplicated, and never touched again by product edits. A zero opening
       * quantity still writes an explicit OPENING row so the starting balance
       * is on the audit trail; track_stock=OFF products skip it entirely —
       * no opening stock is created or used.
       */
      const openingStockQty = Number(stockQuantity ?? openingStock) || 0;

      if (trackStock && openingStockQty >= 0) {
        const movement = await createInventoryMovement(client, {
          companyId: req.user.companyId,
          productId: result.rows[0].id,
          storeId: req.user.storeId,
          movementType: "OPENING",
          quantityChange: openingStockQty,
          reason: "Opening stock",
          createdBy: req.user.id,
        });

        result.rows[0].stock_quantity = movement.balance;
      }

      await client.query("COMMIT");

      // Audit log for product creation (best-effort; never fails the create)
      if (typeof writeAudit === "function") {
        writeAudit(
          req.user.companyId,
          req.user.id,
          "product.created",
          "product",
          result.rows[0].id,
          {
            name: result.rows[0].name,
            sku: result.rows[0].sku,
            barcode: result.rows[0].barcode,
            categoryId: result.rows[0].category_id,
            price: result.rows[0].price,
            vatRate: result.rows[0].vat_rate,
            ageRestricted: result.rows[0].age_restricted,
            active: result.rows[0].active,
          }
        );
      }

      res.status(201).json({
        success: true,
        message: "Product created",
        data: result.rows[0],
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("Create product error:", error);

      res.status(500).json({
        success: false,
        message: "Unable to create product",
        error: error.message,
      });
    } finally {
      client.release();
    }
  });

  /*
   * PUT /api/products/:id
   */
  router.put("/products/:id", authenticate, authorize("product.edit"), async (req, res) => {
    try {
      const {
        name,
        sku = null,
        barcode = null,
        description = null,
        price = 0,
        costPrice = 0,
        vatRate = 20,
        vatApplicable, // undefined = keep current (edits never flip VAT silently)
        ageRestricted, // undefined = keep current (edits never flip age restriction silently)
        lowStockLevel = 0,
        trackStock = true,
        categoryId = null,
        availableOnUber = false,
        availableOnDeliveroo = false,
        uberItemId = null,
        deliverooItemId = null,
        imageUrl,
      } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Product name is required",
        });
      }

      const existing = await db(
        `
        SELECT id
        FROM products
        WHERE id = $1
          AND company_id = $2
        `,
        [req.params.id, req.user.companyId]
      );

      if (!existing.rows.length) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      // Get current product values for audit trail
      const currentProduct = await db(
        `
        SELECT
          name, sku, barcode, category_id, price, vat_rate, age_restricted, active
        FROM products
        WHERE id = $1 AND company_id = $2
        `,
        [req.params.id, req.user.companyId]
      );

      const previousValues = currentProduct.rows[0] || null;

      /* The product must exist in THIS company to be editable; a foreign or
       * unknown id is a clean 404, never a crash or a cross-tenant update. */
      if (!previousValues) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      if (sku) {
        const duplicateSku = await db(
          `
          SELECT id
          FROM products
          WHERE company_id = $1
            AND LOWER(sku) = LOWER($2)
            AND id <> $3
            AND active = true
          LIMIT 1
          `,
          [
            req.user.companyId,
            sku.trim(),
            req.params.id,
          ]
        );

        if (duplicateSku.rows.length) {
          return res.status(409).json({
            success: false,
            message: "A product with this SKU already exists",
          });
        }
      }

      if (barcode) {
        const duplicateBarcode = await db(
          `
          SELECT id
          FROM products
          WHERE company_id = $1
            AND barcode = $2
            AND id <> $3
            AND active = true
          LIMIT 1
          `,
          [
            req.user.companyId,
            barcode.trim(),
            req.params.id,
          ]
        );

        if (duplicateBarcode.rows.length) {
          return res.status(409).json({
            success: false,
            message: "A product with this barcode already exists",
          });
        }
      }

      const result = await db(
        `
        UPDATE products
        SET
          category_id = $1,
          name = $2,
          sku = $3,
          barcode = $4,
          description = $5,
          price = $6,
          cost_price = $7,
          vat_rate = $8,
          vat_applicable = COALESCE($9, vat_applicable),
          age_restricted = COALESCE($10, age_restricted),
          low_stock_level = $11,
          track_stock = $12,
          available_on_uber = $13,
          available_on_deliveroo = $14,
          uber_item_id = $15,
          deliveroo_item_id = $16,
          image_url = CASE
            WHEN $17::text IS NULL THEN image_url        /* field omitted -> keep */
            WHEN $17::text = ''    THEN NULL             /* explicit clear  */
            ELSE $17::text                               /* set / replace   */
          END,
          updated_at = NOW()
        WHERE id = $18
          AND company_id = $19
        RETURNING
          id,
          name,
          sku,
          barcode,
          description,
          price,
          cost_price,
          vat_rate,
          vat_applicable,
          age_restricted,
          image_url,
          stock_quantity,
          low_stock_level,
          track_stock,
          available_on_uber,
          available_on_deliveroo,
          uber_item_id,
          deliveroo_item_id,
          category_id,
          active,
          created_at,
          updated_at
        `,
        [
          categoryId || null,
          name.trim(),
          sku ? sku.trim() : null,
          barcode ? barcode.trim() : null,
          description || null,
          Number(price) || 0,
          Number(costPrice) || 0,
          Number(vatRate) || 0,
          /* Edit-safety guarantees:
           *  - vatApplicable undefined -> COALESCE keeps the stored value.
           *  - stock_quantity is NOT in the UPDATE set: editing a product
           *    can never reset current stock to an opening value. Opening
           *    stock is written once, at creation, via the OPENING movement. */
          vatApplicable === undefined ? null : vatApplicable === true,
          ageRestricted === undefined ? null : ageRestricted === true,
          Number(lowStockLevel) || 0,
          Boolean(trackStock),
          Boolean(availableOnUber),
          Boolean(availableOnDeliveroo),
          uberItemId || null,
          deliverooItemId || null,
          /* Image: undefined -> keep stored; null/"" -> clear; a data URL/URL
           * replaces it. Matches the form's Remove (null) / untouched (absent). */
          imageUrl === undefined
            ? null
            : typeof imageUrl === "string" && imageUrl.trim()
              ? imageUrl.trim().slice(0, 500_000)
              : "",
          req.params.id,
          req.user.companyId,
        ]
      );

      // Audit log for product changes
      const updatedProduct = result.rows[0];
      const changes = [];

      if (!updatedProduct) {
        /* Row vanished between the existence check and the UPDATE (or the
         * WHERE id/company guard filtered it) — treat as not found. */
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      if (previousValues.name !== updatedProduct.name) {
        changes.push({ field: "name", previous: previousValues.name, new: updatedProduct.name });
      }
      if (previousValues.sku !== updatedProduct.sku) {
        changes.push({ field: "sku", previous: previousValues.sku, new: updatedProduct.sku });
      }
      if (previousValues.barcode !== updatedProduct.barcode) {
        changes.push({ field: "barcode", previous: previousValues.barcode, new: updatedProduct.barcode });
      }
      if (previousValues.category_id !== updatedProduct.category_id) {
        changes.push({ field: "category_id", previous: previousValues.category_id, new: updatedProduct.category_id });
      }
      if (previousValues.price !== updatedProduct.price) {
        changes.push({ field: "price", previous: previousValues.price, new: updatedProduct.price });
      }
      if (previousValues.vat_rate !== updatedProduct.vat_rate) {
        changes.push({ field: "vat_rate", previous: previousValues.vat_rate, new: updatedProduct.vat_rate });
      }
      if (previousValues.age_restricted !== updatedProduct.age_restricted) {
        changes.push({ field: "age_restricted", previous: previousValues.age_restricted, new: updatedProduct.age_restricted });
      }
      if (previousValues.active !== updatedProduct.active) {
        changes.push({ field: "active", previous: previousValues.active, new: updatedProduct.active });
      }

      if (changes.length > 0 && typeof writeAudit === "function") {
        writeAudit(
          req.user.companyId,
          req.user.id,
          "product.updated",
          "product",
          updatedProduct.id,
          {
            name: updatedProduct.name,
            changes,
          }
        );
      }

      res.json({
        success: true,
        message: "Product updated",
        data: result.rows[0],
      });
    } catch (error) {
      console.error("Update product error:", error);

      res.status(500).json({
        success: false,
        message: "Unable to update product",
        error: error.message,
      });
    }
  });

  /*
   * DELETE /api/products/:id
   * Soft delete — old sales must retain their products.
   */
  router.delete("/products/:id", authenticate, authorize("product.delete"), async (req, res) => {
    try {
      const result = await db(
        `
        UPDATE products
        SET
          active = false,
          updated_at = NOW()
        WHERE id = $1
          AND company_id = $2
        RETURNING id
        `,
        [req.params.id, req.user.companyId]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      // Audit log for product deletion (best-effort)
      if (typeof writeAudit === "function") {
        writeAudit(
          req.user.companyId,
          req.user.id,
          "product.deleted",
          "product",
          req.params.id,
          {
            active: false,
          }
        );
      }

      res.json({
        success: true,
        message: "Product deleted",
      });
    } catch (error) {
      console.error("Delete product error:", error);

      res.status(500).json({
        success: false,
        message: "Unable to delete product",
      });
    }
  });

  /*
   * GET /api/products/:id/history
   * Returns audit trail for a specific product
   */
  router.get("/products/:id/history", authenticate, authorize("product.view"), async (req, res) => {
    try {
      // Verify product belongs to user's company
      const productCheck = await db(
        `
        SELECT id, name
        FROM products
        WHERE id = $1 AND company_id = $2
        `,
        [req.params.id, req.user.companyId]
      );

      if (!productCheck.rows.length) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      const result = await db(
        `
        SELECT
          al.id,
          al.action,
          al.entity_type,
          al.entity_id,
          al.details,
          al.created_at,
          u.username,
          u.full_name
        FROM audit_logs al
        LEFT JOIN users u
          ON u.id = al.user_id
        WHERE al.company_id = $1
          AND al.entity_type = 'product'
          AND al.entity_id = $2
        ORDER BY al.created_at DESC
        LIMIT 100
        `,
        [req.user.companyId, req.params.id]
      );

      res.json({
        success: true,
        data: result.rows,
        productName: productCheck.rows[0].name,
      });
    } catch (error) {
      console.error("Product history error:", error);
      res.status(500).json({
        success: false,
        message: "Unable to load product history",
        error: error.message,
      });
    }
  });

  return router;
}
