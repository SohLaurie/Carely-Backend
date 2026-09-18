// Load .env first, always (override ensures latest values on server restarts)
require('dotenv').config({ override: true })
const crypto = require('crypto')

let cachedToken = null
let tokenExpiresAt = 0

// Initialize activeBaseUrl directly from environment variable at module load time
// This prevents falling back to the LIVE URL default when CAMPAY_BASE_URL is set to demo
let activeBaseUrl = (process.env.CAMPAY_BASE_URL || '').trim() || null

function getConfig() {
  let baseUrl = (process.env.CAMPAY_BASE_URL || 'https://campay.net/api').trim().replace(/\/+$/, '')
  // Campay API routes are at /api/token/, /api/collect/, etc.
  // Strip accidental /v2 or /v1 suffix if set in dashboard or .env
  baseUrl = baseUrl.replace(/\/v[12]$/i, '')
  if (!baseUrl.endsWith('/api')) {
    baseUrl = `${baseUrl}/api`
  }

  const clean = (val) => String(val || '').replace(/^["']|["']$/g, '').trim()
  const username = clean(process.env.CAMPAY_APP_USERNAME || process.env.CAMPAY_USERNAME || 'vNnxaM3iJq26fcEUIzuhn-UmehGGYKXBR4iYmMOX9T-yCtUvFqwiaYiuR6jHZp-CplWcsOhPFIPvY_Z43O0KhQ')
  const password = clean(process.env.CAMPAY_APP_PASSWORD || process.env.CAMPAY_PASSWORD || '7H1R5KS805QKoiPI9yH1HYNkCMuFe7ljjCJQCPaff0Cb8e0PDAID8WQocycVPCiV5JF0Y9tLqsCowyP44umdbg')
  const permanentToken = clean(process.env.CAMPAY_TOKEN || process.env.CAMPAY_API_KEY || process.env.CAMPAY_APP_TOKEN)
  const webhookKey = clean(process.env.CAMPAY_WEBHOOK_KEY)
  const effectiveBaseUrl = activeBaseUrl || baseUrl
  const env = process.env.CAMPAY_ENV || (effectiveBaseUrl.includes('demo') ? 'demo' : 'production')


  return {
    baseUrl: effectiveBaseUrl,
    configuredBaseUrl: baseUrl,
    username,
    password,
    permanentToken,
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

  const { baseUrl, username, password, permanentToken } = getConfig()

  // 1. Permanent access token takes precedence if configured directly
  if (permanentToken) {
    cachedToken = permanentToken
    tokenExpiresAt = now + 86400000 * 365
    return cachedToken
  }

  if (!username || !password) {
    throw new Error('Campay credentials missing. Please set CAMPAY_APP_USERNAME and CAMPAY_APP_PASSWORD in environment variables (or CAMPAY_TOKEN for permanent token).')
  }

  let res = await fetch(`${baseUrl}/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  // If authentication failed on the configured URL (400, 401, 403, 404, etc.),
  // check if credentials belong to the alternative environment (Demo vs Production).
  if (!res.ok) {
    const errorText = await res.text()
    const isCredentialError = res.status === 400 && errorText.includes('Unable to log in with provided credentials')
    const isEndpointError = res.status === 404 || res.status === 401 || res.status === 403
    const shouldTryAlt = isCredentialError || isEndpointError

    if (shouldTryAlt) {
      const isDemo = baseUrl.includes('demo')
      const altBaseUrl = isDemo ? 'https://campay.net/api' : 'https://demo.campay.net/api'
      console.warn(`⚠️ [Campay] Auth failed (${res.status}) on ${isDemo ? 'DEMO' : 'LIVE'} (${baseUrl}). Trying ${isDemo ? 'LIVE' : 'DEMO'} (${altBaseUrl})...`)

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
    }

    throw new Error(`Campay authentication failed (${res.status}): ${errorText.slice(0, 300)}
------
Fix: Go to your Render dashboard → Environment → add these variables:
  CAMPAY_BASE_URL = https://demo.campay.net/api
  CAMPAY_ENV = demo
  CAMPAY_USERNAME = <your demo app username>
  CAMPAY_PASSWORD = <your demo app password>`)
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
  const formattedPhone = formatPhone(phone || from)

  const isSandboxNumber = (
    formattedPhone.endsWith('000001') ||
    formattedPhone.endsWith('000002') ||
    formattedPhone === '237670000001' ||
    formattedPhone === '237690000001' ||
    formattedPhone === '237699000000' ||
    formattedPhone === '237699123456' ||
    formattedPhone === '699123456'
  )

  // Campay Demo environment enforces a strict max test amount of 25 XAF.
  // In demo mode, if amount > 25, clamp to 10 XAF so demo USSD requests succeed.
  let apiAmount = Math.round(Number(amount))
  const currentConfig = getConfig()
  if (currentConfig.env === 'demo' && apiAmount > 25) {
    apiAmount = 10
  }

  const payload = {
    amount: String(apiAmount),
    currency,
    from: formattedPhone,
    description: description || `Carely booking payment ${externalReference}`,
    external_reference: externalReference,
  }

  // ONLY use fallback simulation if an explicit sandbox test number is used in non-production/demo
  if (isSandboxNumber && (process.env.NODE_ENV !== 'production' || currentConfig.env === 'demo')) {
    console.log(`🧪 [Campay Collect] Sandbox phone ${formattedPhone} detected in ${currentConfig.env} mode — using sandbox simulation.`)
    return fallbackSimulation(payload, externalReference)
  }

  // REAL PAYMENT: Must dispatch live USSD via Campay API. NEVER silently simulate!
  // Always obtain token first so auto-detect can determine activeBaseUrl (Demo vs Live)
  let token = await getToken()
  let { baseUrl, env } = getConfig()

  console.log(`📡 [Campay Collect] Calling ${baseUrl}/collect/ | env=${env} | phone=${payload.from} | amount=${payload.amount}`)

  let res = await fetch(`${baseUrl}/collect/`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  // If token rejected with 401 Invalid Token, switch activeBaseUrl and auto-retry with fresh token
  if (res.status === 401 || res.status === 403) {
    cachedToken = null
    tokenExpiresAt = 0

    const isDemo = baseUrl.includes('demo')
    const altBaseUrl = isDemo ? 'https://campay.net/api' : 'https://demo.campay.net/api'
    console.warn(`⚠️ [Campay Collect] Token rejected (401) on ${baseUrl}. Attempting auto-retry on ${altBaseUrl}...`)

    try {
      activeBaseUrl = altBaseUrl
      token = await getToken()
      baseUrl = altBaseUrl

      res = await fetch(`${baseUrl}/collect/`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (retryErr) {
      console.warn('⚠️ [Campay Collect] Alternate endpoint retry failed:', retryErr.message)
    }
  }

  const data = await res.json().catch(() => ({}))

  // Log the full response so we can diagnose in production
  console.log(`📨 [Campay Collect] HTTP ${res.status} response:`, JSON.stringify(data))

  if (res.ok && data.reference) {
    console.log(`✅ [Campay Collect] SUCCESS — ref=${data.reference} | operator=${data.operator} | ussd_code=${data.ussd_code || 'none'}`)
    return {
      success: true,
      reference: data.reference,
      ussdCode: data.ussd_code || null,
      operator: data.operator || null,
      raw: data,
    }
  }

  const errorMsg = data.message || data.description || data.detail || (typeof data === 'object' && Object.keys(data).length > 0 ? JSON.stringify(data) : `HTTP ${res.status}`)
  console.error(`❌ [Campay Collect] API rejected request on ${baseUrl} (${res.status}):`, errorMsg)
  const err = new Error(`Campay payment error (${res.status}): ${errorMsg}`)
  err.status = res.status >= 400 && res.status < 500 ? 400 : 502
  err.details = data
  throw err
}

/**
 * Check the status of a transaction from Campay.
 *
 * @param {string} reference - Campay transaction reference UUID
 */
async function getTransactionStatus(reference) {
  // If this was a simulated reference (e.g. sandbox testing), auto-confirm after 4 seconds
  if (String(reference).startsWith('CAMPAY-')) {
    const parts = String(reference).split('-')
    const ts = Number(parts[1]) || 0
    const elapsed = Date.now() - ts
    const isReady = elapsed > 4000
    return {
      success: true,
      reference,
      status: isReady ? 'SUCCESSFUL' : 'PENDING',
      simulated: true,
    }
  }

  try {
    const token = await getToken()
    const { baseUrl, env } = getConfig()
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
      }
    }

    const data = await res.json()
    const status = data.status // 'SUCCESSFUL' | 'FAILED' | 'PENDING'
    // Status is taken directly from Campay — real USSD payment required to reach SUCCESSFUL

    return {
      success: true,
      reference: data.reference || reference,
      status, // 'SUCCESSFUL' | 'FAILED' | 'PENDING'
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
  const formattedPhone = formatPhone(phone)

  const isSandboxNumber = (
    formattedPhone.endsWith('000001') ||
    formattedPhone.endsWith('000002') ||
    formattedPhone === '237670000001' ||
    formattedPhone === '237690000001'
  )

  const currentConfig = getConfig()
  let apiAmount = Math.round(Number(amount))
  if (currentConfig.env === 'demo' && apiAmount > 25) {
    apiAmount = 10
  }

  const payload = {
    amount: String(apiAmount),
    currency,
    to: formattedPhone,
    description: description || `Carely escrow payout ${externalReference}`,
    external_reference: externalReference,
  }

  // Sandbox simulation in non-production
  if (isSandboxNumber && (process.env.NODE_ENV !== 'production' || currentConfig.env === 'demo')) {
    return {
      success: true,
      simulated: true,
      reference: `CAMPAY-WDR-${Date.now()}`,
    }
  }

  let token = await getToken()
  let { baseUrl, env } = getConfig()

  let res = await fetch(`${baseUrl}/withdraw/`, {
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

    const isDemo = baseUrl.includes('demo')
    const altBaseUrl = isDemo ? 'https://campay.net/api' : 'https://demo.campay.net/api'
    console.warn(`⚠️ [Campay Disburse] Token rejected (401) on ${baseUrl}. Attempting auto-retry on ${altBaseUrl}...`)

    try {
      activeBaseUrl = altBaseUrl
      token = await getToken()
      baseUrl = altBaseUrl

      res = await fetch(`${baseUrl}/withdraw/`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (retryErr) {
      console.warn('⚠️ [Campay Disburse] Alternate endpoint retry failed:', retryErr.message)
    }
  }

  const data = await res.json().catch(() => ({}))
  if (res.ok && data.reference) {
    return {
      success: true,
      reference: data.reference,
      raw: data,
    }
  }

  const errorMsg = data.message || data.description || data.detail || (typeof data === 'object' && Object.keys(data).length > 0 ? JSON.stringify(data) : `HTTP ${res.status}`)
  console.error(`❌ [Campay Disburse] API rejected withdrawal on ${baseUrl} (${res.status}):`, errorMsg)
  const err = new Error(`Campay payout error (${res.status}): ${errorMsg}`)
  err.status = res.status >= 400 && res.status < 500 ? 400 : 502
  throw err
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

/**
 * Safe diagnostic status checker for Campay connectivity and environment variables.
 * Masks credentials for safe public visibility while providing debugging insight.
 */
async function checkCampayStatus() {
  const config = getConfig()
  const mask = (val) => {
    if (!val) return 'NOT_SET'
    if (val.length <= 8) return '****'
    return `${val.slice(0, 4)}...${val.slice(-4)} (${val.length} chars)`
  }

  const result = {
    configuredBaseUrl: config.configuredBaseUrl,
    activeBaseUrl: config.baseUrl,
    environment: config.env,
    hasUsername: Boolean(config.username),
    usernameMasked: mask(config.username),
    hasPassword: Boolean(config.password),
    passwordMasked: mask(config.password),
    hasToken: Boolean(config.permanentToken),
    tokenMasked: mask(config.permanentToken),
    hasWebhookKey: Boolean(config.webhookKey),
    tokenStatus: null,
    apiVerification: null,
  }

  try {
    const token = await getToken()
    const { baseUrl } = getConfig()
    result.activeBaseUrl = baseUrl
    result.tokenStatus = 'SUCCESS'
    result.tokenPreview = `${token.slice(0, 8)}... (${token.length} chars)`

    // Verify token against /balance/
    try {
      const verifyRes = await fetch(`${baseUrl}/balance/`, {
        headers: { 'Authorization': `Token ${token}` }
      })
      const verifyData = await verifyRes.json().catch(() => ({}))
      result.apiVerification = {
        endpoint: `${baseUrl}/balance/`,
        httpStatus: verifyRes.status,
        valid: verifyRes.ok,
        details: verifyRes.ok ? 'Token authorized' : (verifyData.detail || verifyData.message || `HTTP ${verifyRes.status}`),
      }
    } catch (verErr) {
      result.apiVerification = { error: verErr.message }
    }
  } catch (err) {
    result.tokenStatus = 'FAILED'
    result.tokenError = err.message
  }

  return result
}

module.exports = {
  getToken,
  collectPayment,
  getTransactionStatus,
  disburseFunds,
  verifyWebhookSignature,
  formatPhone,
  checkCampayStatus,
}
