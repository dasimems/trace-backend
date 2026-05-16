import { TransactionCategoryEnum } from '@prisma/client';

// Recipient-name → category heuristic. Matches against well-known Nigerian
// merchant counterparties so user-initiated transfers to e.g. Chowdeck land
// in FOOD_AND_DINING instead of the generic TRANSFER bucket.
//
// Matching is case-insensitive substring against the recipient *account name*
// (the verified bank name from the Squad lookup) and, as a secondary signal,
// the optional remark. First match wins, in declaration order — so put more
// specific patterns above general ones.
const PATTERNS: Array<{
  match: RegExp;
  category: TransactionCategoryEnum;
}> = [
  // Food delivery + restaurants
  {
    match: /\b(chowdeck|glovo|jumia\s*food|bolt\s*food|mr\.?\s*biggs|bukka\s*hut|jollof\s*republic|sweet\s*sensation|food\s*co|kfc|pizza\s*hut|chicken\s*republic|domino'?s)\b/i,
    category: TransactionCategoryEnum.FOOD_AND_DINING,
  },
  // Ride-hailing + fuel
  {
    match: /\b(bolt|uber|lagride|indrive|in\s*drive|nnpc|total\s*energies|total\s*nig|mobil|conoil|ardova|fuel)\b/i,
    category: TransactionCategoryEnum.TRANSPORT,
  },
  // Power + telecom + cable
  {
    match: /\b(ikedc|ekedc|aedc|phedc|kaedco|ibedc|jedp|portharcourt\s*disco|mtn(\s*nig)?|airtel|9mobile|glo\s*(mobile|nig)?|spectranet|smile|swift|tizeti|dstv|gotv|startimes|showmax|netflix|prime\s*video|youtube\s*premium|apple\s*one)\b/i,
    category: TransactionCategoryEnum.BILLS_AND_UTILITIES,
  },
  // E-commerce + retail
  {
    match: /\b(jumia|konga|jiji|shoprite|spar|justrite|game\s*store|sahad)\b/i,
    category: TransactionCategoryEnum.SHOPPING,
  },
  // Healthcare
  {
    match: /\b(reddington|lagoon\s*hospital|lifebrand|alpha\s*pharmacy|medplus|h-medix|emzor|hygeia|axa\s*mansard\s*health)\b/i,
    category: TransactionCategoryEnum.HEALTH,
  },
  // Education
  {
    match: /\b(university|polytechnic|college|school\s*fees|waec|jamb|neco|coursera|udemy)\b/i,
    category: TransactionCategoryEnum.EDUCATION,
  },
  // Entertainment + leisure
  {
    match: /\b(cinemas?|filmhouse|silverbird|genesis\s*cinemas|spotify|apple\s*music|tidal)\b/i,
    category: TransactionCategoryEnum.ENTERTAINMENT,
  },
  // Savings / investment platforms (treat as INVESTMENT, not TRANSFER)
  {
    match: /\b(piggyvest|cowrywise|risevest|bamboo|trove|chaka|chipper|kuda\s*save)\b/i,
    category: TransactionCategoryEnum.INVESTMENT,
  },
];

// Returns null when no pattern matches — caller decides what to fall back to
// (typically TransactionCategoryEnum.TRANSFER for outbound bank transfers).
export function inferTransferCategory(input: {
  accountName?: string | null;
  remark?: string | null;
}): TransactionCategoryEnum | null {
  const haystack = [input.accountName, input.remark]
    .filter((s): s is string => Boolean(s))
    .join(' ')
    .toLowerCase();
  if (!haystack) return null;
  for (const { match, category } of PATTERNS) {
    if (match.test(haystack)) return category;
  }
  return null;
}
