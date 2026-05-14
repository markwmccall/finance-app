import { normalizePayee, matchTransaction, MATCH_CONFIDENCE_THRESHOLD } from '../matching'

describe('normalizePayee', () => {
  test('lowercases input', () => {
    expect(normalizePayee('KROGER')).toBe('kroger')
  })

  test('strips trailing merchant code: KROGER #0412 → kroger', () => {
    expect(normalizePayee('KROGER #0412')).toBe('kroger')
  })

  test('strips asterisk separator: AT&T *DIRECT → at&t direct', () => {
    expect(normalizePayee('AT&T *DIRECT')).toBe('at&t direct')
  })

  test('strips check number pattern CHECK #1042', () => {
    expect(normalizePayee('Payment CHECK #1042')).toBe('payment')
  })

  test('strips chk pattern: Bill Pay CHK 1042 → bill pay', () => {
    expect(normalizePayee('Bill Pay CHK 1042')).toBe('bill pay')
  })

  test('strips standalone 3+ digit sequences', () => {
    expect(normalizePayee('Store 12345')).toBe('store')
  })

  test('collapses whitespace and trims', () => {
    expect(normalizePayee('  Target   Run  ')).toBe('target run')
  })

  test('passes through clean payee', () => {
    expect(normalizePayee('Netflix')).toBe('netflix')
  })
})

describe('MATCH_CONFIDENCE_THRESHOLD', () => {
  test('is 0.50', () => {
    expect(MATCH_CONFIDENCE_THRESHOLD).toBe(0.50)
  })
})

describe('matchTransaction', () => {
  const targetRun = {
    id: 1,
    date: '2026-05-07',
    payee: 'Target Run',
    amount: -43.22,
    check_number: null as string | null,
  }

  test('matches by check_number (exact)', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'AT&T', amount: -125.00, check_number: '1042' },
      [{ id: 1, date: '2026-05-07', payee: 'AT&T Bill Pay', amount: -125.00, check_number: '1042' }]
    )
    expect(result).not.toBeNull()
    expect(result?.reason).toBe('check_number')
    expect(result?.confidence).toBeNull()
    expect(result?.transaction_id).toBe(1)
  })

  test('no match when candidate check_number differs', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'AT&T', amount: -125.00, check_number: '1042' },
      [{ id: 1, date: '2026-05-07', payee: 'AT&T Bill Pay', amount: -125.00, check_number: '9999' }]
    )
    expect(result).toBeNull()
  })

  test('no match when plaid has check_number but no candidate has one (all null)', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'AT&T', amount: -125.00, check_number: '1042' },
      [{ id: 1, date: '2026-05-08', payee: 'AT&T', amount: -125.00, check_number: null }]
    )
    expect(result).toBeNull()
  })

  test('matches by amount + date + payee similarity', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'Target', amount: -43.22, check_number: null },
      [targetRun]
    )
    expect(result).not.toBeNull()
    expect(result?.reason).toBe('amount_date_payee')
    expect(result?.confidence).toBeGreaterThanOrEqual(0.50)
    expect(result?.transaction_id).toBe(1)
  })

  test('no match when date difference > 1 day', () => {
    const result = matchTransaction(
      { date: '2026-05-10', payee: 'Target', amount: -43.22, check_number: null },
      [targetRun] // date: 2026-05-07, diff = 3 days
    )
    expect(result).toBeNull()
  })

  test('no match when amount differs by more than 0.001', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'Target', amount: -50.00, check_number: null },
      [targetRun]
    )
    expect(result).toBeNull()
  })

  test('no match when payee similarity < threshold', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'Walmart', amount: -43.22, check_number: null },
      [targetRun] // 'walmart' vs 'target run' → low similarity
    )
    expect(result).toBeNull()
  })

  test('picks highest confidence among multiple candidates', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'Target', amount: -43.22, check_number: null },
      [
        { id: 1, date: '2026-05-07', payee: 'Target Run', amount: -43.22, check_number: null },
        { id: 2, date: '2026-05-08', payee: 'Target', amount: -43.22, check_number: null },
      ]
    )
    // 'target' vs 'target' = 1.0 > 'target' vs 'target run'
    expect(result?.transaction_id).toBe(2)
  })

  test('check_number takes priority when both candidates could match', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'AT&T', amount: -125.00, check_number: '1042' },
      [
        { id: 1, date: '2026-05-07', payee: 'AT&T Bill Pay', amount: -125.00, check_number: '1042' },
        { id: 2, date: '2026-05-08', payee: 'AT&T', amount: -125.00, check_number: null },
      ]
    )
    expect(result?.reason).toBe('check_number')
    expect(result?.transaction_id).toBe(1)
  })
})
