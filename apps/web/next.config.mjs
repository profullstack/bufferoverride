/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The libSQL client is a native-ish dependency; keep it out of the bundle.
  serverExternalPackages: ['@libsql/client'],
  transpilePackages: ['@bufferoverride/db', '@bufferoverride/ui', '@bufferoverride/design-tokens', '@bufferoverride/auth', '@bufferoverride/core', '@bufferoverride/reputation'],
  poweredByHeader: false,
};
