import { useState } from "react";
import { Calculator } from "lucide-react";
import { apiRequest } from "../../services/api.js";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

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
    <div className="min-h-screen bg-[#f4f6f8] flex items-center justify-center">
      <div className="w-[420px] max-w-[95vw]">
        <div className="bg-white border border-slate-200 shadow-xl rounded-2xl overflow-hidden">
          <div className="bg-slate-900 text-white p-8 text-center">
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

            <div className="text-center text-xs text-slate-400">
              Till 01 · London Store
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
