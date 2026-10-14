// Trimmed from Acme's respond.ts: the 404 page borrows Tailwind stone, not the Acme tokens.
export function notFoundPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Not found</title>
    <style>
      body { font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; margin: 20vh auto; max-width: 32rem;
             padding: 0 1.5rem; color: #1c1917; background: #fafaf9; }
      code { background: #f5f5f4; padding: 0.1rem 0.3rem; border-radius: 3px; }
    </style>
  </head>
  <body>
    <h1>Not found</h1>
    <p><a href="/">&#8592; back to the catalog</a></p>
  </body>
</html>`;
}
