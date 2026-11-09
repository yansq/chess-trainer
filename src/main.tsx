import { AppTheme, initialAppearance } from "./shared/ui/AppTheme";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./app/App";
import "./style.css";
const appearance = initialAppearance();
document.documentElement.dataset.appearance = appearance;
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppTheme initial={appearance}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppTheme>
  </React.StrictMode>,
);
