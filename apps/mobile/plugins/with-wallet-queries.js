// Lets AppKit see which wallet apps are installed (Android 11+ package visibility), so they sort first in the connect sheet.
const { withAndroidManifest, createRunOncePlugin } = require('expo/config-plugins');

const WALLETS = [
  'io.metamask',
  'com.wallet.crypto.trustapp',
  'me.rainbow',
  'io.zerion.android',
  'io.gnosis.safe',
  'com.uniswap.mobile',
  'org.toshi',
  'com.coinbase.android',
  'com.okinc.okex.gp',
  'com.bitkeep.wallet',
  'app.phantom',
  'com.ledger.live',
];

function withWalletQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const queries = manifest.queries?.[0] ?? {};
    const have = new Set((queries.package ?? []).map((p) => p.$['android:name']));
    queries.package = [...(queries.package ?? []), ...WALLETS.filter((w) => !have.has(w)).map((w) => ({ $: { 'android:name': w } }))];
    manifest.queries = [queries, ...(manifest.queries?.slice(1) ?? [])];
    return cfg;
  });
}

module.exports = createRunOncePlugin(withWalletQueries, 'with-wallet-queries', '1.0.0');
