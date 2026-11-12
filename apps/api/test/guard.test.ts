import { describe, expect, it } from 'vitest';
import { guardFailures } from '@price-tracker/shared';

const deTitle = 'Mini PC MINISFORUM M1 Pro-125H, Intel Core Ultra 5 125H (14 Cores/18 Threads), 32GB DDR5 RAM, 1TB M.2 PCIe 4.0 SSD | M1 Pro-125H 32/1TB';
const esTitle = 'Mini PC MINIS Forum M1 Pro-125H, Intel Core Ultra 5 125H 32 GB de RAM DDR5 1 TB de SSD M.2 PCIe4.0 | M1, Pro-125H, 32/1TB';
const barebone = 'MINISFORUM M1 Pro-125H Barebone Mini PC (NO RAM/SSD/OS) | M1 Pro-125H 0/0 GB';

describe('guardFailures', () => {
  const include = ['32GB', '1TB', 'M1 Pro-125H'];
  const exclude = ['barebone', '0/0'];

  it('passes the 32GB/1TB pages whatever the spacing and punctuation', () => {
    expect(guardFailures(deTitle, include, exclude)).toEqual([]);
    expect(guardFailures(esTitle, include, exclude)).toEqual([]);
  });

  it('fails the barebone', () => {
    expect(guardFailures(barebone, include, exclude)).toEqual(['missing "32GB"', 'missing "1TB"', 'contains "barebone"', 'contains "0/0"']);
  });

  it('passes everything when no terms are set', () => {
    expect(guardFailures(barebone, [], [])).toEqual([]);
  });
});
