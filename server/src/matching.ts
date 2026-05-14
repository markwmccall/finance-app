import jaroWinkler from 'jaro-winkler'

export const MATCH_CONFIDENCE_THRESHOLD = 0.50

export function normalizePayee(raw: string): string {
  let s = raw.toLowerCase()
  s = s.replace(/\bch(?:eck|k)\s*#?\s*\d+\b/g, '')
  s = s.replace(/\s*#\s*\d+/g, '')
  s = s.replace(/\s*\*+\s*/g, ' ')
  s = s.replace(/\s+-\s+/g, ' ')
  s = s.replace(/\b\d{3,}\b/g, '')
  return s.replace(/\s+/g, ' ').trim()
}

export interface MatchCandidate {
  id: number
  date: string
  payee: string
  amount: number
  check_number: string | null
}

export interface PlaidTxInput {
  date: string
  payee: string
  amount: number
  check_number: string | null
}

export interface MatchResult {
  transaction_id: number
  reason: 'check_number' | 'amount_date_payee'
  confidence: number | null
}

// Word-overlap weight: penalizes string-similar but word-different payees (e.g. 'walmart' vs 'target run').
function payeeSimilarity(a: string, b: string): number {
  const full = jaroWinkler(a, b)
  const wa = new Set(a.split(' '))
  const wb = new Set(b.split(' '))
  const intersect = [...wa].filter(w => wb.has(w)).length
  const overlap = intersect / Math.max(wa.size, wb.size)
  return full * (0.5 + 0.5 * overlap)
}

export function matchTransaction(
  plaid: PlaidTxInput,
  candidates: MatchCandidate[]
): MatchResult | null {
  if (plaid.check_number) {
    const hit = candidates.find(c => c.check_number === plaid.check_number)
    if (hit) return { transaction_id: hit.id, reason: 'check_number', confidence: null }
    return null
  }

  const plaidMs = new Date(plaid.date).getTime()
  const plaidNorm = normalizePayee(plaid.payee)
  let best: { candidate: MatchCandidate; score: number } | null = null

  for (const c of candidates) {
    const daysDiff = Math.abs((plaidMs - new Date(c.date).getTime()) / 86_400_000)
    if (daysDiff > 1.0) continue
    if (Math.abs(plaid.amount - c.amount) > 0.001) continue

    const score = payeeSimilarity(plaidNorm, normalizePayee(c.payee))
    if (score >= MATCH_CONFIDENCE_THRESHOLD && (!best || score > best.score)) {
      best = { candidate: c, score }
    }
  }

  if (best) {
    return { transaction_id: best.candidate.id, reason: 'amount_date_payee', confidence: best.score }
  }
  return null
}
