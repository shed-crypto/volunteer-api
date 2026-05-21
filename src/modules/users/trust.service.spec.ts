import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { TrustVouch } from './entities/trust-vouch.entity';
import { SystemRole, ClearanceLevel } from '@common/enums';

// ─── Obfuscated helper for inline testing ─────────────────────────────────────
function obfuscateCoordinate(value: number, precision: number): number {
  const factor = Math.pow(10, precision);
  const jitter = (Math.random() - 0.5) * 2 * (1 / factor) * 5;
  return Math.round((value + jitter) * factor) / factor;
}

function obfuscateLocation(
  latitude: number,
  longitude: number,
  precision: number = 4,
): { latitude: number; longitude: number } {
  return {
    latitude: obfuscateCoordinate(latitude, precision),
    longitude: obfuscateCoordinate(longitude, precision),
  };
}

// ─── Auto-categorization helper ───────────────────────────────────────────────
function autoCategorize(
  description: string,
  title: string,
): { category: string; confidence: number } {
  const combined = `${title} ${description}`.toLowerCase();

  const rules: Array<{ keywords: string[]; category: string }> = [
    { keywords: ['медик', 'медичн', 'лік', 'аптеч', 'шпитал', 'госпітал', 'поранен', 'травм', 'medical', 'hospital', 'wounded'], category: 'MEDICAL' },
    { keywords: ['евакуац', 'евакуюв', 'перевезен', 'транспорт', 'авто', 'машин', 'evacuat', 'transport'], category: 'EVACUATION' },
    { keywords: ['логіст', 'достав', 'перевоз', 'склад', 'logistic', 'delivery', 'warehouse'], category: 'LOGISTICS' },
    { keywords: ['військ', 'збро', 'боєприп', 'фронт', 'передов', 'military', 'frontline', 'weapon'], category: 'MILITARY' },
    { keywords: ['гуманітар', 'допомог', 'їж', 'одяг', 'вода', 'humanitarian', 'food', 'clothes', 'water'], category: 'HUMANITARIAN' },
    { keywords: ['притул', 'житл', 'ночівл', 'дім', 'shelter', 'housing', 'accommodation'], category: 'SHELTER' },
    { keywords: ['психолог', 'ментал', 'психіч', 'стрес', 'psycholog', 'mental', 'stress', 'trauma'], category: 'PSYCHOLOGICAL' },
  ];

  for (const rule of rules) {
    const matchCount = rule.keywords.filter((kw) => combined.includes(kw)).length;
    if (matchCount >= 2) {
      return { category: rule.category, confidence: 0.7 + matchCount * 0.1 };
    }
  }

  return { category: 'OTHER', confidence: 0.5 };
}

