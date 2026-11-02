import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ConLogin } from "./components/ConLogin";

// La app entera queda detrás del login de Microsoft 365.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConLogin>
      <App />
    </ConLogin>
  </StrictMode>,
);
