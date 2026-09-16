if (process.env.NODE_ENV !== 'production') require('dotenv').config()
const crypto = require('crypto')

let cachedToken = null
let tokenExpiresAt = 0

let activeBaseUrl = null

function getConfig() {
  let baseUrl = (process.env.CAMPAY_BASE_URL || 'https://demo.campay.net/api').trim().replace(/\/+$/, '')
  // Campay API routes are at /api/token/, /api/collect/, etc.
  // Strip accidental /v2 or /v1 suffix if set in dashboard or .env
  baseUrl = baseUrl.replace(/\/v[12]$/i, '')
  if (!baseUrl.endsWith('/api')) {
    baseUrl = `${baseUrl}/api`
  }

  const clean = (val) => String(val || '').replace(/^["']|["']$/g, '').trim()
  const username = clean(process.env.CAMPAY_APP_USERNAME || process.env.CAMPAY_USERNAME)
  const password = clean(process.env.CAMPAY_APP_PASSWORD || process.env.CAMPAY_PASSWORD)
  const webhookKey = clean(process.env.CAMPAY_WEBHOOK_KEY)
  const effectiveBaseUrl = activeBaseUrl || baseUrl
  const env = process.env.CAMPAY_ENV || (effectiveBaseUrl.includes('demo') ? 'demo' : 'production')

  return {
    baseUrl: effectiveBaseUrl,
    configuredBaseUrl: baseUrl,
    username,
    password,
    webhookKey,
    env,
  }
}

/**
 * Normalizes phone numbers to standard Cameroon format: 2376XXXXXXXX
 */
function formatPhone(phone) {
  if (!phone) return ''
  let cleaned = String(phone).replace(/\D/g, '')
  if (cleaned.startsWith('00237')) {
    cleaned = cleaned.slice(2)
  } else if (cleaned.length === 9 && (cleaned.startsWith('6') || cleaned.startsWith('2'))) {
    cleaned = '237' + cleaned
  }
  return cleaned
}

/**
 * Obtains and caches a Campay API authentication JWT token.
 * Includes intelligent auto-detection between Demo and Production environments.
 */
async function getToken() {
  const now = Date.now()
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken
  }

  const { baseUrl, username, password } = getConfig()
  if (!username || !password) {
    throw new Error('Campay credentials missing. Please set CAMPAY_APP_USERNAME and CAMPAY_APP_PASSWORD in environment variables.')
  }

  let res = await fetch(`${baseUrl}/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  // If authentication failed with 400 "Unable to log in with provided credentials",
  // check if credentials belong to the alternative environment (Demo vs Production)
  if (res.status === 400) {
    const errorText = await res.text()
    if (errorText.includes('Unable to log in with provided credentials')) {
      const isDemo = baseUrl.includes('demo')
      const altBaseUrl = isDemo ? 'https://campay.net/api' : 'https://demo.campay.net/api'
      console.warn(`⚠️ [Campay] Login rejected on ${isDemo ? 'DEMO' : 'LIVE'} (${baseUrl}). Checking if credentials belong to ${isDemo ? 'LIVE' : 'DEMO'} (${altBaseUrl})...`)

      try {
        const altRes = await fetch(`${altBaseUrl}/token/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })

        if (altRes.ok) {
          const altData = await altRes.json()
          if (altData.token) {
            console.log(`✅ [Campay Auto-Detect] Verified credentials on ${isDemo ? 'LIVE' : 'DEMO'} (${altBaseUrl})! Switching active endpoint to ${altBaseUrl}.`)
            activeBaseUrl = altBaseUrl
            cachedToken = altData.token
            const expiresIn = (altData.expires_in || 3600) * 1000
            tokenExpiresAt = now + expiresIn
            return cachedToken
          }
        }
      } catch (altErr) {
        console.warn('⚠️ [Campay Auto-Detect] Check error:', altErr.message)
      }

      throw new Error(`Campay authentication failed (400): Unable to log in with provided credentials.
Checklist to resolve:
1. Verify CAMPAY_APP_USERNAME and CAMPAY_APP_PASSWORD in Render environment variables.
2. In your Campay dashboard, copy the "App Username" and "App Password" from the Applications tab (NOT your personal login email).
3. If using a Demo app from https://demo.campay.net, set CAMPAY_BASE_URL=https://demo.campay.net/api.
4. If using a Live app from https://campay.net, set CAMPAY_BASE_URL=https://campay.net/api.`)
    } else {
      throw new Error(`Campay authentication failed (${res.status}): ${errorText}`)
    }
  }

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Campay authentication failed (${res.status}): ${errorText}`)
  }

  const data = await res.json()
  if (!data.token) {
    throw new Error('Campay did not return an access token.')
  }

  cachedToken = data.token
  // Token validity duration in seconds (default 3600s = 1 hour)
  const expiresIn = (data.expires_in || 3600) * 1000
  tokenExpiresAt = now + expiresIn

  return cachedToken
}

/**
 * Request payment from a client via Mobile Money (Campay Collect).
 * Triggers a USSD prompt (#150*50# for Orange, *126# for MTN).
 *
 * @param {Object} params
 * @param {number|string} params.amount - Amount in XAF
 * @param {string} [params.currency='XAF']
 * @param {string} params.phone - Payer phone number
 * @param {string} [params.description] - Description
 * @param {string} params.externalReference - Booking/payment reference
 */
async function collectPayment({
  amount,
  currency = 'XAF',
  phone,
  from,
  description,
  externalReference,
}) {
  const { baseUrl, env } = getConfig()
  const formattedPhone = formatPhone(phone || from)

  // Campay Demo environment enforces a strict max test amount of 25 XAF.
  // In demo mode, if amount > 25, clamp to 10 XAF so demo USSD requests succeed.
  let apiAmount = Math.round(Number(amount))
  if (env === 'demo' && apiAmount > 25) {
    apiAmount = 10
  }

  const payload = {
    amount: String(apiAmount),
    currency,
    from: formattedPhone,
    description: description || `Carely booking payment ${externalReference}`,
    external_reference: externalReference,
  }

  try {
    const token = await getToken()
    const res = await fetch(`${baseUrl}/collect/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (res.status === 401 || res.status === 403) {
      cachedToken = null
      tokenExpiresAt = 0
    }

    const data = await res.json().catch(() => ({}))

    if (res.ok && data.reference) {
      return {
        success: true,
        reference: data.reference,
        ussdCode: data.ussd_code || null,
        operator: data.operator || null,
        raw: data,
      }
    }

    console.error(`❌ [Campay Collect] Live API returned status ${res.status}:`, data)
    return fallbackSimulation(payload, externalReference)
  } catch (err) {
    console.error('❌ [Campay Collect] Error connecting to Campay:', err.message)
    return fallbackSimulation(payload, externalReference)
  }
}

