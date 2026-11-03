// Spike B server: plain node:http. GET / renders the cart total into the page, whose button fetches it
// again from GET /api/total; GET /health answers Playwright's readiness check without running cart code.
import http from 'node:http';

import { label, total } from './cart.mjs';

const port = Number(process.env['PORT'] ?? 4830);

function cartTotal(url) {
  return total(
    Number(url.searchParams.get('mugs')),
    Number(url.searchParams.get('posters')),
  );
}

function page(amount) {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Cart</title></head>
  <body>
    <p data-testid="total">${label(amount)}</p>
    <button type="button">Recount</button>
    <p data-testid="recount"></p>
    <script>
      document.querySelector('button').addEventListener('click', async () => {
        const response = await fetch('/api/total' + location.search);
        document.querySelector('[data-testid=recount]').textContent = (await response.json()).label;
      });
    </script>
  </body>
</html>
`;
}

http
  .createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (url.pathname === '/health') {
      response.end('ok');

      return;
    }

    if (url.pathname === '/api/total') {
      const amount = cartTotal(url);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ total: amount, label: label(amount) }));

      return;
    }

    if (url.pathname === '/') {
      response.setHeader('content-type', 'text/html');
      response.end(page(cartTotal(url)));

      return;
    }

    response.statusCode = 404;
    response.end();
  })
  .listen(port, '127.0.0.1');
