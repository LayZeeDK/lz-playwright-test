import { add, countTo, double, half } from './lib.js';

const greeting = 'Hello';

document.querySelector('#out')?.replaceChildren(`${greeting} ${add(1, 2)}`);
window.countTo = countTo;
window.double = double;
window.half = half;
