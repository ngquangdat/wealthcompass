#!/usr/bin/env -S npx tsx
import { scan } from './scan';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const command = process.argv[2];

if (command === 'scan' || command === 'doctor') {
  const config = arg('config', 'compass.config.yaml')!;
  const { featureMap, outFile } = scan(config);
  const c = featureMap.coverage;
  const pct = (n: number) => (c.routesFound ? Math.round((n / c.routesFound) * 100) : 0);
  console.log(`Feature Map: ${outFile}`);
  console.log(`  Route/màn hình : ${c.routesFound}`);
  console.log(`  Có tiêu đề     : ${c.routesWithTitle} (${pct(c.routesWithTitle)}%)`);
  console.log(`  Có trên menu   : ${c.menuItemsMatched} (${pct(c.menuItemsMatched)}%)`);
  console.log(`  tourId         : ${c.targetsFound}`);
  console.log(`  Tour hợp lệ    : ${featureMap.tours.length}`);
  if (c.warnings.length) {
    console.log(`\nCảnh báo (${c.warnings.length}):`);
    for (const w of c.warnings) console.log(`  - ${w}`);
  }
  const strict = process.argv.includes('--strict');
  if (strict && c.warnings.length) process.exit(1);
} else {
  console.log('Cách dùng: compass scan|doctor --config <compass.config.yaml> [--strict]');
  process.exit(command ? 1 : 0);
}
