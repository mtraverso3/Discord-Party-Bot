/**
 * Generates an RSA keypair for the built-in OIDC provider (Discord admin login)
 * and prints the private key as a JWK. Set it as the OIDC_PRIVATE_JWK secret:
 *
 *   npx tsx scripts/gen-oidc-key.ts | wrangler secret put OIDC_PRIVATE_JWK
 *
 * The Worker derives and publishes the matching public key at /oidc/jwks, so
 * only this private JWK needs to be stored. Rotate by regenerating and
 * re-setting the secret (existing sessions re-auth on their next Access hop).
 */

import { webcrypto as crypto } from 'node:crypto'

async function main() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )

  const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey) as Record<string, unknown>
  jwk['kid'] = 'pb-oidc-' + Date.now().toString(36)
  jwk['alg'] = 'RS256'
  jwk['use'] = 'sig'

  // Single line so it pipes cleanly into `wrangler secret put`.
  process.stdout.write(JSON.stringify(jwk) + '\n')
}

main().catch(err => { console.error(err); process.exit(1) })
