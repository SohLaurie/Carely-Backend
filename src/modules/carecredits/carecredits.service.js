const pool = require('../../config/db')

// ── MVP Configuration (centralized) ──────────────────────────────────────────
const CC_CONFIG = {
  FCFA_PER_PURCHASE_PACK: 5,
  CC_PER_PURCHASE_PACK: 20,
  CC_PER_WITHDRAWAL_PACK: 20,
  FCFA_PER_WITHDRAWAL_PACK: 5,
  CC_PER_BOOKING: 5,
  MIN_CC_FOR_EXPLORE: 5,
  REFERRAL_DISCOUNT_FCFA: 5,
  REFERRAL_REWARD_CC: 5,
}

module.exports.CC_CONFIG = CC_CONFIG

async function getOrCreateWallet(userId, client) {
  const db = client || pool
  const { rows } = await db.query(
    `INSERT INTO carecredit_wallets (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [userId]
  )
  return rows[0]
}

async function recordTransaction(userId, type, amount, opts, client) {
  const db = client || pool
  const { bookingId, referralId, campayRef, note } = opts || {}
  await db.query(
    `INSERT INTO carecredit_transactions
       (user_id, type, amount, booking_id, referral_id, payment_campay_ref, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, type, amount, bookingId || null, referralId || null, campayRef || null, note || null]
  )
}

async function getWallet(userId) {
  const wallet = await getOrCreateWallet(userId)
  const available = Math.max(0, wallet.balance - wallet.held)
  return {
    balance: wallet.balance,
    held: wallet.held,
    available,
    equivalentFcfa: +(wallet.balance * CC_CONFIG.FCFA_PER_WITHDRAWAL_PACK / CC_CONFIG.CC_PER_WITHDRAWAL_PACK).toFixed(2),
  }
}

async function getTransactions(userId) {
  const { rows } = await pool.query(
    `SELECT id, type, amount, booking_id, note, created_at
     FROM carecredit_transactions
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [userId]
  )
  return rows
}

async function getMonthlyStats(userId) {
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'REFERRAL_EARN' THEN amount ELSE 0 END), 0) AS earned,
       COALESCE(SUM(CASE WHEN type = 'JOB_DEDUCT' THEN ABS(amount) ELSE 0 END), 0) AS consumed_month
     FROM carecredit_transactions WHERE user_id = $1 AND created_at >= $2`,
    [userId, firstOfMonth]
  )
  return rows[0]
}

async function addCreditsAfterPurchase(userId, creditAmount, campayRef) {
  if (creditAmount <= 0 || creditAmount % CC_CONFIG.CC_PER_PURCHASE_PACK !== 0) {
    const err = new Error(`Credits must be a positive multiple of ${CC_CONFIG.CC_PER_PURCHASE_PACK}.`)
    err.status = 400; throw err
  }
  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')
    await getOrCreateWallet(userId, dbClient)
    await dbClient.query(
      `UPDATE carecredit_wallets SET balance = balance + $1, updated_at = now() WHERE user_id = $2`,
      [creditAmount, userId]
    )
    await recordTransaction(userId, 'PURCHASE', creditAmount, {
      campayRef, note: `Purchased ${creditAmount} CC`
    }, dbClient)
    await dbClient.query('COMMIT')
  } catch (err) { await dbClient.query('ROLLBACK'); throw err }
  finally { dbClient.release() }
}

