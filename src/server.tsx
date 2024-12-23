import { renderToString } from "react-dom/server";
import { App } from "./pages/index";

const server = Bun.serve({
  port: 9876,
  async fetch(req) {
    const url = new URL(req.url);    

    // Serve client bundle
    if (url.pathname === '/client.js') {
      const clientBundle = await Bun.build({
        entrypoints: ['./src/client.tsx'],
        outdir: './public',
        naming: '[name].js',
      });
      return new Response(clientBundle.outputs[0], {
        headers: {
          'Content-Type': 'text/javascript',
        },
      });
    }

    const html = renderToString(<App />);
    return new Response(
      `<!DOCTYPE html>
      <html>
        <head>
          <title>Bun SSR Website</title>
          <script src="/client.js" type="module" defer></script>
        </head>
        <body>
          <div id="root">${html}</div>
        </body>
      </html>`,
      {
        headers: {
          "Content-Type": "text/html",
        },
      }
    );
  },
});

console.log(`Server running at http://localhost:${server.port}`);
