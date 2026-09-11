const pool = require('../../config/db');

// Default policy
const DEFAULT_LOCKOUT_POLICY = {
  logFailedAttempts: true,
  notifyOnLockout: true,
  maxFailedAttempts: 5,
  lockDuration: 15,
  lockoutPolicy: 'Incremental Delay (5m, 15m, 1h)'
};

async function getLockoutPolicy() {
  try {
    const { rows } = await pool.query("SELECT value FROM system_settings WHERE key = 'lockout_policy'");
    if (rows.length > 0 && rows[0].value) {
      return { ...DEFAULT_LOCKOUT_POLICY, ...rows[0].value };
    }
  } catch (err) {
    console.warn('Could not read lockout policy from DB, using defaults:', err.message);
  }
  return DEFAULT_LOCKOUT_POLICY;
}

async function updateLockoutPolicy(data) {
  const current = await getLockoutPolicy();
  const updated = {
    logFailedAttempts: data.logFailedAttempts !== undefined ? Boolean(data.logFailedAttempts) : current.logFailedAttempts,
    notifyOnLockout: data.notifyOnLockout !== undefined ? Boolean(data.notifyOnLockout) : current.notifyOnLockout,
    maxFailedAttempts: data.maxFailedAttempts !== undefined ? Math.max(1, parseInt(data.maxFailedAttempts, 10)) : current.maxFailedAttempts,
    lockDuration: data.lockDuration !== undefined ? Math.max(1, parseInt(data.lockDuration, 10)) : current.lockDuration,
    lockoutPolicy: data.lockoutPolicy || current.lockoutPolicy
  };

  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('lockout_policy', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [JSON.stringify(updated)]
  );

  return updated;
}

async function recordLoginAttempt({ email, userId = null, ip = null, userAgent = null, status, failureReason = null }) {
  try {
    await pool.query(
      `INSERT INTO login_attempts (email, user_id, ip_address, user_agent, status, failure_reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [email ? email.toLowerCase().trim() : 'unknown', userId, ip || '127.0.0.1', userAgent || 'Unknown', status, failureReason]
    );
  } catch (err) {
    console.warn('Failed to record login attempt:', err.message);
  }
}

async function listLoginAttempts({ limit = 50, offset = 0, search = '' } = {}) {
  let query = `
    SELECT l.id, l.email, l.user_id, l.ip_address, l.user_agent, l.status, l.failure_reason, l.created_at,
           u.first_name, u.last_name, u.role
    FROM login_attempts l
    LEFT JOIN users u ON u.id = l.user_id
  `;
  const values = [];
  if (search && search.trim()) {
    query += ` WHERE l.email ILIKE $1 OR l.ip_address ILIKE $1 OR l.status ILIKE $1 OR l.failure_reason ILIKE $1`;
    values.push(`%${search.trim()}%`);
  }
  query += ` ORDER BY l.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  values.push(Number(limit), Number(offset));

  const { rows } = await pool.query(query, values);
  return rows.map(r => {
    const actorName = r.first_name ? `${r.first_name} ${r.last_name || ''}`.trim() : r.email;
    const roleLabel = r.role ? ` (${r.role.toUpperCase()})` : '';
    return {
      id: `LOG-${r.id.slice(0, 8).toUpperCase()}`,
      rawId: r.id,
      timestamp: new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 19),
      actor: `${actorName}${roleLabel}`,
      action: r.status === 'success' ? 'AUTH_SUCCESS' : (r.status === 'locked_out' ? 'LOCKOUT' : 'AUTH_FAILED'),
      resource: `Account (${r.email})`,
      ip: r.ip_address || '127.0.0.1',
      status: r.status === 'success' ? 'SUCCESS' : (r.status === 'locked_out' ? 'BLOCKED' : 'FAILED'),
      details: r.failure_reason || (r.status === 'success' ? 'Authenticated successfully' : 'Authentication failed')
    };
  });
}

async function unlockUser(userId) {
  const { rows } = await pool.query(
    `UPDATE users
     SET failed_login_attempts = 0, locked_until = NULL, last_failed_login_at = NULL
     WHERE id = $1
     RETURNING id, email, first_name, last_name`,
    [userId]
  );
  if (rows.length === 0) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

module.exports = {
  getLockoutPolicy,
  updateLockoutPolicy,
  recordLoginAttempt,
  listLoginAttempts,
  unlockUser
};