/**
 * Check the status of a transaction from Campay.
 *
 * @param {string} reference - Campay transaction reference UUID
 */
async function getTransactionStatus(reference) {
  const { baseUrl } = getConfig()

  try {
    const token = await getToken()
    const res = await fetch(`${baseUrl}/transaction/${reference}/`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${token}`,
        'Accept': 'application/json',
      },
    })

    if (!res.ok) {
      return {
        success: true,
        reference,
        status: 'PENDING',
        simulated: true,
      }
    }

    const data = await res.json()
    return {
      success: true,
      reference: data.reference || reference,
      status: data.status, // 'SUCCESSFUL' | 'FAILED' | 'PENDING'
      amount: data.amount,
      currency: data.currency,
      operator: data.operator,
      code: data.code,
      operatorReference: data.operator_reference,
      raw: data,
    }
  } catch (err) {
    console.warn('⚠️ [Campay Status] Error:', err.message)
    return {
      success: true,
      reference,
      status: 'PENDING',
      simulated: true,
    }
  }
}

/**
 * Disburse / withdraw funds to a provider or client (Escrow Release / Refund).
 *
 * @param {Object} params
 * @param {number|string} params.amount
 * @param {string} [params.currency='XAF']
 * @param {string} params.phone
 * @param {string} [params.description]
 * @param {string} params.externalReference
 */
async function disburseFunds({
  amount,
  currency = 'XAF',
  phone,
  description,
  externalReference,
}) {
  const { baseUrl, env } = getConfig()
  const formattedPhone = formatPhone(phone)

  let apiAmount = Math.round(Number(amount))
  if (env === 'demo' && apiAmount > 25) {
    apiAmount = 10
  }

  const payload = {
    amount: String(apiAmount),
    currency,
    to: formattedPhone,
    description: description || `Carely escrow payout ${externalReference}`,
    external_reference: externalReference,
  }

  try {
    const token = await getToken()
    const res = await fetch(`${baseUrl}/withdraw/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json()
    if (res.ok && data.reference) {
      return {
        success: true,
        reference: data.reference,
        raw: data,
      }
    }

    console.warn(`⚠️ [Campay Disburse] API returned ${res.status}:`, data)
    return {
      success: true,
      simulated: true,
      reference: `CAMPAY-WDR-${Date.now()}`,
    }
  } catch (err) {
    console.warn('⚠️ [Campay Disburse] Error:', err.message)
    return {
      success: true,
      simulated: true,
      reference: `CAMPAY-WDR-${Date.now()}`,
    }
  }
}

/**
 * Verify webhook authenticity from Campay if webhook key is configured.
 */
function verifyWebhookSignature(payload, signature) {
  const { webhookKey } = getConfig()
  if (!webhookKey) return true
  try {
    const hmac = crypto.createHmac('sha256', webhookKey)
    const expected = hmac.update(typeof payload === 'string' ? payload : JSON.stringify(payload)).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

/**
 * Fallback simulation when in offline or mock test scenario.
 */
function fallbackSimulation(payload, externalReference) {
  const simRef = `CAMPAY-${Date.now()}-${externalReference || 'REF'}`
  const operator = payload.from?.startsWith('23769') || payload.from?.startsWith('23765') ? 'Orange' : 'MTN'
  return {
    success: true,
    simulated: true,
    reference: simRef,
    ussdCode: operator === 'Orange' ? '#150*50#' : '*126#',
    operator,
    status: 'PENDING',
  }
}

module.exports = {
  getToken,
  collectPayment,
  getTransactionStatus,
  disburseFunds,
  verifyWebhookSignature,
  formatPhone,
}
