import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// `pnpm dev:web` runs Vite with hot reload and passes the socket and API
// through to `wrangler dev` on :8787. `pnpm dev` serves the built app from
// the Worker itself, the way the phone sees it.
const WORKER = "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      // The Ray's socket goes to the Worker; the /ray page itself is the app's.
      "/ray": { target: WORKER, ws: true, bypass: (req) => (req.headers.upgrade === "websocket" ? undefined : "/index.html") },
      // Every API, anchored: a bare "/me" prefix would also catch the /memories screen.
      "^/(sync|health|horizon|evidence|export|me|voice|transcribe|capture|people/[^?]*|voyage(?:/[^?]*)?|funders/[^?]*|l/[0-9a-f]+[.](?:json|wav)|auth/[^?]*|dev/[^?]*)([?].*)?$": WORKER,
    },
  },
  build: {
    target: "es2020",
    sourcemap: true,
  },
});
