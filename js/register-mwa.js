/**
 * Register Solana Mobile Wallet Adapter (MWA) for Wallet Standard on Android Chrome / Seeker.
 * See: https://docs.solanamobile.com/get-started/web/installation
 * https://docs.solanamobile.com/developers/mobile-wallet-adapter
 */
function mwaRegisterDebugLog(hypothesisId, location, message, data) {
  // #region agent log
  fetch('http://127.0.0.1:7298/ingest/0d1fc4de-d6a1-465b-9140-ab41e5bc7369',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c9ac66'},body:JSON.stringify({sessionId:'c9ac66',runId:'wallet-mwa-before-fix',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

try {
  mwaRegisterDebugLog('H1', 'register-mwa.js:entry', 'register-mwa script started', {
    origin: typeof window !== 'undefined' ? window.location.origin : '(no-window)',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '(n/a)',
  });
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
    mwaRegisterDebugLog('H2', 'register-mwa.js:onWalletNotFound', 'registerMwa wallet not found callback', {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '(n/a)',
    });
    console.warn(
      '[MWA registerMwa] No wallet responded (wallet not found). UA:',
      typeof navigator !== 'undefined' ? navigator.userAgent : '(n/a)'
    );
  }

  registerMwa({
    appIdentity: {
      name: 'Mindfolk Collection Gallery',
      uri: typeof window !== 'undefined' ? window.location.origin : 'https://my.mindfolk.xyz',
      icon: typeof window !== 'undefined'
        ? new URL('img/mf_dc_icon.png', window.location.origin).href
        : 'https://my.mindfolk.xyz/img/mf_dc_icon.png',
    },
    authorizationCache: createDefaultAuthorizationCache(),
    chains: [SOLANA_MAINNET_CHAIN],
    chainSelector: createDefaultChainSelector(),
    onWalletNotFound: onWalletNotFoundLogOnly,
  });
  mwaRegisterDebugLog('H1', 'register-mwa.js:registered', 'registerMwa completed', { ok: true });
  console.log('✓ Solana Mobile Wallet Standard (MWA) registered for compatible Android browsers');
} catch (e) {
  mwaRegisterDebugLog('H5', 'register-mwa.js:catch', 'registerMwa failed/skipped', {
    name: e?.name,
    message: e?.message,
  });
  console.warn('MWA registration skipped (desktop or unsupported browser):', e?.message || e);
}