// ─── Clearance recalculation ──────────────────────────────────────────────────
function recalculateClearance(
  vouches: { vouchLevel: number; isActive: boolean }[],
  userRole: SystemRole,
): ClearanceLevel | null {
  // Admin always gets international
  if (userRole === SystemRole.ADMIN) return ClearanceLevel.INTERNATIONAL;

  const activeVouches = vouches.filter((v) => v.isActive);
  const totalVouchLevel = activeVouches.reduce((sum, v) => sum + v.vouchLevel, 0);

  // At least 3 active vouches with total level >= 6 → frontline
  if (activeVouches.length >= 3 && totalVouchLevel >= 6) {
    return ClearanceLevel.FRONTLINE;
  }

  // At least 1 active vouch with level >= 2 → international
  if (activeVouches.length >= 1 && totalVouchLevel >= 2) {
    return ClearanceLevel.INTERNATIONAL;
  }

  // At least 1 active vouch → local
  if (activeVouches.length >= 1) {
    return ClearanceLevel.LOCAL;
  }

  // No vouches → no clearance
  return null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('obfuscateLocation', () => {
  it('returns coordinates within ±0.005 deg from original with precision 4', () => {
    const original = { latitude: 46.6354, longitude: 32.6169 };
    const result = obfuscateLocation(original.latitude, original.longitude, 4);

    // Within ±0.005 degrees (~500m radius)
    expect(result.latitude).toBeGreaterThan(original.latitude - 0.005);
    expect(result.latitude).toBeLessThan(original.latitude + 0.005);
    expect(result.longitude).toBeGreaterThan(original.longitude - 0.005);
    expect(result.longitude).toBeLessThan(original.longitude + 0.005);
  });

  it('returns coordinates with specified decimal precision', () => {
    const result = obfuscateLocation(46.6354789, 32.6169123, 3);
    // Should round to 3 decimal places + jitter
    // After rounding: 46.635 ± small jitter
    expect(result.latitude.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(3);
    expect(result.longitude.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(3);
  });

  it('handles extreme latitude values near poles', () => {
    const result = obfuscateLocation(89.9999, -179.9999, 4);
    expect(result.latitude).toBeGreaterThan(89.99);
    expect(result.latitude).toBeLessThan(90.01);
  });

  it('handles coordinates at 0,0', () => {
    const result = obfuscateLocation(0, 0, 4);
    expect(result.latitude).toBeGreaterThan(-0.005);
    expect(result.latitude).toBeLessThan(0.005);
    expect(result.longitude).toBeGreaterThan(-0.005);
    expect(result.longitude).toBeLessThan(0.005);
  });

  it('always returns slightly different coordinates (not identical to original)', () => {
    const original = { latitude: 46.6354, longitude: 32.6169 };
    // Run 10 times to check variance
    const results = Array.from({ length: 10 }, () =>
      obfuscateLocation(original.latitude, original.longitude, 4),
    );

    // At least one result should differ from original
    const anyDifferent = results.some(
      (r) => r.latitude !== original.latitude || r.longitude !== original.longitude,
    );
    expect(anyDifferent).toBe(true);
  });
});

describe('autoCategorize', () => {
  it('correctly categorizes medical requests', () => {
    const result = autoCategorize(
      'Потрібна медична допомога пораненим у шпиталі',
      'Медична евакуація',
    );
    expect(result.category).toBe('MEDICAL');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('correctly categorizes evacuation requests', () => {
    const result = autoCategorize(
      'Термінова евакуація людей, потрібен транспорт',
      'Евакуація родини',
    );
    expect(result.category).toBe('EVACUATION');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('returns OTHER for unrecognized content', () => {
    const result = autoCategorize('Якась невідома категорія', 'Невідома заявка');
    expect(result.category).toBe('OTHER');
    expect(result.confidence).toBe(0.5);
  });

  it('correctly categorizes humanitarian requests', () => {
    const result = autoCategorize(
      'Потрібна гуманітарна допомога: їжа, одяг, вода',
      'Гуманітарний запит',
    );
    expect(result.category).toBe('HUMANITARIAN');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('handles English descriptions', () => {
    const result = autoCategorize(
      'Need medical supplies and hospital transport',
      'Medical evacuation needed',
    );
    expect(result.category).toBe('MEDICAL');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('handles mixed language descriptions', () => {
    const result = autoCategorize(
      'Потрібна евакуація evacuation transport',
      'Evacuation request',
    );
    expect(result.category).toBe('EVACUATION');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('returns highest confidence for many keyword matches', () => {
    const result = autoCategorize(
      'медична допомога лікарня шпиталь поранені травми аптечка',
      'Медична emergency',
    );
    expect(result.category).toBe('MEDICAL');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('handles empty strings', () => {
    const result = autoCategorize('', '');
    expect(result.category).toBe('OTHER');
    expect(result.confidence).toBe(0.5);
  });

  it('prioritizes first matching rule when multiple match', () => {
    // Both medical and evacuation keywords present
    const result = autoCategorize(
      'медична допомога пораненим та евакуація транспортом',
      'Медична евакуація',
    );
    expect(result.category).toBe('MEDICAL'); // MEDICAL is first in rules
  });
});

describe('recalculateClearance', () => {
  it('returns INTERNATIONAL for admin user regardless of vouches', () => {
    const result = recalculateClearance([], SystemRole.ADMIN);
    expect(result).toBe(ClearanceLevel.INTERNATIONAL);
  });

  it('returns null for user with no active vouches', () => {
    const result = recalculateClearance([], SystemRole.VOLUNTEER);
    expect(result).toBeNull();
  });

  it('returns null for user with only inactive vouches', () => {
    const vouches = [
      { vouchLevel: 3, isActive: false },
      { vouchLevel: 2, isActive: false },
    ];
    const result = recalculateClearance(vouches, SystemRole.VOLUNTEER);
    expect(result).toBeNull();
  });

  it('returns LOCAL for user with 1 active vouch (level < 2)', () => {
    const vouches = [{ vouchLevel: 1, isActive: true }];
    const result = recalculateClearance(vouches, SystemRole.VOLUNTEER);
    expect(result).toBe(ClearanceLevel.LOCAL);
  });

  it('returns INTERNATIONAL for user with 1 active vouch (level >= 2)', () => {
    const vouches = [{ vouchLevel: 2, isActive: true }];
    const result = recalculateClearance(vouches, SystemRole.VOLUNTEER);
    expect(result).toBe(ClearanceLevel.INTERNATIONAL);
  });

  it('returns INTERNATIONAL for user with 2 active vouches (total level >= 2)', () => {
    const vouches = [
      { vouchLevel: 1, isActive: true },
      { vouchLevel: 1, isActive: true },
    ];
    const result = recalculateClearance(vouches, SystemRole.VOLUNTEER);
    expect(result).toBe(ClearanceLevel.INTERNATIONAL);
  });

  it('returns FRONTLINE for user with 3 active vouches (total level >= 6)', () => {
    const vouches = [
      { vouchLevel: 2, isActive: true },
      { vouchLevel: 2, isActive: true },
      { vouchLevel: 2, isActive: true },
    ];
    const result = recalculateClearance(vouches, SystemRole.VOLUNTEER);
    expect(result).toBe(ClearanceLevel.FRONTLINE);
  });

  it('returns FRONTLINE for user with 4 active vouches (total level >= 6)', () => {
    const vouches = [
      { vouchLevel: 2, isActive: true },
      { vouchLevel: 2, isActive: true },
      { vouchLevel: 1, isActive: true },
      { vouchLevel: 1, isActive: true },
    ];
    const result = recalculateClearance(vouches, SystemRole.VOLUNTEER);
    expect(result).toBe(ClearanceLevel.FRONTLINE);
  });

  it('stays at INTERNATIONAL with 3 vouches but low total level', () => {
    const vouches = [
      { vouchLevel: 1, isActive: true },
      { vouchLevel: 1, isActive: true },
      { vouchLevel: 1, isActive: true },
    ];
    const result = recalculateClearance(vouches, SystemRole.VOLUNTEER);
    // total level = 3 < 6, so INTERNATIONAL (since 3 active >= 1, total >= 2)
    expect(result).toBe(ClearanceLevel.INTERNATIONAL);
  });

  it('handles vouches with mix of active/inactive correctly', () => {
    const vouches = [
      { vouchLevel: 3, isActive: true },
      { vouchLevel: 3, isActive: false }, // inactive — should not count
      { vouchLevel: 3, isActive: true },
      { vouchLevel: 3, isActive: true },
    ];
    // Active: 3+3+3 = 9, count=3 → FRONTLINE
    const result = recalculateClearance(vouches, SystemRole.VOLUNTEER);
    expect(result).toBe(ClearanceLevel.FRONTLINE);
  });
});