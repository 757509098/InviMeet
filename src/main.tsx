import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

console.log("[InviMeet Frontend] src/main.tsx execution started at", new Date().toISOString());

try {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Critical: DOM element '#root' not found!");
  }

  console.log("[InviMeet Frontend] Creating React root...");
  const root = ReactDOM.createRoot(rootElement);

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  console.log("[InviMeet Frontend] React root rendered successfully.");
} catch (err: any) {
  console.error("[InviMeet Frontend Fatal]", err);
  const banner = document.getElementById("init-error-banner");
  if (banner) {
    banner.style.display = "block";
    banner.innerText = "Fatal Mount Error:\n" + (err?.stack || err?.message || String(err));
  }
}
