import { useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import {
  type CartLine,
  formatPrice,
  lineTotal,
  shipping,
  subtotal,
  total,
} from './cart';

const initialLines: CartLine[] = [
  { name: 'Mug', priceCents: 12_00, quantity: 1 },
  { name: 'Poster', priceCents: 20_00, quantity: 1 },
];

function Cart() {
  const [lines, setLines] = useState(initialLines);
  const [code, setCode] = useState('');

  const setQuantity = (name: string, quantity: number) =>
    setLines((current) =>
      current.map((line) => (line.name === name ? { ...line, quantity } : line)),
    );

  return (
    <main>
      <h1>Cart</h1>
      <ul>
        {lines.map((line) => (
          <li key={line.name}>
            <label>
              {line.name}
              <input
                type="number"
                aria-label={`${line.name} quantity`}
                value={line.quantity}
                onChange={(event) =>
                  setQuantity(line.name, Number(event.target.value))
                }
              />
            </label>
            <output aria-label={`${line.name} total`}>
              {formatPrice(lineTotal(line))}
            </output>
          </li>
        ))}
      </ul>
      <label>
        Discount code
        <input value={code} onChange={(event) => setCode(event.target.value)} />
      </label>
      <dl>
        <dt>Subtotal</dt>
        <dd data-testid="subtotal">{formatPrice(subtotal(lines))}</dd>
        <dt>Shipping</dt>
        <dd data-testid="shipping">{formatPrice(shipping(subtotal(lines)))}</dd>
        <dt>Total</dt>
        <dd data-testid="total">{formatPrice(total(lines, code))}</dd>
      </dl>
      <Link to="/about">About</Link>
    </main>
  );
}

function About() {
  return (
    <main>
      <h1>About</h1>
      <Link to="/">Back to cart</Link>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Cart />} />
      <Route path="/about" element={<About />} />
    </Routes>
  );
}

export default App;
