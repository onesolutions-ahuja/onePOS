import express from "express";

export default function createProductsRouter({ authenticate, authorize, db, pool, createInventoryMovement }) {
  const router = express.Router();

  /*
   * GET /api/categories
   *
   * Returns active categories when no query parameter is given (used by POS product selector).
   * When ?all=true is passed, returns all categories (including inactive) with product counts
   * (used by the admin Categories management page).
   */
  router.get("/categories", authenticate, authorize("product.view"), async (req, res) => {
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
   * POST /api/categories
   */
  router.post("/categories", authenticate, authorize("product.create"), async (req, res) => {
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
   router.put("/categories/:id", authenticate, authorize("product.edit"), async (req, res) => {
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
   router.delete("/categories/:id", authenticate, authorize("product.delete"), async (req, res) => {
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
        stockQuantity = 0,
        lowStockLevel = 0,
        trackStock = true,
        categoryId = null,
        availableOnUber = false,
        availableOnDeliveroo = false,
        uberItemId = null,
        deliverooItemId = null,
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
          stock_quantity,
          low_stock_level,
          track_stock,
          active,
          available_on_uber,
          available_on_deliveroo,
          uber_item_id,
          deliveroo_item_id
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15,$16
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
          0,
          Number(lowStockLevel) || 0,
          Boolean(trackStock),
          Boolean(availableOnUber),
          Boolean(availableOnDeliveroo),
          uberItemId || null,
          deliverooItemId || null,
        ]
      );

      const initialStock = Number(stockQuantity) || 0;

      if (initialStock >= 0) {
        const movement = await createInventoryMovement(client, {
          companyId: req.user.companyId,
          productId: result.rows[0].id,
          storeId: req.user.storeId,
          movementType: "OPENING",
          quantityChange: initialStock,
          reason: "Opening stock",
          createdBy: req.user.id,
        });

        result.rows[0].stock_quantity = movement.balance;
      }

      await client.query("COMMIT");

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
        lowStockLevel = 0,
        trackStock = true,
        categoryId = null,
        availableOnUber = false,
        availableOnDeliveroo = false,
        uberItemId = null,
        deliverooItemId = null,
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
          low_stock_level = $9,
          track_stock = $10,
          available_on_uber = $11,
          available_on_deliveroo = $12,
          uber_item_id = $13,
          deliveroo_item_id = $14,
          updated_at = NOW()
        WHERE id = $15
          AND company_id = $16
        RETURNING
          id,
          name,
          sku,
          barcode,
          description,
          price,
          cost_price,
          vat_rate,
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
          Number(lowStockLevel) || 0,
          Boolean(trackStock),
          Boolean(availableOnUber),
          Boolean(availableOnDeliveroo),
          uberItemId || null,
          deliverooItemId || null,
          req.params.id,
          req.user.companyId,
        ]
      );

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

  return router;
}
