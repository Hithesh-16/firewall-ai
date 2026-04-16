import { RouterProvider } from "react-router-dom";
import { AppInitializer } from "./components/shared/AppInitializer";
import { router } from "./routes";

/**
 * Top-level app shell. Routing lives in `src/routes/` — App only owns
 * cross-cutting providers (auth bootstrap, in future: theme, query
 * client, SEO head provider, etc.).
 */
export function App() {
  return (
    <AppInitializer>
      <RouterProvider router={router} />
    </AppInitializer>
  );
}
