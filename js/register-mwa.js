/**
 * Register Solana Mobile Wallet Adapter (MWA) for Wallet Standard on Android Chrome / Seeker.
 * See: https://docs.solanamobile.com/get-started/web/installation
 * https://docs.solanamobile.com/developers/mobile-wallet-adapter
 */

try {
  const { SOLANA_MAINNET_CHAIN } = await import('https://esm.sh/@solana/wallet-standard-chains@1.1.1');
  const {
    createDefaultAuthorizationCache,
    createDefaultChainSelector,
    registerMwa,
  } = await import(
    'https://esm.sh/@solana-mobile/wallet-standard-mobile@0.5.1?deps=@solana-mobile/mobile-wallet-adapter-protocol@2.2.7'
  );

  /** Avoid default embedded modal; wallet.js shows one consolidated alert on connect failure. */
  async function onWalletNotFoundLogOnly() {
    console.warn(
      '[MWA registerMwa] No wallet responded (wallet not found). UA:',
      typeof navigator !== 'undefined' ? navigator.userAgent : '(n/a)'
    );
  }

  registerMwa({
    appIdentity: {
      name: 'Mindfolk Collection Gallery',
      uri: typeof window !== 'undefined' ? window.location.origin : 'https://my.mindfolk.xyz',
    },
    authorizationCache: createDefaultAuthorizationCache(),
    chains: [SOLANA_MAINNET_CHAIN],
    chainSelector: createDefaultChainSelector(),
    onWalletNotFound: onWalletNotFoundLogOnly,
  });
  console.log('✓ Solana Mobile Wallet Standard (MWA) registered for compatible Android browsers');
} catch (e) {
  console.warn('MWA registration skipped (desktop or unsupported browser):', e?.message || e);
}
