import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";

import App from "@/App";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/query-client";
import "@/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TooltipProvider delayDuration={200}>
          <App />
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
