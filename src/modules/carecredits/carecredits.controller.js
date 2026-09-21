const svc = require('./carecredits.service')
const campayService = require('../payments/campay.service')
const pool = require('../../config/db')
const { sendReferralInviteEmail } = require('../mail/mail.service')

async function getMyWallet(req, res, next) {
  try {
    const wallet = await svc.getWallet(req.user.id)
    const transactions = await svc.getTransactions(req.user.id)
    const monthlyStats = await svc.getMonthlyStats(req.user.id)
    const referralCode = await svc.getOrCreateReferralCode(req.user.id)
    res.json({
      wallet,
      monthlyStats,
      referralCode: referralCode.code,
      transactions: transactions.slice(0, 20),
    })
  } catch (err) { next(err) }
}

async function validatePromo(req, res, next) {
  try {
    const { code } = req.body
    const result = await svc.validatePromoCode(code, req.user.id)
    res.json(result)
  } catch (err) { next(err) }
}

async function purchaseCredits(req, res, next) {
  try {
    const { credits, phoneNumber, providerName } = req.body
    const creditAmount = parseInt(credits, 10)
    if (!creditAmount || creditAmount <= 0 || creditAmount % svc.CC_CONFIG.CC_PER_PURCHASE_PACK !== 0) {
      return res.status(400).json({ error: `Credits must be a positive multiple of ${svc.CC_CONFIG.CC_PER_PURCHASE_PACK}.` })
    }
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required.' })

    const fcfaAmount = (creditAmount / svc.CC_CONFIG.CC_PER_PURCHASE_PACK) * svc.CC_CONFIG.FCFA_PER_PURCHASE_PACK
    const reference = `CC-${req.user.id.slice(0, 8)}-${Date.now()}`

    let campayResult
    try {
      campayResult = await campayService.collectPayment({
        amount: fcfaAmount,
        currency: 'XAF',
        phone: phoneNumber,
        description: `Carely CareCredit purchase: ${creditAmount} CC`,
        externalReference: reference,
      })
    } catch (gatewayErr) {
      return res.status(502).json({ error: gatewayErr.message || 'Payment gateway error.' })
    }

    const cleanPhone = String(phoneNumber).replace(/\D/g, '')
    const isSandbox = (
      cleanPhone.endsWith('000001') || cleanPhone.endsWith('000002') ||
      cleanPhone === '237670000001' || cleanPhone === '237690000001' ||
      cleanPhone === '237699000000' || cleanPhone === '237699123456' ||
      cleanPhone === '699123456'
    )

    if (campayResult.simulated && isSandbox) {
      await svc.addCreditsAfterPurchase(req.user.id, creditAmount, campayResult.reference)
      const wallet = await svc.getWallet(req.user.id)
      return res.json({
        message: `Sandbox: ${creditAmount} CC added to your wallet!`,
        confirmed: true,
        wallet,
        campayRef: campayResult.reference,
      })
    }

    res.json({
      message: 'Payment prompt sent to your phone. Authorize the payment.',
      confirmed: false,
      campayRef: campayResult.reference,
      ussdCode: campayResult.ussdCode,
      pendingCredits: creditAmount,
    })
  } catch (err) { next(err) }
}

async function verifyPurchase(req, res, next) {
  try {
    const { ref } = req.params
    const { pendingCredits } = req.query
    const creditAmount = parseInt(pendingCredits, 10)

    const result = await campayService.getTransactionStatus(ref)
    const statusUpper = String(result.status || '').toUpperCase()
    const isSuccess = ['SUCCESSFUL', 'COMPLETE', 'PAID', 'HELD_IN_ESCROW'].includes(statusUpper)

    if (isSuccess && creditAmount > 0) {
      await svc.addCreditsAfterPurchase(req.user.id, creditAmount, ref)
      const wallet = await svc.getWallet(req.user.id)
      return res.json({ confirmed: true, wallet })
    }
    res.json({ confirmed: false, status: result.status })
  } catch (err) { next(err) }
}

