const usersService = require('./users.service')

async function getMe(req, res, next) {
  try {
    const user = await usersService.getMe(req.user.id)
    res.json({ user })
  } catch (err) { next(err) }
}

async function updateMe(req, res, next) {
  try {
    const user = await usersService.updateMe(req.user.id, req.body)
    res.json({ message: 'Profile updated.', user })
  } catch (err) { next(err) }
}

async function deactivateMe(req, res, next) {
  try {
    const result = await usersService.deactivateMe(req.user.id)
    res.json(result)
  } catch (err) { next(err) }
}

async function listAll(req, res, next) {
  try {
    const result = await usersService.listAll(req.query)
    res.json(result)
  } catch (err) { next(err) }
}

async function changeRole(req, res, next) {
  try {
    const user = await usersService.changeRole(req.params.id, req.body.role, req.user.id)
    res.json({ message: `Role updated to '${user.role}'.`, user })
  } catch (err) { next(err) }
}

async function listContacts(req, res, next) {
  try {
    const contacts = await usersService.listContacts(req.user.id, req.query)
    res.json({ contacts })
  } catch (err) { next(err) }
}

module.exports = { getMe, updateMe, deactivateMe, listAll, changeRole, listContacts }
