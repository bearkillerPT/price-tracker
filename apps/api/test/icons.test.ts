import { describe, expect, it } from 'vitest';
import { fetchIcon, iconCandidates, imageType } from '../src/stores/icons.ts';
import { shopFixture } from './fixtures.ts';

describe('store icons', () => {
  it("picks the page's small raster icon over its SVG and touch icon, then /favicon.ico", () => {
    // Fnac links a 32x32 .ico, an SVG and an apple-touch-icon
    expect(iconCandidates(shopFixture('fnac-out-of-stock'), 'https://www.fnac.pt/a13213894')).toEqual([
      'https://www.fnac.pt/Assets/dist/nav/_61dae59520fe055d.ico',
      'https://www.fnac.pt/favicon.ico',
    ]);
    expect(iconCandidates('<html><head></head></html>', 'https://shop.example/p/1')).toEqual(['https://shop.example/favicon.ico']);
  });

  it('accepts raster images only, by their first bytes', () => {
    expect(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('image/png');
    expect(imageType(Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01]))).toBe('image/x-icon');
    expect(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(imageType(Buffer.from('<!doctype html>'))).toBeNull();
  });

  it("doesn't load icons from the local network", async () => {
    expect(await fetchIcon('http://127.0.0.1:9/favicon.ico')).toBeNull();
    expect(await fetchIcon('http://router.lan/favicon.ico')).toBeNull();
    expect(await fetchIcon('file:///etc/passwd')).toBeNull();
  });
});