async function withdrawCredits(req, res, next) {
  try {
    const { credits, phoneNumber } = req.body
    const creditAmount = parseInt(credits, 10)
    if (!creditAmount || creditAmount <= 0 || creditAmount % svc.CC_CONFIG.CC_PER_WITHDRAWAL_PACK !== 0) {
      return res.status(400).json({ error: `Withdrawal must be a positive multiple of ${svc.CC_CONFIG.CC_PER_WITHDRAWAL_PACK} CC.` })
    }
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required.' })

    // 1. Validate balance without deducting yet
    const { fcfaAmount } = await svc.validateWithdrawal(req.user.id, creditAmount)

    // 2. Initiate Campay disbursement (Mass Payout API)
    const ref = `CW-${req.user.id.slice(0, 8)}-${Date.now()}`
    let payoutResult
    try {
      payoutResult = await campayService.disburseFunds({
        amount: fcfaAmount,
        currency: 'XAF',
        phone: phoneNumber,
        description: `Carely CareCredit withdrawal: ${creditAmount} CC -> ${fcfaAmount} FCFA`,
        externalReference: ref,
      })
    } catch (disbursErr) {
      console.error('[CareCred] Disburse failed — CC balance untouched:', disbursErr.message)
      return res.status(502).json({
        error: `Withdrawal payout failed: ${disbursErr.message}. Your CareCredits were not deducted.`,
      })
    }

    // 3. Only deduct credits after payout is confirmed
    const campayRef = payoutResult?.reference || ref
    await svc.deductCreditsForWithdrawal(req.user.id, creditAmount, campayRef)

    const wallet = await svc.getWallet(req.user.id)
    res.json({
      message: `Withdrawal of ${creditAmount} CC (${fcfaAmount} FCFA) sent to ${phoneNumber}.`,
      fcfaAmount,
      creditAmount,
      campayRef,
      wallet,
    })
  } catch (err) { next(err) }
}

async function sendInvites(req, res, next) {
  try {
    const { emails } = req.body
    if (!emails) {
      return res.status(400).json({ error: 'Please provide one or more email addresses.' })
    }

    // Support either an array of strings or comma/semicolon-separated string
    let emailList = []
    if (Array.isArray(emails)) {
      emailList = emails
    } else if (typeof emails === 'string') {
      emailList = emails.split(/[,;\n\s]+/).filter(Boolean)
    }

    // Normalize and validate email addresses
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const validEmails = Array.from(
      new Set(
        emailList
          .map(e => String(e).trim().toLowerCase())
          .filter(e => emailRegex.test(e))
      )
    )

    if (validEmails.length === 0) {
      return res.status(400).json({ error: 'No valid email addresses found. Please check and try again.' })
    }

    // Fetch sender user information for the greeting
    let referrerName = req.user.firstName || 'A friend'
    try {
      const userRes = await pool.query('SELECT first_name, last_name FROM users WHERE id = $1', [req.user.id])
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0]
        referrerName = [u.first_name, u.last_name].filter(Boolean).join(' ') || referrerName
      }
    } catch (dbErr) {
      console.warn('Could not query user name for referral invite:', dbErr.message)
    }

    // Get sender's unique referral code
    const referralCodeObj = await svc.getOrCreateReferralCode(req.user.id)
    const referralCode = referralCodeObj.code

    // Determine target login URL
    const origin = req.headers.origin || (process.env.NODE_ENV === 'production' ? 'https://carely-frontend-ytei.vercel.app' : 'http://localhost:5173')
    const loginUrl = `${origin}/login?ref=${encodeURIComponent(referralCode)}`

    // Send emails
    const sendResults = await Promise.allSettled(
      validEmails.map(to =>
        sendReferralInviteEmail({
          to,
          referrerName,
          referralCode,
          loginUrl,
        })
      )
    )

    const successful = sendResults.filter(r => r.status === 'fulfilled' && r.value?.sent).length

    res.json({
      success: true,
      sentCount: successful,
      totalCount: validEmails.length,
      message: `Successfully sent ${successful} invitation${successful === 1 ? '' : 's'}.`,
    })
  } catch (err) {
    next(err)
  }
}

module.exports = { getMyWallet, validatePromo, purchaseCredits, verifyPurchase, withdrawCredits, sendInvites }

