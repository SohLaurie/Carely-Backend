const providersService = require('./providers.service')

async function listProviders(req, res, next) {
  try {
    const result = await providersService.listProviders(req.query)
    res.json(result)
  } catch (err) { next(err) }
}

async function getProvider(req, res, next) {
  try {
    const provider = await providersService.getProvider(req.params.id)
    res.json({ provider })
  } catch (err) { next(err) }
}

async function getMyProviderProfile(req, res, next) {
  try {
    const provider = await providersService.getMyProviderProfile(req.user.id)
    res.json({ provider })
  } catch (err) { next(err) }
}

async function updateMyProviderProfile(req, res, next) {
  try {
    const provider = await providersService.updateMyProviderProfile(req.user.id, req.body)
    res.json({ message: 'Provider profile updated.', provider })
  } catch (err) { next(err) }
}

async function toggleAvailability(req, res, next) {
  try {
    const result = await providersService.toggleAvailability(req.user.id)
    res.json(result)
  } catch (err) { next(err) }
}

async function getSubscriptionStatus(req, res, next) {
  try {
    const adminService = require('../admin/admin.service')
    const status = await adminService.getProviderSubscriptionStatus(req.user.id)
    res.json(status)
  } catch (err) { next(err) }
}

async function paySubscription(req, res, next) {
  try {
    const adminService = require('../admin/admin.service')
    const result = await adminService.paySubscription(req.user.id, req.body?.phone)
    res.json(result)
  } catch (err) { next(err) }
}

async function getCertificationStatus(req, res, next) {
  try {
    const adminService = require('../admin/admin.service')
    const status = await adminService.getProviderCertificationStatus(req.user.id)
    res.json(status)
  } catch (err) { next(err) }
}

async function requestCertification(req, res, next) {
  try {
    const adminService = require('../admin/admin.service')
    const result = await adminService.requestProviderCertification(req.user.id, req.body)
    res.json(result)
  } catch (err) { next(err) }
}

async function payCertification(req, res, next) {
  try {
    const adminService = require('../admin/admin.service')
    const result = await adminService.payCertification(req.user.id, req.body?.phone)
    res.json(result)
  } catch (err) { next(err) }
}

module.exports = {
  listProviders,
  getProvider,
  getMyProviderProfile,
  updateMyProviderProfile,
  toggleAvailability,
  getSubscriptionStatus,
  paySubscription,
  getCertificationStatus,
  requestCertification,
  payCertification,
}
