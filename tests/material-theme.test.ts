import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { materialColors } from '../src/material/colors';

function luminance(hex: string) {
  const linear = hex
    .slice(1)
    .match(/../g)!
    .map((part) => {
      const value = parseInt(part, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
test('Material semantic foreground/background pairs meet normal-text AA contrast in both themes', () => {
  const pairs = [
    ['onSurface', 'surface'],
    ['onSurfaceVariant', 'surfaceContainerLow'],
    ['onPrimary', 'primary'],
    ['onPrimaryContainer', 'primaryContainer'],
    ['onSecondaryContainer', 'secondaryContainer'],
    ['onTertiaryContainer', 'tertiaryContainer'],
    ['onErrorContainer', 'errorContainer'],
    ['inverseOnSurface', 'inverseSurface'],
  ] as const;
  for (const [mode, colors] of Object.entries(materialColors)) {
    for (const [foreground, background] of pairs) {
      const values = [luminance(colors[foreground]), luminance(colors[background])].sort(
        (a, b) => b - a,
      );
      assert.ok(
        (values[0] + 0.05) / (values[1] + 0.05) >= 4.5,
        `${mode}: ${foreground}/${background}`,
      );
    }
  }
});
test('the pre-paint cache and renderer use the same Material surface to avoid a theme flash', async () => {
  const appearance = await readFile(new URL('../public/appearance.js', import.meta.url), 'utf8');
  for (const colors of Object.values(materialColors))
    assert.ok(appearance.includes(colors.surface));
});
