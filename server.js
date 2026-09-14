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

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    app: "onePOS",
    status: "online",
    version: "0.1.0",
    time: new Date().toISOString(),
  });
});

app.get("/api", (req, res) => {
  res.json({
    name: "onePOS API",
    version: "0.1.0",
    status: "online",
  });
});

const distPath = path.join(__dirname, "dist");

app.use(express.static(distPath));

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      success: false,
      message: "API endpoint not found",
    });
  }

  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`onePOS server running on port ${PORT}`);
});
