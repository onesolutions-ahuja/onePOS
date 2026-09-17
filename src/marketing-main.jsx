import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MarketingRoutes } from "./routes.jsx";
import "./marketing/marketing.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <MarketingRoutes />
    </BrowserRouter>
  </React.StrictMode>
);