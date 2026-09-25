/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The database drivers stay out of the bundle: pg (under @profullstack/libsql-pg)
  // and, for local file: databases, the native libSQL client.
  serverExternalPackages: ['@profullstack/libsql-pg', 'pg', '@libsql/client'],
  transpilePackages: ['@bufferoverride/db', '@bufferoverride/ui', '@bufferoverride/design-tokens', '@bufferoverride/auth', '@bufferoverride/core', '@bufferoverride/reputation', '@bufferoverride/notifications'],
  poweredByHeader: false,
};
