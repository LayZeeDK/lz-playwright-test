const GREETING = 'Hello';

export function add(a, b) {
  return a + b;
}

export function countTo(n) {
  let i = 0;

  while (i < n) {
    i++;
  }

  return i;
}

export function double(n) {
  return n * 2;
}

document.querySelector('#out').textContent = `${GREETING} ${add(1, 2)}`;
window.countTo = countTo;
window.double = double;
