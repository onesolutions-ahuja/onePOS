import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const PORT = process.env.PORT || 10000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

/*
|--------------------------------------------------------------------------
| Health check
|--------------------------------------------------------------------------
*/

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    app: "onePOS",
    status: "online",
    version: "0.1.0",
    time: new Date().toISOString(),
  });
});

/*
|--------------------------------------------------------------------------
| Basic API
|--------------------------------------------------------------------------
*/

app.get("/api", (req, res) => {
  res.json({
    name: "onePOS API",
    version: "0.1.0",
    status: "online",
  });
});

/*
|--------------------------------------------------------------------------
| Serve React production build
|--------------------------------------------------------------------------
*/

const distPath = path.join(__dirname, "dist");

app.use(express.static(distPath));

app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

/*
|--------------------------------------------------------------------------
| Start server
|--------------------------------------------------------------------------
*/

app.listen(PORT, "0.0.0.0", () => {
  console.log(`onePOS server running on port ${PORT}`);
});
