import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = express.Router();

/*
 * POST /api/customer-auth/login
 * Customer-facing login (separate from admin/staff login).
 * Uses the existing customers table and company-scoped JWT.
 */
router.post("/customer-auth/login", async (req, res) => {
  const { pool } = req.app.locals;
  if (!pool) {
    return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
  }

  try {
    const { phone, email, password } = req.body;

    if ((!phone && !email) || !password) {
      return res.status(400).json({
        success: false,
        message: "Phone or email and password are required"
      });
    }

    const identifiers = [phone, email].filter((v) => v && String(v).trim());
    if (!identifiers.length) {
      return res.status(400).json({ success: false, message: "Phone or email required" });
    }

    const query = `
      SELECT c.id, c.company_id, c.name, c.phone, c.email, c.password_hash, c.active
      FROM customers c
      WHERE c.company_id = $1
        AND c.active = true
        AND (c.phone = ANY($2::text[]) OR LOWER(c.email) = ANY($3::text[]))
      LIMIT 1
    `;

    const result = await pool.query(query, [
      req.body.companyId || null, // Will be set from token if provided
      identifiers.map((v) => String(v).trim()),
      identifiers.map((v) => String(v).trim().toLowerCase())
    ]);

    // If companyId not provided, we need to find by phone/email across companies
    if (!req.body.companyId) {
      const crossCompanyQuery = `
        SELECT c.id, c.company_id, c.name, c.phone, c.email, c.password_hash, c.active
        FROM customers c
        WHERE c.active = true
          AND (c.phone = ANY($1::text[]) OR LOWER(c.email) = ANY($2::text[]))
        LIMIT 1
      `;
      const crossResult = await pool.query(crossCompanyQuery, [
        identifiers.map((v) => String(v).trim()),
        identifiers.map((v) => String(v).trim().toLowerCase())
      ]);

      if (crossResult.rows.length) {
        const customer = crossResult.rows[0];
        const passwordValid = await bcrypt.compare(password, customer.password_hash);
        if (!passwordValid) {
          return res.status(401).json({ success: false, message: "Invalid credentials" });
        }
        if (!customer.active) {
          return res.status(403).json({ success: false, message: "Account disabled" });
        }

        const token = jwt.sign(
          {
            customerId: customer.id,
            companyId: customer.company_id,
            name: customer.name,
            phone: customer.phone,
            email: customer.email
          },
          process.env.JWT_SECRET,
          { expiresIn: "30d" }
        );

        return res.json({
          success: true,
          token,
          customer: {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            companyId: customer.company_id
          }
        });
      }

      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // Single company mode (token provided)
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const customer = result.rows[0];
    const passwordValid = await bcrypt.compare(password, customer.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    if (!customer.active) {
      return res.status(403).json({ success: false, message: "Account disabled" });
    }

    const token = jwt.sign(
      {
        customerId: customer.id,
        companyId: customer.company_id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      success: true,
      token,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        companyId: customer.company_id
      }
    });
  } catch (error) {
    console.error("Customer login error:", error);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

/*
 * POST /api/customer-auth/register
 * Customer-facing registration.
 * Creates a new customer account using the existing customer model.
 */
router.post("/customer-auth/register", async (req, res) => {
  const { pool } = req.app.locals;
  if (!pool) {
    return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
  }

  try {
    const { name, phone, email, password, companyId } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }
    if (!phone && !email) {
      return res.status(400).json({ success: false, message: "Phone or email is required" });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }
    if (!companyId) {
      return res.status(400).json({ success: false, message: "Company ID required" });
    }

    const identifiers = [phone, email].filter((v) => v && String(v).trim());
    if (!identifiers.length) {
      return res.status(400).json({ success: false, message: "Phone or email required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Check if customer already exists in this company
      const identifiersLower = identifiers.map((v) => String(v).trim().toLowerCase());
      const matches = await client.query(
        `SELECT id, name, phone, email FROM customers 
         WHERE company_id = $1 
         AND (phone = ANY($2::text[]) OR LOWER(email) = ANY($3::text[])) 
         AND active = true`,
        [
          companyId,
          identifiers.map((v) => String(v).trim()),
          identifiersLower
        ]
      );

      let customer;
      if (matches.rows.length) {
        // Customer exists - return conflict
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "Customer already exists with this phone or email"
        });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const created = await client.query(
        `INSERT INTO customers (company_id, name, phone, email, password_hash, active) 
         VALUES ($1,$2,$3,$4,$5,TRUE) 
         RETURNING id, name, phone, email, company_id`,
        [
          companyId,
          String(name).trim(),
          phone || null,
          email || null,
          await bcrypt.hash(password, 12)
        ]
      );

      await client.query("COMMIT");

      customer = created.rows[0];
      const token = jwt.sign(
        {
          customerId: customer.id,
          companyId: customer.company_id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email
        },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
      );

      res.status(201).json({
        success: true,
        message: "Registration successful",
        token,
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          companyId: customer.company_id
        }
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Customer registration error:", error);
      res.status(500).json({ success: false, message: "Registration failed" });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Customer registration error:", error);
    res.status(500).json({ success: false, message: "Registration failed" });
  }
});

/*
 * GET /api/customer-auth/me
 * Get current customer profile from token
 */
router.get("/customer-auth/me", async (req, res) => {
  const { pool } = req.app.locals;
  if (!pool) {
    return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
  }

  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const token = header.substring(7);
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: "Invalid or expired session" });
    }

    if (!decoded.customerId) {
      return res.status(401).json({ success: false, message: "Invalid customer token" });
    }

    const result = await pool.query(
      `SELECT id, name, phone, email, company_id, active, created_at
       FROM customers WHERE id = $1 AND active = true`,
      [decoded.customerId]
    );

    if (!result.rows.length) {
      return res.status(401).json({ success: false, message: "Customer not found" });
    }

    const customer = result.rows[0];
    res.json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        companyId: customer.company_id,
        createdAt: customer.created_at
      }
    });
  } catch (error) {
    console.error("Customer me error:", error);
    res.status(500).json({ success: false, message: "Unable to load profile" });
  }
});

/*
 * GET /api/settings/public
 * Public settings endpoint (no auth) for Scan & Go entry screen
 * Returns only scan_go_enabled and online_ordering_enabled for the company
 */
router.get("/settings/public/:companyId", async (req, res) => {
  const { pool } = req.app.locals;
  if (!pool) {
    return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
  }

  try {
    const { companyId } = req.params;
    const result = await pool.query(
      `SELECT scan_go_enabled, online_ordering_enabled, online_payment_methods
       FROM company_settings WHERE company_id = $1`,
      [companyId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }

    const settings = result.rows[0];
    res.json({
      success: true,
      data: {
        scanGoEnabled: settings.scan_go_enabled === true,
        onlineOrderingEnabled: settings.online_ordering_enabled === true,
        onlinePaymentMethods: Array.isArray(settings.online_payment_methods) 
          ? settings.online_payment_methods 
          : ["card", "cash", "cod"]
      }
    });
  } catch (error) {
    console.error("Load public settings error:", error);
    res.status(500).json({ success: false, message: "Unable to load settings" });
  }
});

export default router;