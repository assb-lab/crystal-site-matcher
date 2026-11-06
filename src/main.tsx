import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n";
import { ElementColorsProvider } from "./components/ElementColors";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <ElementColorsProvider>
        <App />
      </ElementColorsProvider>
    </I18nProvider>
  </StrictMode>,
);
