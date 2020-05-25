function ensure(keys) {
  const out = {}
  keys.forEach(key => {
    if (!process.env[key]) {
      throw new Error(`Missing environment variable ${key}`)
    }
    out[key] = process.env[key]
  })
  return out
}

module.exports = ensure([
  "MONGO_DB_CONNECTION_STRING",
  "NODE_ENV",
  "HTTP_PORT",
  "REDIS_HOST",
  "REDIS_PASSWORD",
  "REDIS_PORT",
])
