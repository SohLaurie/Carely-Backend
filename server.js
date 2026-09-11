if (process.env.NODE_ENV !== 'production') require('dotenv').config()
const app = require('./src/app')

const PORT = process.env.PORT || 5000

// Startup diagnostics — confirm env vars are loaded (safe: no secrets logged)
console.log(`🌍 NODE_ENV     : ${process.env.NODE_ENV || 'undefined'}`)
console.log(`🗄️  DATABASE_URL : ${process.env.DATABASE_URL ? '✅ set (' + process.env.DATABASE_URL.slice(0, 30) + '...)' : '❌ NOT SET — will fall back to localhost'}`)
console.log(`🌐 FRONTEND_URL : ${process.env.FRONTEND_URL || 'undefined'}`)

app.listen(PORT, () => {
  console.log(`🚀 Carely API running on port ${PORT}`)
})
