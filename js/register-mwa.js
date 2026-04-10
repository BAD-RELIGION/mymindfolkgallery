/**
 * Register Solana Mobile Wallet Adapter (MWA) for Wallet Standard on Android Chrome / Seeker.
 * See: https://docs.solanamobile.com/get-started/web/installation
 * https://docs.solanamobile.com/developers/mobile-wallet-adapter
 */
try {
  const {
    createDefaultAuthorizationCache,
    createDefaultChainSelector,
    createDefaultWalletNotFoundHandler,
    registerMwa,
  } = await import('https://esm.sh/@solana-mobile/wallet-standard-mobile@2.1.0');

  registerMwa({
    appIdentity: {
      name: 'Mindfolk Collection Gallery',
      uri: typeof window !== 'undefined' ? window.location.origin : 'https://my.mindfolk.xyz',
      icon: typeof window !== 'undefined'
        ? new URL('img/mf_dc_icon.png', window.location.origin).href
        : 'https://my.mindfolk.xyz/img/mf_dc_icon.png',
    },
    authorizationCache: createDefaultAuthorizationCache(),
    chains: ['solana:mainnet'],
    chainSelector: createDefaultChainSelector(),
    onWalletNotFound: createDefaultWalletNotFoundHandler(),
  });
  console.log('✓ Solana Mobile Wallet Standard (MWA) registered for compatible Android browsers');
} catch (e) {
  console.warn('MWA registration skipped (desktop or unsupported browser):', e?.message || e);
}
