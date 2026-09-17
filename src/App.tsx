import React, { useState, useEffect } from "react";
import { PillWindow } from "@/windows/PillWindow";
import { MainWindow } from "@/windows/MainWindow";

export const App: React.FC = () => {
  const [windowType, setWindowType] = useState<"main" | "pill">(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlWindow = params.get("window");
      if (urlWindow === "pill") return "pill";
      if (urlWindow === "main") return "main";

      try {
        const label = (window as any)?.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
        if (label === "pill") return "pill";
      } catch (e) {}
    }
    return "main";
  });

  useEffect(() => {
    console.log("[InviMeet App] Mounted. Current windowType state:", windowType, "location:", window.location.href);

    // Asynchronously detect Tauri WebviewWindow label if available
    import("@tauri-apps/api/webviewWindow")
      .then(({ getCurrentWebviewWindow }) => {
        const win = getCurrentWebviewWindow();
        console.log("[InviMeet App] Detected getCurrentWebviewWindow label:", win?.label);
        if (win?.label === "pill") {
          setWindowType("pill");
        } else if (win?.label === "main") {
          setWindowType("main");
        }
      })
      .catch((err) => {
        console.warn("[InviMeet App] getCurrentWebviewWindow failed or running in browser:", err);
      });
  }, [windowType]);

  return (
    <div className="w-full h-full min-h-screen">
      {windowType === "pill" ? <PillWindow /> : <MainWindow />}
    </div>
  );
};

export default App;
