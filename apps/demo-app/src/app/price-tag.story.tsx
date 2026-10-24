import { PriceTag } from './price-tag';

export const Regular = () => <PriceTag cents={12_00} />;

export const OnSale = () => <PriceTag cents={15_00} compareAtCents={20_00} />;

export const HalfPrice = () => <PriceTag cents={10_00} compareAtCents={20_00} />;

export const Configurable = (props: { cents: number; compareAtCents?: number }) => <PriceTag {...props} />;
