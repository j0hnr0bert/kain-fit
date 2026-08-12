import { createStart } from "@tanstack/react-start";
// Imported from the leaf package instead of the `@tanstack/react-start` barrel:
// the barrel re-exports the server entry, which made the built worker chunk graph
// circular (SSR entry -> start.ts -> createMiddleware chunk -> SSR entry) and left
// `createMiddleware` undefined at module init ("createMiddleware is not a function").
import { createMiddleware } from "@tanstack/start-client-core";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
