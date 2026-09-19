import { useState } from "react";
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
 */
export default function Login({ onLogin, sessionMessage = "", onStartSelfCheckout = null, scoStarting = false, scoError = "" }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [deviceKey, setDeviceKey] = useState("");
  const [scoOpen, setScoOpen] = useState(false); /* reveal the device-key panel */

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

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center">
      <div className="w-[420px] max-w-[95vw]">
        <div className="bg-white border border-slate-200 shadow-xl rounded-2xl overflow-hidden">
          <div className="text-white p-8 text-center" style={{ background: "linear-gradient(180deg, #104744 0%, #176F6A 100%)" }}>
            <div className="w-14 h-14 bg-blue-600 rounded-xl mx-auto flex items-center justify-center">
              <Calculator size={28} />
            </div>

            <h1 className="text-2xl font-bold mt-4">
             onePOS
          </h1>

            <p className="text-sm text-slate-400 mt-1">
              Sign in to your till
            </p>
          </div>

          <div className="p-7">
            {sessionMessage ? (
              <div
                role="alert"
                className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm text-center"
              >
                {sessionMessage}
              </div>
            ) : null}
            <div className="text-center mb-5">
              <div className="font-semibold text-lg">
                Sign in
              </div>
            </div>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg p-3 text-center">
                {error}
              </div>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                login();
              }}
              className="space-y-3 mb-5"
            >
              <input
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Username"
                autoComplete="username"
                className="w-full h-12 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                className="w-full h-12 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="w-full h-12 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              >
                Sign in
              </button>
            </form>

            {/* Customer-facing Self-Checkout entry (dedicated device) */}
            {onStartSelfCheckout && (
              <div className="border-t border-slate-200 pt-4 mt-2">
                {!scoOpen ? (
                  <button
                    type="button"
                    onClick={() => setScoOpen(true)}
                    className="w-full h-12 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold flex items-center justify-center gap-2"
                  >
                    <Monitor size={18} /> Self-Checkout
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-slate-700">Start Self-Checkout on this device</div>
                    <input
                      value={deviceKey}
                      onChange={(event) => setDeviceKey(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && deviceKey.trim()) onStartSelfCheckout(deviceKey.trim());
                      }}
                      placeholder="Device key (from Settings → Store & Till)"
                      autoFocus
                      className="w-full h-11 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-600 tracking-wider"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onStartSelfCheckout(deviceKey.trim())}
                        disabled={scoStarting || !deviceKey.trim()}
                        className="flex-1 h-11 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold disabled:opacity-50"
                      >
                        {scoStarting ? "Starting…" : "Start"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setScoOpen(false); setDeviceKey(""); }}
                        className="h-11 px-4 rounded-lg border text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                    {scoError ? (
                      <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2 text-center">
                        {scoError}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            <div className="text-center text-xs text-slate-400">
              Till 01 · London Store
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
