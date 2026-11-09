import { cases } from './cases.ts';
import { routeMockCases } from './route-mock-cases.ts';
import { runCases } from './support/run-cases.ts';

runCases([...cases, ...routeMockCases]);
