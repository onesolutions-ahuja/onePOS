// Temporary script to write Login.jsx
const fs = require('fs');
const content = `import { useState } from "react";
import { Monitor, Calculator } from "lucide-react";
import { apiRequest } from "../../services/api.js";

/*
 * Login screen — staff sign-in plus the customer-facing Self-Checkout entry.
 *
 * Self-Checkout runs on a dedicated customer device with NO staff logged in.
 * The device proves itself once with the store's Self-Checkout device key
 * (Settings → Store & Till → Self-Checkout device pairing); a valid key
 * starts the restricted card-only Self-Checkout screen with Guest /
 * Sign-in identification for the customer.
 *
 * Server configuration is DEVICE configuration, not login information.
 *
 *   - onePOS ships with a production server default (the Render deployment,
 *     DEFAULT_SERVER_ADDRESS in services/serverAddress.js). Normal users are
 *     NEVER asked to enter a server address — the default keeps the app
 *     working out of the box on native devices and relative /api URLs keep
 *     working on the web.
 *   - A Superadmin can optionally override the server from Settings → Server /
 *     API Configuration. That is the ONLY place the server can be changed.
 *   - Changing the server NEVER touches accounts, credentials, customer data,
 *     products, sales, the offline queue or the current JWT. Logout and user
 *     switching do not clear the configuration — it belongs to the device.
 *   - A temporarily unreachable server never erases or re-prompts for the
 *     configuration.
 */

export default function Login({ onLogin, sessionMessage = "", onStartSelfCheckout = null, scoStarting = false, scoError = "" }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [deviceKey, setDeviceKey] = useState("");
  const [scoOpen, setScoOpen] = useState(false);

  const login = async () => {
    setError("");

    if (!username.trim() || !password) {
      setError("Enter your username and password");
      return;
    }

    try {
      const data = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      if (!data.success || !data.token) {
        throw new Error(data.message || "Unable to sign in");
      }

      localStorage.setItem("onepos_token", data.token);
      onLogin(data.user);
    } catch (loginError) {
      setError(loginError.message || "Invalid username or password");
    }
  };
`;
fs.writeFileSync('src/pages/auth/Login.jsx', content);
console.log('Written:', content.length, 'chars');