async function deductCreditsForWithdrawal(userId, creditAmount, campayRef) {
  if (creditAmount <= 0 || creditAmount % CC_CONFIG.CC_PER_WITHDRAWAL_PACK !== 0) {
    const err = new Error(`Withdrawal must be a multiple of ${CC_CONFIG.CC_PER_WITHDRAWAL_PACK} CC.`)
    err.status = 400; throw err
  }
  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')
    const wallet = await getOrCreateWallet(userId, dbClient)
    const available = wallet.balance - wallet.held
    if (available < creditAmount) {
      const err = new Error(`Insufficient available credits. You have ${available} CC available.`)
      err.status = 400; throw err
    }
    await dbClient.query(
      `UPDATE carecredit_wallets SET balance = balance - $1, updated_at = now() WHERE user_id = $2`,
      [creditAmount, userId]
    )
    const fcfaAmount = (creditAmount / CC_CONFIG.CC_PER_WITHDRAWAL_PACK) * CC_CONFIG.FCFA_PER_WITHDRAWAL_PACK
    await recordTransaction(userId, 'WITHDRAWAL', -creditAmount, {
      campayRef, note: `Withdrew ${creditAmount} CC -> ${fcfaAmount} FCFA`
    }, dbClient)
    await dbClient.query('COMMIT')
    return { fcfaAmount }
  } catch (err) { await dbClient.query('ROLLBACK'); throw err }
  finally { dbClient.release() }
}

async function holdCreditsForBooking(providerId, bookingId) {
  const cost = CC_CONFIG.CC_PER_BOOKING
  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')
    const wallet = await getOrCreateWallet(providerId, dbClient)
    const available = wallet.balance - wallet.held
    if (available < cost) {
      console.warn(`[CareCred] Provider ${providerId} has only ${available} available CC (needs ${cost}).`)
    }
    await dbClient.query(
      `UPDATE carecredit_wallets SET held = held + $1, updated_at = now() WHERE user_id = $2`,
      [cost, providerId]
    )
    await recordTransaction(providerId, 'JOB_HOLD', -cost, {
      bookingId, note: `${cost} CC held for booking`
    }, dbClient)
    await dbClient.query('COMMIT')
  } catch (err) { await dbClient.query('ROLLBACK'); throw err }
  finally { dbClient.release() }
}

async function consumeHeldCredits(providerId, bookingId) {
  const cost = CC_CONFIG.CC_PER_BOOKING
  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')
    await getOrCreateWallet(providerId, dbClient)
    await dbClient.query(
      `UPDATE carecredit_wallets
       SET balance = GREATEST(0, balance - $1), held = GREATEST(0, held - $1), updated_at = now()
       WHERE user_id = $2`,
      [cost, providerId]
    )
    await recordTransaction(providerId, 'JOB_DEDUCT', -cost, {
      bookingId, note: `${cost} CC consumed for activated booking`
    }, dbClient)
    await dbClient.query('COMMIT')
  } catch (err) { await dbClient.query('ROLLBACK'); throw err }
  finally { dbClient.release() }
}

async function refundHeldCredits(providerId, bookingId) {
  const cost = CC_CONFIG.CC_PER_BOOKING
  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')
    const { rows: holdRows } = await dbClient.query(
      `SELECT id FROM carecredit_transactions WHERE user_id = $1 AND booking_id = $2 AND type = 'JOB_HOLD' LIMIT 1`,
      [providerId, bookingId]
    )
    if (holdRows.length === 0) { await dbClient.query('ROLLBACK'); return }
    const { rows: deductRows } = await dbClient.query(
      `SELECT id FROM carecredit_transactions WHERE user_id = $1 AND booking_id = $2 AND type = 'JOB_DEDUCT' LIMIT 1`,
      [providerId, bookingId]
    )
    if (deductRows.length > 0) { await dbClient.query('ROLLBACK'); return }
    await dbClient.query(
      `UPDATE carecredit_wallets SET held = GREATEST(0, held - $1), updated_at = now() WHERE user_id = $2`,
      [cost, providerId]
    )
    await recordTransaction(providerId, 'JOB_REFUND', cost, {
      bookingId, note: `${cost} CC released - booking cancelled`
    }, dbClient)
    await dbClient.query('COMMIT')
  } catch (err) { await dbClient.query('ROLLBACK'); throw err }
  finally { dbClient.release() }
}

