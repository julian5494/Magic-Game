// Crossover printings sold under another name resolve to the real card.
import { describe, expect, it } from 'vitest';
import { realName } from '../src/server/bulk';

describe('flavor names', () => {
  it('maps crossover names to the real card', () => {
    expect(realName('Balamb Garden')).toBe('Command Beacon');
    expect(realName("knuckles's gloves")).toBe('The Reaver Cleaver');
    expect(realName('Piko Piko Hammer')).toBe('Hammer of Nazahn');
    expect(realName('Sol Ring')).toBe('Sol Ring');
  });
});
