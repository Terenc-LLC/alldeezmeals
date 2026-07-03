import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SharedListPage from "./SharedListPage";
import "./index.css";

// TER-286: public shared-list route. State-routed app has no react-router; branch
// here so /s/<token> renders the standalone page instead of the authed <App />.
const sharedMatch = window.location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {sharedMatch ? <SharedListPage token={sharedMatch[1]} /> : <App />}
  </StrictMode>
);
