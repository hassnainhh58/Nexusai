import { ClerkProvider } from "@clerk/react";
import { ui } from "@clerk/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import "./App.css";

import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";


const clerkPublishableKey =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;


if (!clerkPublishableKey) {
  throw new Error(
    "Missing VITE_CLERK_PUBLISHABLE_KEY in frontend/.env"
  );
}


createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      // Pins the Clerk UI version so the theme overrides in App.css keep
      // working when Clerk ships component updates.
      ui={ui}
      afterSignOutUrl="/"
    >
      <ErrorBoundary>
        <App />
      </ErrorBoundary>    </ClerkProvider>
  </StrictMode>
);
