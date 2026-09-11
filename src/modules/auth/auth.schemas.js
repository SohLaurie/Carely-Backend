const { z } = require('zod')

const passwordSchema = z
  .string()
  .min(6, 'Password must be at least 6 characters')

// ── Client Registration ────────────────────────────────────────────────────────
const registerClientSchema = z.object({
  firstName:     z.string().min(1, 'First name is required'),
  lastName:      z.string().min(1, 'Last name is required'),
  email:         z.string().email('Invalid email address'),
  phone:         z.string().min(6, 'Phone number must be at least 6 digits'),
  password:      passwordSchema,
  city:          z.string().optional().nullable(),
  householdSize: z.union([z.number(), z.string().transform(v => parseInt(v) || null)]).optional().nullable(),
  childrenAges:  z.array(z.number().int().min(0)).optional().nullable(),
  careNeeds:     z.union([
                   z.array(z.string()),
                   z.string().transform(s => (s ? s.split(',').map(x => x.trim()) : []))
                 ]).optional().nullable(),
})

// ── Provider Registration ──────────────────────────────────────────────────────
const registerProviderSchema = z.object({
  // Account fields
  firstName:      z.string().min(1).optional(),
  lastName:       z.string().min(1).optional(),
  email:          z.string().email().optional(),
  phone:          z.string().min(6).optional(),
  password:       passwordSchema.optional(),
  // Step 1 — Personal info
  dateOfBirth:    z.string().optional().nullable(),
  gender:         z.string().optional().nullable(),
  city:           z.string().optional().nullable(),
  address:        z.string().optional().nullable(),
  // Step 2 — Services
  profession:     z.string().optional().nullable(),
  specialties:    z.union([
                    z.array(z.string()),
                    z.string().transform(s => (s ? [s] : ['other']))
                  ]).optional().default(['other']),
  // Step 3 — Experience
  experience:     z.string().optional().nullable(),
  experienceYrs:  z.union([z.number(), z.string().transform(v => parseInt(v) || 0)]).optional().nullable(),
  bio:            z.string().optional().nullable(),
  // Step 4 — Availability
  availableDays:  z.any().optional().nullable(),
  availableFrom:  z.string().optional().nullable(),
  availableTo:    z.string().optional().nullable(),
  // Step 5 — Location & Transport
  location:       z.string().optional().nullable(),
  serviceArea:    z.string().optional().nullable(),
  serviceRadius:  z.string().optional().nullable(),
  // Step 6 — Qualifications & Documents
  certifications: z.union([z.array(z.string()), z.string().transform(s => (s ? [s] : []))]).optional().nullable(),
  languages:      z.union([z.array(z.string()), z.string().transform(s => (s ? s.split(',').map(x => x.trim()) : []))]).optional().nullable(),
  idDocumentUrl:       z.string().optional().nullable(),
  idDocumentName:      z.string().optional().nullable(),
  policeClearanceUrl:  z.string().optional().nullable(),
  policeClearanceName: z.string().optional().nullable(),
  certificateUrl:      z.string().optional().nullable(),
  certificateName:     z.string().optional().nullable(),
  // Step 7 — Profile & References
  referenceName:  z.string().optional().nullable(),
  referencePhone: z.string().optional().nullable(),
  photoUrl:       z.string().optional().nullable(),
  responseTime:   z.string().optional().nullable(),
  hourlyRate:     z.union([z.number(), z.string().transform(v => parseFloat(v) || 500)]).optional().nullable(),
  // Step 8 — Pricing
  pricePerHour:   z.union([z.number(), z.string().transform(v => parseFloat(v) || 500)]).optional().default(500),
})

// ── Login ──────────────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

// ── Refresh Token ──────────────────────────────────────────────────────────────
const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
})

// ── Forgot Password ────────────────────────────────────────────────────────────
const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
})

// ── Reset Password ─────────────────────────────────────────────────────────────
const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Password reset token or code is required'),
  newPassword: passwordSchema,
})

// ── Verify Reset Code ──────────────────────────────────────────────────────────
const verifyResetCodeSchema = z.object({
  code: z.string().min(1, 'Recovery code or token is required'),
})

// ── Two-Factor Authentication ──────────────────────────────────────────────────
const verify2FASchema = z.object({
  tempToken: z.string().min(1, 'Temporary verification token is required'),
  code: z.string().min(1, 'Verification code is required'),
})

const resend2FASchema = z.object({
  tempToken: z.string().min(1, 'Temporary verification token is required'),
})

module.exports = {
  registerClientSchema,
  registerProviderSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyResetCodeSchema,
  verify2FASchema,
  resend2FASchema,
}


