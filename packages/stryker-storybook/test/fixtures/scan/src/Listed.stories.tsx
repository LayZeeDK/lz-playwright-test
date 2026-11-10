import { fn } from 'storybook/test';

export default { args: { onClick: fn().mockReturnValue('stubbed') } };

export const Primary = {};
