import { techWords, words } from "@unclaimed/core";
import type { DomainRow } from "./store";

const WORD_RANK = new Map((words as string[]).map((word, index) => [word, index]));
const TOTAL_WORDS = (words as string[]).length;
const CURATED = new Set(words as string[]);
const NICHE = new Set(techWords as string[]);

const TLD_TIER: Record<string, number> = {
  com: 100,
  ai: 96,
  io: 92,
  co: 82,
  dev: 82,
  app: 80,
  sh: 70,
  run: 70,
  studio: 68,
  now: 66,
  store: 66,
  build: 64,
  link: 64,
  live: 64,
  pro: 64,
  space: 62,
  so: 62,
  xyz: 60,
  design: 60,
  tech: 60,
  cloud: 60,
  life: 60,
  art: 58,
  shop: 58,
  page: 56,
  music: 56,
  health: 56,
  fit: 56,
  food: 56,
  love: 56,
  ventures: 56,
  money: 56,
  fund: 54,
  capital: 54,
  finance: 54,
  blog: 54,
  media: 54,
  games: 54,
  world: 52,
  online: 52,
  site: 52,
  news: 52,
  video: 52,
  exchange: 52,
  club: 52,
  team: 52,
  works: 50,
  codes: 50,
  software: 50,
  network: 50,
  tools: 50,
  digital: 50,
  email: 50,
  wiki: 50,
  audio: 50,
  film: 50,
  show: 50,
  plus: 50,
  market: 50,
  agency: 50,
  fun: 50,
  systems: 48,
  trade: 48,
  group: 48,
  zone: 48,
  ink: 48,
  photos: 46,
  deals: 46,
  sale: 46,
  gifts: 46,
  expert: 46,
  guru: 44,
  md: 42,
};

export function isPluralWord(word: string): boolean {
  let singular = word;
  if (word.endsWith("ies") && word.length > 4) singular = `${word.slice(0, -3)}y`;
  else if (/(?:ses|xes|zes|ches|shes)$/.test(word)) singular = word.slice(0, -2);
  else if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
    singular = word.slice(0, -1);
  }
  return singular !== word;
}

export function isCuratedWord(word: string): boolean {
  return CURATED.has(word);
}

export function qualityScoreParts(word: string, tld: string): number {
  const index = WORD_RANK.get(word) ?? TOTAL_WORDS * 0.82;
  const wordScore = 100 * (1 - index / TOTAL_WORDS);
  return Math.round(wordScore * 0.55 + (TLD_TIER[tld] ?? 45) * 0.45);
}

export function commercialScoreParts(
  word: string,
  tld: string,
  premium: boolean | null,
  priced: boolean,
): number {
  let score = qualityScoreParts(word, tld);
  if (priced) score += premium ? -30 : 20;
  if (NICHE.has(word)) score += 15;
  if (word.length <= 5) score += 8;
  else if (word.length <= 7) score += 4;
  if (tld === "ai" || tld === "io" || tld === "to") score += 6;
  return Math.round(score);
}

export function qualityScore(row: DomainRow): number {
  return qualityScoreParts(row.word, row.tld);
}

export function commercialScore(row: DomainRow): number {
  return commercialScoreParts(
    row.word,
    row.tld,
    row.premium === null ? null : row.premium === 1,
    Boolean(row.priced_at),
  );
}
