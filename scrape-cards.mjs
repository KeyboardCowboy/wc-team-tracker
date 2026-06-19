#!/usr/bin/env node
// Scrapes yellow/red card data from myfootballfacts.com and writes data/cards.json.
// No external dependencies — uses built-in fetch and regex on the static HTML tables.
//
// Usage:
//   node scrape-cards.mjs
//
// Run manually or via GitHub Actions (.github/workflows/scrape-cards.yml).

import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOURCE_URL = 'https://www.myfootballfacts.com/world-football/fifa/world-cup/fifa-world-cup-by-year/2026-world-cup/wc-2026-fixtures-and-stats/2026-fifa-world-cup-red-and-yellow-cards/';

// ─── Team name → FIFA code ────────────────────────────────────────────────────
// Includes page-specific name variants (e.g. "Korea Republic" vs "South Korea")

const NAME_TO_CODE = {
  'Mexico': 'MEX', 'South Africa': 'RSA', 'South Korea': 'KOR', 'Korea Republic': 'KOR',
  'Czech Republic': 'CZE', 'Canada': 'CAN',
  'Bosnia and Herzegovina': 'BIH', 'Bosnia & Herzegovina': 'BIH',
  'Qatar': 'QAT', 'Switzerland': 'SUI', 'Brazil': 'BRA', 'Morocco': 'MAR',
  'Haiti': 'HAI', 'Scotland': 'SCO', 'USA': 'USA', 'United States of America': 'USA',
  'Paraguay': 'PAR', 'Australia': 'AUS', 'Turkey': 'TUR', 'Germany': 'GER',
  'Curaçao': 'CUW', 'Ivory Coast': 'CIV', 'Ecuador': 'ECU', 'Netherlands': 'NED',
  'Japan': 'JPN', 'Sweden': 'SWE', 'Tunisia': 'TUN', 'Belgium': 'BEL',
  'Egypt': 'EGY', 'Iran': 'IRN', 'New Zealand': 'NZL', 'Spain': 'ESP',
  'Cape Verde': 'CPV', 'Saudi Arabia': 'KSA', 'Uruguay': 'URU', 'France': 'FRA',
  'Senegal': 'SEN', 'Iraq': 'IRQ', 'Norway': 'NOR', 'Argentina': 'ARG',
  'Algeria': 'ALG', 'Austria': 'AUT', 'Jordan': 'JOR', 'Portugal': 'POR',
  'DR Congo': 'COD', 'Uzbekistan': 'UZB', 'Colombia': 'COL', 'England': 'ENG',
  'Croatia': 'CRO', 'Ghana': 'GHA', 'Panama': 'PAN',
};

function nameToCode(name) {
  const trimmed = name.trim();
  return NAME_TO_CODE[trimmed] ?? trimmed.slice(0, 3).toUpperCase();
}

// ─── HTML parsing ─────────────────────────────────────────────────────────────

const CARD_TYPE_MAP = {
  'Red card':        'red',
  'Yellow card':     'yellow',
  'Yellow-Red card': 'yellow_red',
};

function parseTables(html) {
  const totals = {};

  const tableRe = /<table class="table">([\s\S]*?)<\/table>/g;
  for (const tableMatch of html.matchAll(tableRe)) {
    const tableHtml = tableMatch[1];

    // Identify card type from the last <th>
    const headerMatch = tableHtml.match(/<th[^>]*>(Red card|Yellow card|Yellow-Red card)<\/th>/);
    if (!headerMatch) continue;
    const cardType = CARD_TYPE_MAP[headerMatch[1]];

    // Each data row: team is in td.jsDivLineTeam > .js_div_particName > a
    //                count is in the last td.jsaligncenter
    const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
    for (const rowMatch of tableHtml.matchAll(rowRe)) {
      const rowHtml = rowMatch[1];
      if (rowHtml.includes('<th')) continue; // skip header row

      const teamMatch = rowHtml.match(
        /jsDivLineTeam[\s\S]*?js_div_particName[\s\S]*?<a[^>]*>([^<]+)<\/a>/
      );
      const countMatches = [...rowHtml.matchAll(/<td[^>]*jsaligncenter[^"]*"[^>]*>(\d+)<\/td>/g)];
      if (!teamMatch || !countMatches.length) continue;

      const count = parseInt(countMatches[countMatches.length - 1][1], 10);
      if (count === 0) continue;

      const code = nameToCode(teamMatch[1]);
      if (!totals[code]) totals[code] = { yellow: 0, red: 0, yellow_red: 0 };
      totals[code][cardType] += count;
    }
  }

  return totals;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching card data from myfootballfacts.com…');

  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wc2026-scraper/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const teamTotals = parseTables(html);
  const teamCount = Object.keys(teamTotals).length;
  if (teamCount === 0) throw new Error('No card data found — page structure may have changed');

  const outPath = join(__dirname, 'data/cards.json');
  const existing = JSON.parse(readFileSync(outPath, 'utf8'));

  const output = {
    ...existing,
    updated: new Date().toISOString().slice(0, 10),
    source: SOURCE_URL,
    teamTotals,
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`✓ Updated ${teamCount} teams in data/cards.json`);

  for (const [code, counts] of Object.entries(teamTotals)) {
    const parts = [];
    if (counts.yellow)     parts.push(`${counts.yellow}Y`);
    if (counts.red)        parts.push(`${counts.red}R`);
    if (counts.yellow_red) parts.push(`${counts.yellow_red}YR`);
    console.log(`  ${code}: ${parts.join(' ')}`);
  }
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
