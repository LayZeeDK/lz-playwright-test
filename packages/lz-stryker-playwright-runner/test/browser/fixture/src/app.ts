import { add, countTo, double, half } from './lib.js';

const GREETING = 'Hello';

document.querySelector('#out')?.replaceChildren(`${GREETING} ${add(1, 2)}`);
window.countTo = countTo;
window.double = double;
window.half = half;
