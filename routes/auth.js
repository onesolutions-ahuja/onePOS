import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = express.Router();

export default function createAuthRouter(pool) {
  /*
   * POST /api/auth/setup
   *
   * Creates the first company, store, terminal,
   * owner role and administrator account.
   *
   * This is intended for initial setup only.
   */
  router.post("/setup", async (req, res) => {
    const client = await pool.connect();

    try {
      const {
        companyName,
        storeName,
        fullName,
        username,
        password
      } = req.body;

      if (!companyName || !storeName || !fullName || !username || !password) {
        return res.status(400).json({
          success: false,
          message: "All fields are required"
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must contain at least 6 characters"
        });
      }

      const existingUsers = await client.query(
        "SELECT COUNT(*)::int AS count FROM users"
      );

      if (existingUsers.rows[0].count > 0) {
        return res.status(403).json({
          success: false,
          message: "Initial setup has already been completed"
        });
      }

      await client.query("BEGIN");

      const companyResult = await client.query(
        `
        INSERT INTO companies
          (name)
        VALUES
          ($1)
        RETURNING id, name
        `,
        [companyName]
      );

      const company = companyResult.rows[0];

      const storeResult = await client.query(
        `
        INSERT INTO stores
          (company_id, name, code)
        VALUES
          ($1, $2, $3)
        RETURNING id, name, code
        `,
        [
          company.id,
          storeName,
          "STORE-001"
        ]
      );

      const store = storeResult.rows[0];

      const terminalResult = await client.query(
        `
        INSERT INTO terminals
          (store_id, name, terminal_number)
        VALUES
          ($1, $2, $3)
        RETURNING id, name, terminal_number
        `,
        [
          store.id,
          "Till 01",
          "01"
        ]
      );

      const terminal = terminalResult.rows[0];

      const roleResult = await client.query(
        `
        INSERT INTO roles
          (company_id, name, description, is_system_role)
        VALUES
          ($1, 'Administrator', 'Full access to onePOS', TRUE)
        RETURNING id, name
        `,
        [company.id]
      );

      const role = roleResult.rows[0];

      const permissionResult = await client.query(
        "SELECT id FROM permissions"
      );

      for (const permission of permissionResult.rows) {
        await client.query(
          `
          INSERT INTO role_permissions
            (role_id, permission_id)
          VALUES
            ($1, $2)
          ON CONFLICT DO NOTHING
          `,
          [role.id, permission.id]
        );
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const userResult = await client.query(
        `
        INSERT INTO users
          (
            company_id,
            store_id,
            role_id,
            username,
            password_hash,
            full_name
          )
        VALUES
          ($1, $2, $3, $4, $5, $6)
        RETURNING
          id,
          username,
          full_name
        `,
        [
          company.id,
          store.id,
          role.id,
          username.toLowerCase().trim(),
          passwordHash,
          fullName
        ]
      );

      await client.query("COMMIT");

      res.status(201).json({
        success: true,
        message: "onePOS setup completed",
        company,
        store,
        terminal,
        user: userResult.rows[0]
      });

    } catch (error) {
      await client.query("ROLLBACK");

      console.error("Setup error:", error);

      res.status(500).json({
        success: false,
        message: "Unable to complete setup",
        error: error.message
      });

    } finally {
      client.release();
    }
  });


  /*
   * POST /api/auth/login
   */
  router.post("/login", async (req, res) => {
    try {
      const {
        username,
        password
      } = req.body;

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          message: "Username and password are required"
        });
      }

      const result = await pool.query(
        `
        SELECT
          u.id,
          u.username,
          u.password_hash,
          u.full_name,
          u.active,
          u.company_id,
          u.store_id,
          u.role_id,
          c.name AS company_name,
          s.name AS store_name,
          r.name AS role_name
        FROM users u
        LEFT JOIN companies c
          ON c.id = u.company_id
        LEFT JOIN stores s
          ON s.id = u.store_id
        LEFT JOIN roles r
          ON r.id = u.role_id
        WHERE LOWER(u.username) = LOWER($1)
        LIMIT 1
        `,
        [username.trim()]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: "Invalid username or password"
        });
      }

      const user = result.rows[0];

      if (!user.active) {
        return res.status(403).json({
          success: false,
          message: "This user account is disabled"
        });
      }

      const passwordValid = await bcrypt.compare(
        password,
        user.password_hash
      );

      if (!passwordValid) {
        return res.status(401).json({
          success: false,
          message: "Invalid username or password"
        });
      }

      const token = jwt.sign(
        {
          userId: user.id,
          companyId: user.company_id,
          storeId: user.store_id,
          roleId: user.role_id
        },
        process.env.JWT_SECRET,
        {
          expiresIn: "12h"
        }
      );

      await pool.query(
        `
        UPDATE users
        SET last_login_at = NOW()
        WHERE id = $1
        `,
        [user.id]
      );

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.full_name,
          role: user.role_name,
          companyId: user.company_id,
          companyName: user.company_name,
          storeId: user.store_id,
          storeName: user.store_name
        }
      });

    } catch (error) {
      console.error("Login error:", error);

      res.status(500).json({
        success: false,
        message: "Login failed"
      });
    }
  });


  /*
   * GET /api/auth/me
   */
  router.get("/me", async (req, res) => {
    try {
      const header = req.headers.authorization;

      if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({
          success: false,
          message: "Authentication required"
        });
      }

      const token = header.substring(7);

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET
      );

      const result = await pool.query(
        `
        SELECT
          u.id,
          u.username,
          u.full_name,
          u.company_id,
          u.store_id,
          r.name AS role_name,
          c.name AS company_name,
          s.name AS store_name
        FROM users u
        LEFT JOIN roles r
          ON r.id = u.role_id
        LEFT JOIN companies c
          ON c.id = u.company_id
        LEFT JOIN stores s
          ON s.id = u.store_id
        WHERE u.id = $1
          AND u.active = TRUE
        `,
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: "User no longer exists or is disabled"
        });
      }

      const user = result.rows[0];

      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.full_name,
          role: user.role_name,
          companyId: user.company_id,
          companyName: user.company_name,
          storeId: user.store_id,
          storeName: user.store_name
        }
      });

    } catch (error) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session"
      });
    }
  });


  /*
   * POST /api/auth/change-password
   */
  router.post("/change-password", async (req, res) => {
    try {
      const header = req.headers.authorization;

      if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({
          success: false,
          message: "Authentication required"
        });
      }

      let decoded;

      try {
        decoded = jwt.verify(header.substring(7), process.env.JWT_SECRET);
      } catch {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired session"
        });
      }

      const { currentPassword, newPassword, confirmPassword } = req.body || {};

      if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({
          success: false,
          message: "Current password, new password and confirmation are required"
        });
      }

      if (newPassword !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: "New password and confirmation do not match"
        });
      }

      if (String(newPassword).length < 8) {
        return res.status(400).json({
          success: false,
          message: "New password must be at least 8 characters"
        });
      }

      const result = await pool.query(
        `SELECT id, password_hash FROM users WHERE id = $1 AND active = TRUE`,
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: "User no longer exists or is disabled"
        });
      }

      const user = result.rows[0];

      const passwordOk = await bcrypt.compare(
        currentPassword,
        user.password_hash
      );

      if (!passwordOk) {
        return res.status(401).json({
          success: false,
          message: "Current password is incorrect"
        });
      }

      const sameAsOld = await bcrypt.compare(
        newPassword,
        user.password_hash
      );

      if (sameAsOld) {
        return res.status(400).json({
          success: false,
          message: "New password must be different from the current password"
        });
      }

      const newPasswordHash = await bcrypt.hash(newPassword, 10);

      await pool.query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [newPasswordHash, user.id]
      );

      res.json({
        success: true,
        message: "Password changed successfully"
      });

    } catch (error) {
      console.error("Change password error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to change password"
      });
    }
  });

  return router;
}