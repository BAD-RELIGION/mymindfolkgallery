// Wallet Connection Module - Based on reference site implementation
// Global state for wallet - defined before IIFE
let WALLET_STATE = {
  wallet: null,
  provider: null,
  currentWalletName: null,
  balance: 0,
  tokenBalance: 0,
  connected: false,
  listenersBound: false
};

(() => {
  const MAX_ATTEMPTS = 60;
  const RETRY_DELAY_MS = 200;

  function resolveWeb3() {
    if (typeof window === 'undefined') return undefined;
    if (window.solanaWeb3) return window.solanaWeb3;
    if (typeof solanaWeb3 !== 'undefined') return solanaWeb3;
    const script = document.getElementById('solana-web3-script');
    const globalName = script?.getAttribute?.('data-global');
    if (globalName && window[globalName]) return window[globalName];
    if (window.solana?.Web3) return window.solana.Web3;
    return undefined;
  }

  function waitForWeb3(attempt = 0) {
    const web3 = resolveWeb3();
    if (web3) {
      window.solanaWeb3 = web3;
      const run = () => initWalletConnection(web3);
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
      } else {
        run();
      }
      return;
    }
    if (attempt >= MAX_ATTEMPTS) {
      console.error('Solana web3 library failed to load.');
      return;
    }
    setTimeout(() => waitForWeb3(attempt + 1), RETRY_DELAY_MS);
  }

  waitForWeb3();

  function initWalletConnection(web3) {
    // Configuration - Try multiple ways to get API key
    let HELIUS_API_KEY = '';
    if (typeof window !== 'undefined' && window.CONFIG?.HELIUS_API_KEY) {
      HELIUS_API_KEY = (window.CONFIG.HELIUS_API_KEY || '').trim();
    } else if (typeof CONFIG !== 'undefined' && CONFIG?.HELIUS_API_KEY) {
      HELIUS_API_KEY = (CONFIG.HELIUS_API_KEY || '').trim();
    } else if (typeof localStorage !== 'undefined') {
      HELIUS_API_KEY = (localStorage.getItem('helius_api_key') || '').trim();
    }
    
    // Debug: Log where we got the API key from
    if (HELIUS_API_KEY) {
      const source = typeof window !== 'undefined' && window.CONFIG?.HELIUS_API_KEY ? 'window.CONFIG' :
                     typeof CONFIG !== 'undefined' && CONFIG?.HELIUS_API_KEY ? 'CONFIG' :
                     'localStorage';
      console.log(`✓ Found Helius API key from ${source}: ${HELIUS_API_KEY.substring(0, 8)}...`);
    } else {
      console.log('⚠ No Helius API key found at initialization');
    }
    
    // Use Helius RPC if API key is available, otherwise use alternative public RPCs
    let RPC_ENDPOINT;
    if (HELIUS_API_KEY) {
      RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
    } else {
      // Use multiple fallback RPC endpoints (public endpoints that are more reliable)
      // Try QuickNode public endpoint first, then others
      RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
      // Alternative endpoints we can try: 
      // - 'https://solana-api.projectserum.com' (old, may be deprecated)
      // - 'https://rpc.ankr.com/solana' (public, rate-limited)
      // - 'https://solana-mainnet.g.alchemy.com/v2/demo' (demo endpoint, limited)
    }
    
    // Log the API key status (masked for security)
    const maskedKey = HELIUS_API_KEY ? `${HELIUS_API_KEY.substring(0, 8)}...` : 'none';
    console.log('Initializing Solana connection:', HELIUS_API_KEY ? `Using Helius RPC (key: ${maskedKey})` : 'Using public RPC (no API key found)');
    
    if (!HELIUS_API_KEY || HELIUS_API_KEY.trim() === '') {
      console.warn('⚠ No Helius API key found. Some features may not work.');
      console.warn('   To set your API key, run in console:');
      console.warn('   CONFIG.HELIUS_API_KEY = "your-api-key"');
      console.warn('   Or: localStorage.setItem("helius_api_key", "your-api-key")');
      console.warn('   Then refresh the page.');
    }
    
    const connection = new web3.Connection(RPC_ENDPOINT, 'confirmed');
    
    // Make connection available globally for other scripts
    window.SOLANA_CONNECTION = connection;
    
    // Expose helper functions globally for debugging
    window.checkHeliusApiKey = function() {
      const key = getHeliusApiKey();
      console.log('=== Helius API Key Status ===');
      console.log('Current API key:', key ? `${key.substring(0, 8)}...` : 'NOT SET');
      console.log('Sources checked:');
      console.log('  window.CONFIG?.HELIUS_API_KEY:', typeof window !== 'undefined' ? (window.CONFIG?.HELIUS_API_KEY ? `${window.CONFIG.HELIUS_API_KEY.substring(0, 8)}...` : 'not set') : 'window undefined');
      console.log('  CONFIG?.HELIUS_API_KEY:', typeof CONFIG !== 'undefined' ? (CONFIG?.HELIUS_API_KEY ? `${CONFIG.HELIUS_API_KEY.substring(0, 8)}...` : 'not set') : 'CONFIG undefined');
      console.log('  localStorage.getItem("helius_api_key"):', typeof localStorage !== 'undefined' ? (localStorage.getItem('helius_api_key') ? `${localStorage.getItem('helius_api_key').substring(0, 8)}...` : 'not set') : 'localStorage undefined');
      return key;
    };
    
    window.setHeliusApiKey = function(apiKey) {
      if (!apiKey || typeof apiKey !== 'string') {
        console.error('Invalid API key. Please provide a string.');
        return false;
      }
      apiKey = apiKey.trim();
      
      // Set in all possible locations
      if (typeof window !== 'undefined' && window.CONFIG) {
        window.CONFIG.HELIUS_API_KEY = apiKey;
      }
      if (typeof CONFIG !== 'undefined') {
        CONFIG.HELIUS_API_KEY = apiKey;
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('helius_api_key', apiKey);
      }
      
      console.log(`✓ Helius API key set: ${apiKey.substring(0, 8)}...`);
      console.log('   Please refresh the page or reconnect your wallet for changes to take effect.');
      
      // If wallet is connected, try refreshing token balance
      if (WALLET_STATE.connected && WALLET_STATE.wallet) {
        console.log('   Refreshing token balance with new API key...');
        setTimeout(() => refreshTokenBalance(), 500);
      }
      
      return true;
    };

    // Wallet detection - exact copy from reference site
    function getWalletProvider(walletName) {
      switch (walletName) {
        case 'phantom':
          if (window.solana?.isPhantom) return window.solana;
          if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
          return null;
        case 'solflare':
          if (window.solflare) return window.solflare;
          if (window.solana?.isSolflare) return window.solana;
          if (window.solflare?.solana) return window.solflare.solana;
          return null;
        case 'backpack':
          if (window.backpack?.solana) return window.backpack.solana;
          if (window.solana?.isBackpack) return window.solana;
          return null;
        default:
          return null;
      }
    }

    function detectAvailableWallets() {
      const available = [];
      if (getWalletProvider('phantom')) available.push('phantom');
      if (getWalletProvider('solflare')) available.push('solflare');
      if (getWalletProvider('backpack')) available.push('backpack');
      if (isAndroidMobileWeb()) available.push('solanaMobile');
      return available;
    }

    /** Android Web (Chrome / Solana Seeker browser) — Mobile Wallet Adapter works here; not on iOS Safari. */
    function isAndroidMobileWeb() {
      if (typeof navigator === 'undefined') return false;
      return /Android/i.test(navigator.userAgent || '');
    }

    function getWalletDisplayName(walletName) {
      const names = {
        'phantom': 'Phantom',
        'solflare': 'Solflare',
        'backpack': 'Backpack',
        'solanaMobile': 'Solana Mobile Adapter'
      };
      return names[walletName] || walletName.charAt(0).toUpperCase() + walletName.slice(1).replace(/([A-Z])/g, ' $1');
    }
    
    function getWalletIcon(walletName) {
      const icons = {
        'phantom': 'fa-solid fa-ghost',
        'solflare': 'fa-solid fa-sun',
        'backpack': 'fa-solid fa-bag-shopping',
        'solanaMobile': 'fa-solid fa-mobile-screen-button'
      };
      return icons[walletName] || 'fa-solid fa-wallet';
    }
    
    function getWalletLogoUrl(walletName) {
      const logos = {
        'phantom': 'img/wallets/phantom.png',
        'solflare': 'img/wallets/solflare.png',
        'backpack': 'img/wallets/backpack.png',
        'solanaMobile': 'img/wallets/solana-mobile-adapter.png'
      };
      return logos[walletName] || 'img/wallets/default.png';
    }

    function formatSol(value, decimals = 4) {
      if (!Number.isFinite(value) || value <= 0) return '0';
      return Number(value).toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals
      });
    }

    function populateWalletOptions() {
      const walletGrid = document.getElementById('walletGrid');
      if (!walletGrid) return;
      walletGrid.innerHTML = '';
      
      const wallets = [
        { id: 'phantom', name: 'Phantom', color: '#AB9FF2' },
        { id: 'solflare', name: 'Solflare', color: '#FFB800' },
        { id: 'backpack', name: 'Backpack', color: '#FF6B35' },
        { id: 'solanaMobile', name: 'Solana Mobile Adapter', color: '#9945FF' }
      ];
      
      const available = detectAvailableWallets();
      
      wallets.forEach((wallet) => {
        const isAvailable = available.includes(wallet.id);
        const walletCard = document.createElement('button');
        walletCard.className = `wallet-option ${!isAvailable ? 'wallet-option-disabled' : ''}`;
        walletCard.type = 'button';
        walletCard.dataset.walletId = wallet.id;
        walletCard.disabled = !isAvailable;
        
        const logoImg = document.createElement('img');
        logoImg.src = getWalletLogoUrl(wallet.id);
        logoImg.alt = wallet.name;
        logoImg.className = 'wallet-option-logo';
        logoImg.onerror = function() {
          this.style.display = 'none';
          const fallback = this.nextElementSibling;
          if (fallback) fallback.style.display = 'flex';
        };
        
        const fallbackDiv = document.createElement('div');
        fallbackDiv.className = 'wallet-option-icon-fallback';
        fallbackDiv.style.cssText = `display: none; background: linear-gradient(135deg, ${wallet.color}22, ${wallet.color}11); width: 100%; height: 100%; align-items: center; justify-content: center; border-radius: 12px;`;
        fallbackDiv.innerHTML = `<i class="${getWalletIcon(wallet.id)}" style="color: ${wallet.color};"></i>`;
        
        const iconDiv = document.createElement('div');
        iconDiv.className = 'wallet-option-icon';
        iconDiv.appendChild(logoImg);
        iconDiv.appendChild(fallbackDiv);
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'wallet-option-content';
        contentDiv.innerHTML = `
          <div class="wallet-option-name">${wallet.name}</div>
          <div class="wallet-option-status">${isAvailable ? 'Detected' : 'Not installed'}</div>
        `;
        
        walletCard.appendChild(iconDiv);
        walletCard.appendChild(contentDiv);
        
        if (isAvailable) {
          const arrow = document.createElement('i');
          arrow.className = 'fa-solid fa-chevron-right wallet-option-arrow';
          walletCard.appendChild(arrow);
          walletCard.addEventListener('click', () => {
            closeWalletModal();
            connectToWallet(wallet.id);
          });
        }
        
        walletGrid.appendChild(walletCard);
      });
    }
    
    function openWalletModal() {
      const walletModal = document.getElementById('walletModal');
      const walletModalBackdrop = document.getElementById('walletModalBackdrop');
      if (!walletModal || !walletModalBackdrop) return;
      populateWalletOptions();
      walletModal.classList.add('wallet-modal-show');
      walletModalBackdrop.classList.add('wallet-modal-backdrop-show');
      document.body.style.overflow = 'hidden';
    }
    
    function closeWalletModal() {
      const walletModal = document.getElementById('walletModal');
      const walletModalBackdrop = document.getElementById('walletModalBackdrop');
      if (!walletModal || !walletModalBackdrop) return;
      walletModal.classList.remove('wallet-modal-show');
      walletModalBackdrop.classList.remove('wallet-modal-backdrop-show');
      document.body.style.overflow = '';
    }
    
    async function connectToWallet(walletId) {
      WALLET_STATE.currentWalletName = walletId;
      connectWallet();
    }

    async function refreshBalance() {
      if (!WALLET_STATE.wallet) return;
      try {
        const lamports = await tryRPCWithFallback(async (conn) => {
          return await conn.getBalance(WALLET_STATE.wallet, 'confirmed');
        }, 'getBalance');
        
        WALLET_STATE.balance = lamports / web3.LAMPORTS_PER_SOL;
        updateWalletIndicator();
        // Also refresh token balance
        refreshTokenBalance();
      } catch (err) {
        console.error('Failed to fetch balance', err);
      }
    }

    // Helper function to get Helius API key dynamically (check multiple sources)
    function getHeliusApiKey() {
      let apiKey = '';
      
      // Check in order of preference (most recent/authoritative first)
      if (typeof window !== 'undefined' && window.CONFIG?.HELIUS_API_KEY) {
        apiKey = window.CONFIG.HELIUS_API_KEY;
      } else if (typeof CONFIG !== 'undefined' && CONFIG?.HELIUS_API_KEY) {
        apiKey = CONFIG.HELIUS_API_KEY;
      } else if (typeof localStorage !== 'undefined') {
        apiKey = localStorage.getItem('helius_api_key') || '';
      } else if (HELIUS_API_KEY) {
        apiKey = HELIUS_API_KEY; // Fallback to closure variable
      }
      
      // Trim whitespace in case user added spaces
      apiKey = (apiKey || '').trim();
      
      return apiKey;
    }

    // Helper function to try RPC call with fallback endpoints
    async function tryRPCWithFallback(rpcCall, description) {
      const endpoints = [];
      
      // Get API key dynamically (in case it was set after initialization)
      const currentApiKey = getHeliusApiKey();
      
      // Add Helius if API key available - this should be first priority
      if (currentApiKey && currentApiKey.trim() !== '') {
        const heliusEndpoint = `https://mainnet.helius-rpc.com/?api-key=${currentApiKey}`;
        endpoints.push(heliusEndpoint);
        console.log(`✓ Using Helius RPC endpoint (key: ${currentApiKey.substring(0, 8)}...)`);
      } else {
        console.warn('⚠ Helius API key not found. Checking sources...');
        console.warn('   window.CONFIG?.HELIUS_API_KEY:', typeof window !== 'undefined' ? window.CONFIG?.HELIUS_API_KEY : 'window undefined');
        console.warn('   CONFIG?.HELIUS_API_KEY:', typeof CONFIG !== 'undefined' ? CONFIG?.HELIUS_API_KEY : 'CONFIG undefined');
        console.warn('   localStorage.getItem("helius_api_key"):', typeof localStorage !== 'undefined' ? localStorage.getItem('helius_api_key') : 'localStorage undefined');
        console.warn('   Please set it: CONFIG.HELIUS_API_KEY = "your-key" or localStorage.setItem("helius_api_key", "your-key")');
      }
      
      // Add alternative public RPC endpoints (these often fail, but we try them as last resort)
      // Note: These are usually rate-limited or require authentication
      endpoints.push(
        'https://api.mainnet-beta.solana.com' // Official public RPC (rate-limited)
      );
      
      for (const endpoint of endpoints) {
        try {
          const testConnection = new web3.Connection(endpoint, 'confirmed');
          const maskedEndpoint = endpoint.replace(/api-key=[^&]+/, 'api-key=***');
          console.log(`Trying ${description} with endpoint:`, maskedEndpoint);
          
          // Add timeout to avoid hanging
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('RPC call timeout')), 10000)
          );
          
          const result = await Promise.race([
            rpcCall(testConnection),
            timeoutPromise
          ]);
          
          if (result !== undefined && result !== null) {
            console.log(`✓ ${description} succeeded with endpoint:`, maskedEndpoint);
            return result;
          }
        } catch (error) {
          const maskedEndpoint = endpoint.replace(/api-key=[^&]+/, 'api-key=***');
          console.warn(`✗ ${description} failed with endpoint ${maskedEndpoint}:`, error.message);
          continue;
        }
      }
      
      // If we get here, all endpoints failed
      // Reuse currentApiKey that was already declared at the top of the function
      if (!currentApiKey || currentApiKey.trim() === '') {
        console.error('❌ All RPC endpoints failed. Please set your Helius API key:');
        console.error('   In browser console: CONFIG.HELIUS_API_KEY = "your-api-key"');
        console.error('   Or: localStorage.setItem("helius_api_key", "your-api-key")');
        console.error('   Then refresh the page.');
      } else {
        console.error('❌ All RPC endpoints failed, including Helius. Please check your API key is valid.');
      }
      
      throw new Error(`All RPC endpoints failed for ${description}`);
    }

    // Fetch $WOOD balance for any owner address (used for connected wallet and for search-by-address)
    const TOKEN_MINT_WOOD = '674PmuiDtgKx3uKuJ1B16f9m5L84eFvNwj3xDMvHcbo7'; // $WOOD token
    async function fetchWoodBalanceForOwner(ownerPublicKey) {
      let tokenBalance = 0;
      const TOKEN_MINT_PUBKEY = new web3.PublicKey(TOKEN_MINT_WOOD);
      try {
        try {
          const tokenAccounts = await tryRPCWithFallback(async (conn) => {
            return await conn.getParsedTokenAccountsByOwner(
              ownerPublicKey,
              { mint: TOKEN_MINT_PUBKEY },
              'confirmed'
            );
          }, 'getParsedTokenAccountsByOwner ($WOOD)');
          if (tokenAccounts && tokenAccounts.value && tokenAccounts.value.length > 0) {
            for (const accountInfo of tokenAccounts.value) {
              const parsed = accountInfo.account?.data?.parsed;
              if (parsed && parsed.info) {
                const info = parsed.info;
                const mintAddress = info.mint;
                if (mintAddress && (mintAddress === TOKEN_MINT_WOOD || mintAddress.toString() === TOKEN_MINT_WOOD)) {
                  const tokenAmount = info.tokenAmount;
                  if (tokenAmount) {
                    let amount = 0;
                    if (tokenAmount.uiAmount !== undefined && tokenAmount.uiAmount !== null) {
                      amount = parseFloat(tokenAmount.uiAmount);
                    } else if (tokenAmount.uiAmountString) {
                      amount = parseFloat(tokenAmount.uiAmountString);
                    } else if (tokenAmount.amount) {
                      const decimals = tokenAmount.decimals || 9;
                      const rawAmount = typeof tokenAmount.amount === 'string' ? BigInt(tokenAmount.amount) : BigInt(tokenAmount.amount);
                      amount = Number(rawAmount) / Math.pow(10, decimals);
                    }
                    if (amount > 0) tokenBalance += amount;
                  }
                }
              }
            }
          }
        } catch (method1Error) {
          const allTokenAccounts = await tryRPCWithFallback(async (conn) => {
            return await conn.getParsedTokenAccountsByOwner(
              ownerPublicKey,
              { programId: new web3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') },
              'confirmed'
            );
          }, 'getAllParsedTokenAccounts ($WOOD)');
          if (allTokenAccounts && allTokenAccounts.value) {
            for (const accountInfo of allTokenAccounts.value) {
              const parsed = accountInfo.account?.data?.parsed;
              if (parsed && parsed.info) {
                const mintAddress = parsed.info.mint;
                if (mintAddress && (mintAddress === TOKEN_MINT_WOOD || mintAddress.toString() === TOKEN_MINT_WOOD)) {
                  const tokenAmount = parsed.info.tokenAmount;
                  if (tokenAmount) {
                    let amount = 0;
                    if (tokenAmount.uiAmount !== undefined && tokenAmount.uiAmount !== null) {
                      amount = parseFloat(tokenAmount.uiAmount);
                    } else if (tokenAmount.uiAmountString) {
                      amount = parseFloat(tokenAmount.uiAmountString);
                    }
                    if (amount > 0) tokenBalance += amount;
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('Failed to fetch $WOOD balance for address:', err?.message);
      }
      return tokenBalance;
    }

    // Expose for gallery.js: fetch $WOOD balance for any address string (e.g. when searching by wallet)
    window.fetchWoodBalanceForAddress = async function(ownerAddress) {
      try {
        const pubkey = new web3.PublicKey(ownerAddress);
        return await fetchWoodBalanceForOwner(pubkey);
      } catch (e) {
        return 0;
      }
    };

    async function refreshTokenBalance() {
      if (!WALLET_STATE.wallet) {
        console.log('No wallet connected, skipping token balance');
        return;
      }
      try {
        WALLET_STATE.tokenBalance = await fetchWoodBalanceForOwner(WALLET_STATE.wallet);
        updateTokenBalanceDisplay();
      } catch (err) {
        console.error('Failed to fetch token balance:', err);
        WALLET_STATE.tokenBalance = 0;
        updateTokenBalanceDisplay();
      }
    }

    function updateTokenBalanceDisplay() {
      const display = document.getElementById('tokenBalanceDisplay');
      const amountEl = document.getElementById('tokenBalanceAmount');
      
      if (!display || !amountEl) return;
      
      if (WALLET_STATE.connected && WALLET_STATE.wallet) {
        // MY GALLERY is showing a pasted/searched address — single WOOD row uses that balance only
        if (typeof window !== 'undefined' && window.MY_GALLERY_VIEWING_ADDRESS) {
          display.style.display = 'none';
          return;
        }
        const balance = WALLET_STATE.tokenBalance || 0;
        amountEl.textContent = balance.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 6
        });
        display.style.display = 'block';
      } else {
        display.style.display = 'none';
      }
    }

    function bindProviderEvents() {
      if (!WALLET_STATE.provider || WALLET_STATE.listenersBound || typeof WALLET_STATE.provider.on !== 'function') return;
      
      WALLET_STATE.provider.on('disconnect', () => {
        WALLET_STATE.wallet = null;
        WALLET_STATE.provider = null;
        WALLET_STATE.currentWalletName = null;
        WALLET_STATE.connected = false;
        WALLET_STATE.balance = 0;
        WALLET_STATE.tokenBalance = 0;
        updateWalletUI();
        updateWalletIndicator();
        updateTokenBalanceDisplay();
      });
      
      WALLET_STATE.provider.on('accountChanged', (newAccount) => {
        if (!newAccount) {
          WALLET_STATE.wallet = null;
          WALLET_STATE.provider = null;
          WALLET_STATE.currentWalletName = null;
          WALLET_STATE.connected = false;
          updateWalletUI();
          return;
        }
        try {
          const nextKey = typeof newAccount === 'string' ? newAccount : newAccount?.toString?.();
          if (nextKey) {
            WALLET_STATE.wallet = new web3.PublicKey(nextKey);
            refreshBalance().then(() => {
              refreshTokenBalance();
            }).catch(err => {
              console.warn('Balance refresh failed:', err);
              refreshTokenBalance();
            });
            updateWalletUI();
            updateWalletIndicator();
          }
        } catch (err) {
          console.warn('Account change error', err);
        }
      });
      
      WALLET_STATE.listenersBound = true;
    }

    function mwaErrorChainCode(err, depth) {
      const d = depth || 0;
      if (!err || d > 6) return '';
      const c = err.code;
      if (typeof c === 'string' && c.startsWith('ERROR_')) return c;
      return mwaErrorChainCode(err.cause, d + 1);
    }

    function mwaConnectFailureMessage(err) {
      const msg = String(err?.message || '');
      const code = mwaErrorChainCode(err);
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
      const looksWebView = /\bwv\b|; wv\)/i.test(ua);

      if (code === 'ERROR_WALLET_NOT_FOUND' || /ERROR_WALLET_NOT_FOUND|wallet not found/i.test(msg)) {
        return (
          'Mobile Wallet Adapter could not open a wallet on this device. Open this site in Chrome (not an in-app browser), stay on HTTPS, and allow Local network access for Chrome if Android asks. Install a Solana wallet with MWA support (e.g. Phantom or Solflare). On Solana Seeker, try the Chrome app if the built-in browser fails.'
        );
      }
      if (code === 'ERROR_BROWSER_NOT_SUPPORTED' || looksWebView) {
        return (
          'This browser cannot use Mobile Wallet Adapter (MWA often fails inside embedded WebViews). Open the same URL in Chrome or another supported Android browser.'
        );
      }
      if (code === 'ERROR_LOOPBACK_ACCESS_BLOCKED' || /loopback|local network/i.test(msg)) {
        return (
          'Chrome blocked the local connection to your wallet. In Android Settings, check Chrome permissions (Local network / Nearby devices), then try again.'
        );
      }
      if (/timed out|timeout/i.test(msg)) {
        return (
          'Wallet connection timed out. If a wallet sheet appeared, approve it; otherwise open this page in Chrome with a compatible Solana wallet installed.'
        );
      }
      if (/public key/i.test(msg)) {
        return (
          'The wallet connected without exposing an account. Close the wallet app and try again in Chrome, or pick another MWA-compatible wallet.'
        );
      }
      return (
        msg ||
        'Solana Mobile Adapter connection failed. Use Chrome on Android with a compatible wallet. iOS Safari does not support MWA yet.'
      );
    }

    /**
     * Connect via Mobile Wallet Adapter (MWA) — Android Chrome, Solana Seeker browser, etc.
     * @see https://docs.solanamobile.com/developers/mobile-wallet-adapter
     */
    async function connectSolanaMobileWithAdapter() {
      if (WALLET_STATE.wallet || WALLET_STATE.connecting) return;
      WALLET_STATE.connecting = true;
      try {
        const mobileMod = await import(
          'https://esm.sh/@solana-mobile/wallet-adapter-mobile@2.2.7?deps=@solana/web3.js@1.98.4,@solana/wallet-adapter-base@0.9.27,@solana-mobile/mobile-wallet-adapter-protocol@2.2.7,@solana-mobile/mobile-wallet-adapter-protocol-web3js@2.2.7'
        );
        const baseMod = await import(
          'https://esm.sh/@solana/wallet-adapter-base@0.9.27?deps=@solana/web3.js@1.98.4'
        );

        const Adapter = mobileMod.SolanaMobileWalletAdapter || mobileMod.default;
        const createDefaultAddressSelector = mobileMod.createDefaultAddressSelector;
        const createDefaultAuthorizationResultCache = mobileMod.createDefaultAuthorizationResultCache;
        const { WalletAdapterNetwork } = baseMod;

        if (!Adapter || typeof Adapter !== 'function' || !createDefaultAddressSelector) {
          throw new Error('Could not load Solana Mobile Adapter modules.');
        }

        const adapter = new Adapter({
          addressSelector: createDefaultAddressSelector(),
          appIdentity: {
            name: 'Mindfolk Collection Gallery',
            uri: window.location.origin,
          },
          authorizationResultCache: createDefaultAuthorizationResultCache(),
          cluster: WalletAdapterNetwork.Mainnet,
          onWalletNotFound: async () => {
            console.warn('[MWA] onWalletNotFound (no responding wallet). UA:', navigator.userAgent);
          },
        });

        // wallet-adapter-mobile 2.2.x: connect() can resolve before Wallet Standard
        // publishes accounts; publicKey is set in a follow-up 'connect' emit. Wait for it.
        const pk = await new Promise((resolve, reject) => {
          const timeoutMs = 120000;
          let timer = setTimeout(() => {
            cleanup();
            reject(new Error('Timed out waiting for wallet public key'));
          }, timeoutMs);
          function cleanup() {
            clearTimeout(timer);
            timer = null;
            if (typeof adapter.off === 'function') adapter.off('connect', onConnect);
            else if (typeof adapter.removeListener === 'function') adapter.removeListener('connect', onConnect);
          }
          function onConnect() {
            const key = adapter.publicKey;
            if (key) {
              cleanup();
              resolve(key);
            }
          }
          if (typeof adapter.on === 'function') adapter.on('connect', onConnect);

          (async () => {
            try {
              await adapter.connect();
              if (adapter.publicKey) {
                cleanup();
                resolve(adapter.publicKey);
                return;
              }
            } catch (err) {
              cleanup();
              reject(err);
            }
          })();
        });

        if (!pk) throw new Error('Wallet did not provide a public key.');
        WALLET_STATE.wallet = new web3.PublicKey(pk.toString());
        WALLET_STATE.provider = adapter;
        WALLET_STATE.listenersBound = false;
        if (typeof adapter.on === 'function') {
          bindProviderEvents();
        } else {
          WALLET_STATE.listenersBound = true;
        }

        refreshBalance().catch(err => console.warn('Balance refresh failed (non-blocking):', err));
        updateWalletIndicator();
        WALLET_STATE.connected = true;
        updateWalletUI();
        refreshTokenBalance().catch(err => console.warn('Token balance refresh failed (non-blocking):', err));
        console.log('Solana Mobile Adapter connected.');
        window.dispatchEvent(new CustomEvent('walletConnected'));
      } catch (err) {
        if (err?.code === 4001) {
          alert('Wallet connection cancelled.');
        } else {
          console.error('Solana Mobile Adapter connect error', err);
          alert(mwaConnectFailureMessage(err));
        }
        WALLET_STATE.provider = null;
        WALLET_STATE.currentWalletName = null;
      } finally {
        WALLET_STATE.connecting = false;
        updateWalletUI();
      }
    }

    async function connectWallet() {
      const selectedWallet = WALLET_STATE.currentWalletName || '';
      if (!selectedWallet) {
        openWalletModal();
        return;
      }

      if (selectedWallet === 'solanaMobile') {
        await connectSolanaMobileWithAdapter();
        return;
      }

      const provider = getWalletProvider(selectedWallet);
      if (!provider) {
        const walletName = getWalletDisplayName(selectedWallet);
        alert(`${walletName} wallet not detected. Install the extension and refresh this page.`);
        return;
      }
      
      if (WALLET_STATE.wallet || WALLET_STATE.connecting) return;
      WALLET_STATE.connecting = true;
      WALLET_STATE.provider = provider;
      
      try {
        const resp = await provider.connect();
        const pubkey = resp?.publicKey || provider.publicKey;
        if (!pubkey) throw new Error('Wallet did not provide a public key.');
        WALLET_STATE.wallet = new web3.PublicKey(pubkey.toString());
        bindProviderEvents();
        refreshBalance().catch(err => {
          console.warn('Balance refresh failed (non-blocking):', err);
        });
        updateWalletIndicator();
        WALLET_STATE.connected = true;
        updateWalletUI();
        
        // Refresh token balance after connecting
        refreshTokenBalance().catch(err => {
          console.warn('Token balance refresh failed (non-blocking):', err);
        });
        
        const walletName = getWalletDisplayName(selectedWallet);
        console.log(`${walletName} wallet connected.`);
        
        // Dispatch event for token balance update
        window.dispatchEvent(new CustomEvent('walletConnected'));
      } catch (err) {
        if (err?.code === 4001) {
          alert('Wallet connection cancelled.');
        } else {
          console.error('Wallet connect error', err);
          alert(err?.message || 'Failed to connect wallet.');
        }
        WALLET_STATE.provider = null;
        WALLET_STATE.currentWalletName = null;
      } finally {
        WALLET_STATE.connecting = false;
        updateWalletUI();
      }
    }

    async function disconnectWallet() {
      if (!WALLET_STATE.wallet) return;
      try {
        if (WALLET_STATE.provider && typeof WALLET_STATE.provider.removeAllListeners === 'function') {
          try {
            WALLET_STATE.provider.removeAllListeners('disconnect');
            WALLET_STATE.provider.removeAllListeners('accountChanged');
          } catch (_) { /* some adapters omit listeners */ }
        }
        await WALLET_STATE.provider?.disconnect?.();
      } catch (err) {
        console.warn('Wallet disconnect error', err);
      } finally {
        WALLET_STATE.wallet = null;
        WALLET_STATE.balance = 0;
        WALLET_STATE.connecting = false;
        WALLET_STATE.provider = null;
        WALLET_STATE.currentWalletName = null;
        WALLET_STATE.listenersBound = false;
        WALLET_STATE.connected = false;
        updateWalletUI();
        updateWalletIndicator();
        // Dispatch disconnect event
        window.dispatchEvent(new CustomEvent('walletDisconnected'));
      }
    }

    function updateWalletIndicator() {
      const indicator = document.getElementById('walletIndicator');
      const icon = document.getElementById('walletIndicatorIcon');
      const name = document.getElementById('walletIndicatorName');
      const balance = document.getElementById('walletIndicatorBalance');
      
      if (!indicator || !icon || !name || !balance) return;
      
      if (WALLET_STATE.wallet && WALLET_STATE.currentWalletName) {
        const walletName = getWalletDisplayName(WALLET_STATE.currentWalletName);
        const sol = WALLET_STATE.balance;
        icon.src = getWalletLogoUrl(WALLET_STATE.currentWalletName);
        icon.alt = walletName;
        name.textContent = walletName;
        balance.textContent = `${formatSol(sol, 2)} SOL`;
        indicator.style.display = 'block';
      } else {
        indicator.style.display = 'none';
      }
      
      // Also update token balance display
      updateTokenBalanceDisplay();
    }

    function updateWalletUI() {
      // Header buttons
      const connectBtn = document.getElementById('connectWalletBtn');
      const disconnectBtn = document.getElementById('disconnectWalletBtn');
      // Hero buttons
      const connectBtnHero = document.getElementById('connectWalletBtnHero');
      const viewWalletNFTsBtn = document.getElementById('viewWalletNFTsBtn');
      // Main title
      const mainTitle = document.getElementById('mainTitle');
      
      if (WALLET_STATE.connected) {
        if (connectBtn) connectBtn.classList.add('d-none');
        if (disconnectBtn) disconnectBtn.classList.remove('d-none');
        if (connectBtnHero) connectBtnHero.classList.add('d-none');
        if (viewWalletNFTsBtn) viewWalletNFTsBtn.classList.remove('d-none');
        // Hide main title when connected
        if (mainTitle) mainTitle.style.display = 'none';
      } else {
        if (connectBtn) {
          connectBtn.classList.remove('d-none');
          connectBtn.textContent = 'Connect Wallet';
        }
        if (disconnectBtn) disconnectBtn.classList.add('d-none');
        if (connectBtnHero) {
          connectBtnHero.classList.remove('d-none');
          connectBtnHero.innerHTML = '<i class="fas fa-wallet"></i> Connect Wallet';
        }
        if (viewWalletNFTsBtn) viewWalletNFTsBtn.classList.add('d-none');
        // Show main title when disconnected
        if (mainTitle) mainTitle.style.display = 'block';
      }
    }

    function handleConnectWallet() {
      if (WALLET_STATE.connected) return;
      openWalletModal();
    }

    function handleDisconnectWallet() {
      disconnectWallet();
    }

    // Expose functions globally for use in gallery.js
    window.walletConnection = {
      openModal: openWalletModal,
      closeModal: closeWalletModal,
      connect: handleConnectWallet,
      disconnect: handleDisconnectWallet,
      populateOptions: populateWalletOptions,
      getWalletState: () => WALLET_STATE,
      refreshTokenBalance: refreshTokenBalance,
      web3: web3,
      connection: connection
    };
    
    // Also expose wallet state globally for gallery.js
    window.WALLET_STATE = WALLET_STATE;

    // Expose functions for token balance
    window.refreshTokenBalance = refreshTokenBalance;
    window.updateTokenBalanceDisplay = updateTokenBalanceDisplay;

    // Set up event listeners
    const connectBtn = document.getElementById('connectWalletBtn');
    const disconnectBtn = document.getElementById('disconnectWalletBtn');
    // Hero buttons
    const connectBtnHero = document.getElementById('connectWalletBtnHero');
    const disconnectBtnHero = document.getElementById('disconnectWalletBtnHero');
    const walletModalBackdrop = document.getElementById('walletModalBackdrop');
    const walletModalClose = document.querySelector('.wallet-modal-close');

    // Header buttons
    if (connectBtn) {
      connectBtn.addEventListener('click', handleConnectWallet);
    }

    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', handleDisconnectWallet);
    }
    
    // Hero button - use the same handler
    if (connectBtnHero) {
      connectBtnHero.addEventListener('click', handleConnectWallet);
    }

    if (walletModalBackdrop) {
      walletModalBackdrop.addEventListener('click', closeWalletModal);
    }

    if (walletModalClose) {
      walletModalClose.addEventListener('click', closeWalletModal);
    }

    // Initialize UI
    updateWalletUI();
    populateWalletOptions();

    // Try to auto-connect if wallet is already connected
    (async () => {
      const availableWallets = detectAvailableWallets();
      for (const walletName of availableWallets) {
        const provider = getWalletProvider(walletName);
        if (provider && provider.publicKey) {
          try {
            WALLET_STATE.wallet = new web3.PublicKey(provider.publicKey.toString());
            WALLET_STATE.provider = provider;
            WALLET_STATE.currentWalletName = walletName;
            WALLET_STATE.connected = true;
            bindProviderEvents();
            await refreshBalance();
            await refreshTokenBalance();
            updateWalletUI();
            updateWalletIndicator();
            updateTokenBalanceDisplay();
            console.log(`${getWalletDisplayName(walletName)} wallet already connected.`);
            // Dispatch event for token balance update
            window.dispatchEvent(new CustomEvent('walletConnected'));
            break;
          } catch (_) {
            // Ignore errors
          }
        }
      }
    })();
  }
})();

