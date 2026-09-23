export function createChangePasswordHandler({ db, bcrypt }) {
  return async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters",
      });
    }

    // Fetch existing hash
    const result = await db(
      `
      SELECT id, password_hash
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.rows[0];

    const validCurrent = await bcrypt.compare(
      currentPassword,
      user.password_hash
    );

    if (!validCurrent) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Reuse the same bcrypt hashing used at registration/login
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await db(
      `
      UPDATE users
      SET password_hash = $1
          , must_change_password = FALSE
      WHERE id = $2
      `,
      [newPasswordHash, user.id]
    );

    res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to change password",
    });
  }
};
}
