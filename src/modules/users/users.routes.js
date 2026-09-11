const { Router } = require('express')
const { z } = require('zod')
const auth = require('../../middleware/auth')
const requireRole = require('../../middleware/requireRole')
const validate = require('../../middleware/validate')
const ctrl = require('./users.controller')

const router = Router()
router.use(auth)

const updateMeSchema = z.object({
  firstName:        z.string().min(1).optional(),
  lastName:         z.string().min(1).optional(),
  phone:            z.string().optional(),
  city:             z.string().optional(),
  dateOfBirth:      z.string().optional(),
  gender:           z.string().optional(),
  photoUrl:         z.string().optional(),
  householdSize:    z.number().int().positive().optional(),
  childrenAges:     z.array(z.number().int().min(0)).optional(),
  careNeeds:        z.array(z.string()).optional(),
  // Provider fields
  bio:              z.string().optional(),
  profession:       z.string().optional(),
  hourlyRate:       z.union([z.number(), z.string().transform(v => parseInt(v, 10))]).optional(),
  pricePerHour:     z.union([z.number(), z.string().transform(v => parseInt(v, 10))]).optional(),
  serviceRadius:    z.string().optional(),
  experience:       z.string().optional(),
  experienceYears:  z.union([z.number(), z.string()]).optional(),
  languages:        z.union([z.array(z.string()), z.string().transform(s => s.split(',').map(x => x.trim()))]).optional(),
  availableDays:    z.union([z.array(z.string()), z.string().transform(s => s.split(',').map(x => x.trim()))]).optional(),
  specialty:        z.string().optional(),
  certifications:   z.union([z.array(z.string()), z.string().transform(s => s.split(',').map(x => x.trim()))]).optional(),
  emergencyContact: z.string().optional(),
  secondaryPhone:   z.string().optional(),
  preferredLanguage:z.string().optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'Provide at least one field to update.' })

/** GET  /api/users/me        — get own full profile */
router.get('/me', ctrl.getMe)

/** PATCH /api/users/me       — update own profile */
router.patch('/me', validate(updateMeSchema), ctrl.updateMe)

/** DELETE /api/users/me      — deactivate own account */
router.delete('/me', ctrl.deactivateMe)

/** GET  /api/users/contacts   — authenticated: list contacts (clients & providers) for discussions */
router.get('/contacts', ctrl.listContacts)

/** GET  /api/users           — admin: list all users with optional filters
 *  Query: ?role=client&city=Yaounde&search=Laurie&limit=50&offset=0
 */
router.get('/', requireRole('admin'), ctrl.listAll)

/** PATCH /api/users/:id/role — admin: change any user's role */
router.patch(
  '/:id/role',
  requireRole('admin'),
  validate(z.object({ role: z.enum(['client', 'provider', 'admin']) })),
  ctrl.changeRole
)

module.exports = router
