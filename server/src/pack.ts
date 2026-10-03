import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { normalizeVi } from '@wealthcompass/core';

export interface BlockedTopic {
  id: string;
  refusal: string;
  patterns: RegExp[];
}

export interface DomainPack {
  name: string;
  locale: string;
  glossary: string[][]; // nhóm từ đồng nghĩa, đã chuẩn hóa
  topics: BlockedTopic[];
  refusals: Record<string, string>;
  systemPrompt: string;
}

function parseSections(markdown: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of markdown.split(/^## /m).slice(1)) {
    const [head, ...rest] = block.split('\n');
    out[head.trim()] = rest.join('\n').trim();
  }
  return out;
}

export function loadPack(dir: string): DomainPack {
  const meta = parse(readFileSync(join(dir, 'pack.yaml'), 'utf8')) as { name: string; locale: string };
  const glossary = parse(readFileSync(join(dir, 'glossary.yaml'), 'utf8')) as { groups: string[][] };
  const topics = parse(readFileSync(join(dir, 'topics.yaml'), 'utf8')) as {
    topics: Array<{ id: string; refusal: string; patterns: string[] }>;
  };
  return {
    name: meta.name,
    locale: meta.locale,
    glossary: glossary.groups.map((g) => g.map(normalizeVi)),
    topics: topics.topics.map((t) => ({ id: t.id, refusal: t.refusal, patterns: t.patterns.map((p) => new RegExp(p)) })),
    refusals: parseSections(readFileSync(join(dir, 'refusals.vi.md'), 'utf8')),
    systemPrompt: readFileSync(join(dir, 'prompt.vi.md'), 'utf8'),
  };
}