async function addReferralReward(bookingId) {
  const reward = CC_CONFIG.REFERRAL_REWARD_CC
  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')
    const { rows: refRows } = await dbClient.query(
      `SELECT * FROM referrals WHERE booking_id = $1 AND status = 'pending'`,
      [bookingId]
    )
    if (refRows.length === 0) { await dbClient.query('ROLLBACK'); return }
    const referral = refRows[0]
    await dbClient.query(
      `UPDATE referrals SET status = 'successful', updated_at = now() WHERE id = $1`,
      [referral.id]
    )
    const referrerId = referral.referrer_id
    await getOrCreateWallet(referrerId, dbClient)
    await dbClient.query(
      `UPDATE carecredit_wallets SET balance = balance + $1, updated_at = now() WHERE user_id = $2`,
      [reward, referrerId]
    )
    await recordTransaction(referrerId, 'REFERRAL_EARN', reward, {
      referralId: referral.id, bookingId,
      note: `+${reward} CC referral reward`
    }, dbClient)
    await dbClient.query('COMMIT')
  } catch (err) {
    await dbClient.query('ROLLBACK')
    console.warn('[CareCred] addReferralReward error:', err.message)
  } finally { dbClient.release() }
}

async function getOrCreateReferralCode(userId) {
  const { rows: existing } = await pool.query(
    `SELECT * FROM referral_codes WHERE owner_id = $1 AND is_active = true`,
    [userId]
  )
  if (existing.length > 0) return existing[0]
  const { rows: userRows } = await pool.query(
    `SELECT first_name, last_name FROM users WHERE id = $1`, [userId]
  )
  const user = userRows[0] || {}
  const prefix = `${(user.first_name || 'U')[0]}${(user.last_name || 'U')[0]}`.toUpperCase()
  const suffix = Math.random().toString(36).substring(2, 7).toUpperCase()
  const code = `${prefix}${suffix}`
  const { rows: [newCode] } = await pool.query(
    `INSERT INTO referral_codes (code, owner_id) VALUES ($1, $2)
     ON CONFLICT (owner_id) DO UPDATE SET is_active = true RETURNING *`,
    [code, userId]
  )
  return newCode
}

async function validatePromoCode(code, bookerId) {
  if (!code || !code.trim()) return { valid: false, reason: 'No code provided.' }
  const cleanCode = code.trim().toUpperCase()
  const { rows: codeRows } = await pool.query(
    `SELECT * FROM referral_codes WHERE code = $1 AND is_active = true`, [cleanCode]
  )
  if (codeRows.length === 0) return { valid: false, reason: 'Invalid or expired promo code.' }
  const rc = codeRows[0]
  if (rc.owner_id === bookerId) return { valid: false, reason: 'You cannot use your own referral code.' }
  const { rows: usedRows } = await pool.query(
    `SELECT id FROM referrals WHERE referee_id = $1 AND status IN ('pending', 'successful')`, [bookerId]
  )
  if (usedRows.length > 0) return { valid: false, reason: 'You have already used a referral promotion.' }
  return {
    valid: true,
    discountFcfa: CC_CONFIG.REFERRAL_DISCOUNT_FCFA,
    referralCodeId: rc.id,
    referrerId: rc.owner_id,
    code: cleanCode,
  }
}

async function applyPromoToBooking(bookingId, bookerId, referralCodeId, referrerId) {
  try {
    await pool.query(
      `INSERT INTO referrals (referral_code_id, referrer_id, referee_id, booking_id, status)
       VALUES ($1, $2, $3, $4, 'pending') ON CONFLICT (referee_id) DO NOTHING`,
      [referralCodeId, referrerId, bookerId, bookingId]
    )
  } catch (err) { console.warn('[CareCred] applyPromoToBooking error:', err.message) }
}

module.exports = {
  CC_CONFIG,
  getWallet,
  getTransactions,
  getMonthlyStats,
  addCreditsAfterPurchase,
  deductCreditsForWithdrawal,
  holdCreditsForBooking,
  consumeHeldCredits,
  refundHeldCredits,
  addReferralReward,
  getOrCreateReferralCode,
  validatePromoCode,
  applyPromoToBooking,
}
