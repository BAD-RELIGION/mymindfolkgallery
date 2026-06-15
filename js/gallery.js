// NFT Gallery JavaScript
// Configuration - Make it globally available
const CONFIG = {
  // Helius API endpoint - you can get a free API key from https://www.helius.dev/
  // You can also set it in the browser console: CONFIG.HELIUS_API_KEY = 'your-api-key'
  // Default API key (can be overridden by localStorage or URL param)
  HELIUS_API_KEY: localStorage.getItem('helius_api_key') || '5f0e398a-0064-4fd2-9c43-e2f8f915331c',
  HELIUS_ENDPOINT: 'https://api.helius.xyz/v0',
  HELIUS_RPC: 'https://mainnet.helius-rpc.com',
  RPC_ENDPOINT: 'https://api.mainnet-beta.solana.com',
  BATCH_SIZE: 36, // Default number of NFTs to load per batch (all views)
};

// Make CONFIG globally available for other scripts (like wallet.js)
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
  // Log API key status (masked for security)
  if (CONFIG.HELIUS_API_KEY) {
    console.log('✓ Helius API key configured:', CONFIG.HELIUS_API_KEY.substring(0, 8) + '...');
  }
}

// Allow setting API key from browser console or localStorage
if (!CONFIG.HELIUS_API_KEY && typeof window !== 'undefined') {
  // Try to get from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const apiKey = urlParams.get('helius_key');
  if (apiKey) {
    CONFIG.HELIUS_API_KEY = apiKey;
    window.CONFIG.HELIUS_API_KEY = apiKey;
    localStorage.setItem('helius_api_key', apiKey);
  }
}

// Global state for wallet - will be set by wallet.js
// We just reference it here for compatibility

// Global state
let currentCollection = null;
let allNFTs = [];
let displayedNFTs = [];
let currentPage = 0;
let collectionMintAddresses = new Set(); // Store collection mint addresses for filtering
let collectionNFTDataMap = new Map(); // Map mint address to NFT data from JSON for quick lookup
let founderMetadataMap = new Map(); // Map mint address to full founder metadata for modal display
let popupImageMapByName = new Map(); // Map NFT name to popup image URL (from CSV column F)
let popupImageMapByMint = new Map(); // Map mint address to popup image URL (from CSV column F)
let arweaveImageMap = new Map(); // Map filename to Arweave URL (from arweave_image_mapping.json)
let arweaveMintMap = new Map(); // Map mint ID to Arweave URL (from merged_mindfolk_data.json)
let mainGalleryView = localStorage.getItem('mainGalleryView') || '6col'; // View mode for main gallery only

/** Bootstrap row (list) vs CSS grid mosaic (6col / 12col) for Mindfolk collection */
function getMainGalleryGridWrapperClass(view = mainGalleryView) {
  if (view === 'list') return `row g-4 text-start gallery-view-${view}`;
  return `gallery-mosaic text-start gallery-view-${view}`;
}

function mainGalleryEmptyRowClass() {
  return mainGalleryView === 'list' ? 'col-12 text-center' : 'gallery-mosaic-span-full text-center';
}

// Mindlings collection state
let mindlingsNFTs = [];
let mindlingsDisplayedNFTs = [];
let mindlingsCurrentPage = 0;
let mindlingsCollectionMintAddresses = new Set(); // Store Mindlings collection mint addresses for filtering
let mindlingsCollectionNFTDataMap = new Map(); // Map mint address to NFT data from JSON for quick lookup
let mindlingsGalleryView = localStorage.getItem('mindlingsGalleryView') || '6col'; // View mode for Mindlings gallery

// Default collection address
const DEFAULT_COLLECTION = '4169793782b418e3dbb9fd36b364388ceb63321a743009b9dfc2378392016a0d';
const MINDLINGS_COLLECTION = '5YugNNZcTAPY2tVCv5PDLPmjyCgK4PKQnmn6b36d4XCr'; // Mindlings collection address (corrected)

// Display order: ELDERS → MUSHROOM HEAD → OGs → FOUNDERS (each group by sequence number where applicable)
const DISPLAY_ORDER = { Elder: 0, 'Mushroom Head': 1, OG: 2, Founder: 3 };
function getNftType(nft) {
  const attrs = nft.attributes || [];
  const typeAttr = attrs.find(a => (a.trait_type || a.name) === 'Type');
  return (typeAttr && typeAttr.value) ? String(typeAttr.value).trim() : (nft.originalData && nft.originalData.Type) ? String(nft.originalData.Type).trim() : '';
}
function getSequenceFromName(name) {
  if (!name || typeof name !== 'string') return 0;
  const founderMatch = name.match(/Mindfolk Founder #(\d+)/i);
  if (founderMatch) return parseInt(founderMatch[1], 10);
  const elderMatch = name.match(/Mindfolk Elder #(\d+)/i);
  if (elderMatch) return parseInt(elderMatch[1], 10);
  return 0;
}
function sortMindfolkByDisplayOrder(nfts) {
  if (!nfts || nfts.length === 0) return nfts;
  return [...nfts].sort((a, b) => {
    const typeA = getNftType(a);
    const typeB = getNftType(b);
    const orderA = DISPLAY_ORDER[typeA] ?? 99;
    const orderB = DISPLAY_ORDER[typeB] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    const seqA = getSequenceFromName(a.name);
    const seqB = getSequenceFromName(b.name);
    return seqA - seqB;
  });
}

// Solana wallet or SNS (.sol) — resolve to pubkey via Solana Name Service proxy
const SNS_RESOLVE_PROXY = 'https://sdk-proxy.sns.id/resolve/';
const SOLANA_PUBKEY_BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SNS_DOMAIN_LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * @returns {Promise<{ pubkey: string, displayLabel: string|null }|{ error: string }>}
 */
async function resolveWalletOrDomain(raw) {
  const t = (raw || '').trim();
  if (!t) return { error: 'Please enter a wallet address or a .sol name.' };
  if (SOLANA_PUBKEY_BASE58_RE.test(t)) {
    return { pubkey: t, displayLabel: null };
  }
  let label = t.replace(/^@/, '').toLowerCase();
  if (label.endsWith('.sol')) label = label.slice(0, -4);
  if (!SNS_DOMAIN_LABEL_RE.test(label)) {
    return { error: 'Enter a valid Solana address (32–44 characters) or a .sol domain (e.g. nomadz.sol).' };
  }
  try {
    const res = await fetch(SNS_RESOLVE_PROXY + encodeURIComponent(label));
    const data = await res.json().catch(() => ({}));
    if (data.s === 'ok' && data.result && typeof data.result === 'string') {
      return { pubkey: data.result, displayLabel: `${label}.sol` };
    }
    const msg = (data && data.result) ? String(data.result) : 'Domain not found';
    return { error: msg };
  } catch (e) {
    console.warn('SNS resolve failed:', e);
    return { error: 'Could not resolve .sol domain. Check your connection or try the wallet address.' };
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  
  // Load founder metadata for modal display
  try {
    const response = await fetch('data/founder-metadata.json');
    if (response.ok) {
      const founderData = await response.json();
      founderData.forEach(item => {
        if (item.mintAddress && item.metadata) {
          founderMetadataMap.set(item.mintAddress.trim(), item.metadata);
        }
      });
      console.log(`✓ Loaded ${founderMetadataMap.size} founder metadata entries for modal display`);
    }
  } catch (error) {
    console.warn('Could not load founder metadata:', error);
  }
  
  // Load popup image URLs from CSV (column F)
  try {
    const response = await fetch('data/mindfolk-popup-images.json');
    if (response.ok) {
      const popupData = await response.json();
      // Populate maps from JSON
      if (popupData.byName && typeof popupData.byName === 'object') {
        Object.entries(popupData.byName).forEach(([name, url]) => {
          if (name && url) {
            popupImageMapByName.set(name.trim(), url.trim());
          }
        });
      }
      if (popupData.byMint && typeof popupData.byMint === 'object') {
        Object.entries(popupData.byMint).forEach(([mint, url]) => {
          if (mint && url) {
            popupImageMapByMint.set(mint.trim(), url.trim());
          }
        });
      }
      console.log(`✓ Loaded ${popupImageMapByName.size} popup image URLs by name`);
      console.log(`✓ Loaded ${popupImageMapByMint.size} popup image URLs by mint`);
    }
  } catch (error) {
    console.warn('Could not load popup image URLs:', error);
  }
  
  // Load Arweave image mappings
  try {
    const response = await fetch('arweave_image_mapping.json');
    if (response.ok) {
      const arweaveData = await response.json();
      // Populate map from JSON (filename -> Arweave URL)
      Object.entries(arweaveData).forEach(([filename, url]) => {
        if (filename && url) {
          arweaveImageMap.set(filename.trim(), url.trim());
        }
      });
      console.log(`✓ Loaded ${arweaveImageMap.size} Arweave image mappings`);
    }
  } catch (error) {
    console.warn('Could not load Arweave image mappings:', error);
  }
  
  // Load merged Mindfolk data (mint ID -> Arweave URL)
  // Note: This file uses JavaScript object notation, so we need to parse it carefully
  try {
    const response = await fetch('merged_mindfolk_data.json');
    if (response.ok) {
      const text = await response.text();
      // Try to parse as JSON first (in case it's valid JSON)
      let mergedData;
      try {
        mergedData = JSON.parse(text);
      } catch (parseError) {
        // If JSON parsing fails, try to evaluate as JavaScript (not recommended but needed for this format)
        // We'll use Function constructor to safely evaluate
        try {
          mergedData = new Function('return ' + text)();
        } catch (evalError) {
          console.warn('Could not parse merged Mindfolk data:', evalError);
          mergedData = null;
        }
      }
      
      if (mergedData && Array.isArray(mergedData)) {
        mergedData.forEach(item => {
          if (item.mintid && item.metadata) {
            arweaveMintMap.set(item.mintid.trim(), item.metadata.trim());
          }
        });
        console.log(`✓ Loaded ${arweaveMintMap.size} Arweave URLs by mint ID`);
      }
    }
  } catch (error) {
    console.warn('Could not load merged Mindfolk data:', error);
  }
  
  // Check if collection address is in URL params, otherwise use default
  const urlParams = new URLSearchParams(window.location.search);
  let collectionAddress = urlParams.get('collection');
  
  if (!collectionAddress) {
    collectionAddress = DEFAULT_COLLECTION;
  }
  
  // Load the collection automatically - no input field needed
  loadCollection(collectionAddress);
  
  // Load Mindlings mint addresses for wallet filtering (doesn't display anything)
  loadMindlingsMintAddresses();
  
  // Listen for wallet connection to update token balance and load wallet NFTs
  window.addEventListener('walletConnected', () => {
    console.log('Wallet connected event received, updating balance and loading NFTs...');
    if (window.refreshTokenBalance) {
      window.refreshTokenBalance();
    }
    if (window.updateTokenBalanceDisplay) {
      window.updateTokenBalanceDisplay();
    }
    // Load wallet NFTs after a short delay to ensure wallet state is updated
    setTimeout(() => {
      loadWalletNFTs();
    }, 1000);
  });
  
  // Listen for wallet disconnection to clear wallet NFTs display
  window.addEventListener('walletDisconnected', () => {
    const walletNFTsDisplay = document.getElementById('walletNFTsDisplay');
    if (walletNFTsDisplay) {
      walletNFTsDisplay.style.display = 'none';
    }
  });
  
  // Check periodically if wallet is connected and update token balance
  setTimeout(() => {
    if (window.WALLET_STATE && window.WALLET_STATE.connected && window.updateTokenBalanceDisplay) {
      window.updateTokenBalanceDisplay();
    }
  }, 2000);
});

function setupEventListeners() {
  // Collection input and LOAD button removed - using fixed collection only
  // Search input removed - no search functionality for now

  // Load more button
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', loadMoreNFTs);
  }
  
  // Load all button
  const loadAllBtn = document.getElementById('loadAllBtn');
  if (loadAllBtn) {
    loadAllBtn.addEventListener('click', loadAllNFTs);
  }
  
  // Main gallery view switcher buttons (only for main gallery)
  const view6ColBtn = document.getElementById('view6Col');
  const view12ColBtn = document.getElementById('view12Col');
  const viewListBtn = document.getElementById('viewList');
  
  if (view6ColBtn) {
    view6ColBtn.addEventListener('click', () => switchMainGalleryView('6col'));
  }
  if (view12ColBtn) {
    view12ColBtn.addEventListener('click', () => switchMainGalleryView('12col'));
  }
  if (viewListBtn) {
    viewListBtn.addEventListener('click', () => switchMainGalleryView('list'));
  }

  // View wallet NFTs button - use wallet from wallet.js
  const viewWalletNFTsBtn = document.getElementById('viewWalletNFTsBtn');
  if (viewWalletNFTsBtn) {
    viewWalletNFTsBtn.addEventListener('click', handleViewWalletNFTs);
  }

  // Search by wallet address - load NFTs for any pasted address
  const walletAddressSearch = document.getElementById('walletAddressSearch');
  const loadAddressNFTsBtn = document.getElementById('loadAddressNFTsBtn');
  if (loadAddressNFTsBtn && walletAddressSearch) {
    loadAddressNFTsBtn.addEventListener('click', () => loadNFTsForAddress(walletAddressSearch.value));
  }
  if (walletAddressSearch) {
    walletAddressSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadNFTsForAddress(walletAddressSearch.value);
    });
  }
  
  // Mindlings collection event listeners removed - no separate gallery section
  // Mindlings NFTs are only shown in wallet view, mixed with Mindfolk NFTs
  
  // Wallet connection is handled by wallet.js
  // Just wait for it to be ready
  if (window.walletConnection) {
    console.log('✅ Wallet connection module loaded');
  } else {
    console.log('Waiting for wallet connection module...');
  }
}

async function handleLoadCollection() {
  const collectionInput = document.getElementById('collectionInput');
  const address = collectionInput.value.trim();
  
  if (!address) {
    alert('Please enter a collection address');
    return;
  }

  await loadCollection(address);
}

async function loadCollection(collectionAddress) {
  try {
    showLoading(true);
    currentCollection = collectionAddress;
    allNFTs = [];
    displayedNFTs = [];
    currentPage = 0;

    // Clear gallery
    document.getElementById('galleryGrid').innerHTML = '';
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('galleryHeader').style.display = 'none';

    // Fetch NFTs using Helius API or alternative method
    const nfts = await fetchNFTsFromCollection(collectionAddress);
    
    if (nfts && nfts.length > 0) {
      allNFTs = nfts;
      displayedNFTs = [...allNFTs];
      
      // Show gallery header
      document.getElementById('galleryHeader').style.display = 'block';
      document.getElementById('totalCount').textContent = `${allNFTs.length} NFTs`;
      
      // Set up view switcher buttons (in case they weren't available earlier)
      const view6ColBtn = document.getElementById('view6Col');
      const view12ColBtn = document.getElementById('view12Col');
      const viewListBtn = document.getElementById('viewList');
      
      if (view6ColBtn && !view6ColBtn.hasAttribute('data-listener-attached')) {
        view6ColBtn.addEventListener('click', () => switchMainGalleryView('6col'));
        view6ColBtn.setAttribute('data-listener-attached', 'true');
      }
      if (view12ColBtn && !view12ColBtn.hasAttribute('data-listener-attached')) {
        view12ColBtn.addEventListener('click', () => switchMainGalleryView('12col'));
        view12ColBtn.setAttribute('data-listener-attached', 'true');
      }
      if (viewListBtn && !viewListBtn.hasAttribute('data-listener-attached')) {
        viewListBtn.addEventListener('click', () => switchMainGalleryView('list'));
        viewListBtn.setAttribute('data-listener-attached', 'true');
      }
      
      // Display first batch
      displayNFTs(displayedNFTs.slice(0, CONFIG.BATCH_SIZE));
      currentPage = 1; // Set to 1 so first "Load More" click loads the next batch
      updateLoadMoreButton();
      
      // Apply current view mode to main gallery
      switchMainGalleryView(mainGalleryView);
    } else {
      showError('No NFTs found in this collection');
      document.getElementById('emptyState').style.display = 'block';
    }
  } catch (error) {
    console.error('Error loading collection:', error);
    showError(`Error loading collection: ${error.message}`);
    document.getElementById('emptyState').style.display = 'block';
  } finally {
    showLoading(false);
  }
}

// Function to load Mindlings collection mint addresses for wallet filtering (doesn't display anything)
async function loadMindlingsMintAddresses() {
  try {
    // Load from local JSON file to get mint addresses for wallet filtering
    const response = await fetch('data/mindlings-nfts.json');
    if (response.ok) {
      const nftData = await response.json();
      console.log(`✓ Loaded ${nftData.length} Mindlings NFT mint addresses for wallet filtering`);
      
      // Store mint addresses and data for wallet filtering
      mindlingsCollectionMintAddresses.clear();
      mindlingsCollectionNFTDataMap.clear();
      
      nftData.forEach(nft => {
        const mint = (nft.mint || '').trim();
        if (mint) {
          mindlingsCollectionMintAddresses.add(mint);
          // Store full NFT data for later use when displaying wallet NFTs
          mindlingsCollectionNFTDataMap.set(mint, {
            mint: mint,
            name: nft.name || 'Unnamed NFT',
            image: nft.image || '',
            description: nft.description || '',
            attributes: nft.attributes || [],
            external_url: nft.external_url || '',
            symbol: nft.symbol || ''
          });
        }
      });
      
      console.log(`✓ Stored ${mindlingsCollectionMintAddresses.size} Mindlings mint addresses for filtering`);
    } else {
      console.warn('Mindlings collection JSON file not found or not accessible');
    }
  } catch (error) {
    console.warn('Could not load Mindlings JSON file for wallet filtering:', error);
  }
}

async function fetchNFTsFromCollection(collectionAddress) {
  try {
    // First, try to load from the local JSON file (faster and more reliable)
    try {
      const response = await fetch('data/mindfolk-nfts.json');
      if (response.ok) {
        const nftData = await response.json();
        console.log(`✓ Loaded ${nftData.length} NFTs from local JSON file`);
        // Format the JSON data to match our NFT structure
        // Store both original image URL (for modal) and thumbnails (for gallery cards)
        const formattedNFTs = nftData.map((nft, index) => {
          const mint = nft.mintAddress || '';
          const name = nft.Name || 'Unnamed NFT';
          const originalImageUrl = (nft.URL && nft.URL.trim()) ? nft.URL.trim() : '';
          const thumbnailURLs = nft.thumbnailURLs || {}; // Object with 190x190, 100x100, 30x30
          
          // Log first few to debug
          if (index < 5) {
            console.log(`NFT ${index + 1}: name="${name}", original="${originalImageUrl}", thumbnails=${Object.keys(thumbnailURLs).length > 0 ? 'yes' : 'no'}`);
          }
          
          return {
            mint: mint,
            name: name,
            image: originalImageUrl, // Original image URL (for modal popup)
            originalImage: originalImageUrl, // Keep original for modal
            thumbnailURLs: thumbnailURLs, // Thumbnails for gallery cards (190x190, 100x100, 30x30)
            attributes: [
              { trait_type: 'Type', value: nft.Type || '' },
              { trait_type: 'Filetype', value: nft.Filetype || '' }
            ],
            collection: collectionAddress,
            description: `Mindfolk NFT: ${name}`
          };
        });
        
        // Remove duplicates by mint address
        const uniqueNFTs = [];
        const seenMints = new Set();
        for (const nft of formattedNFTs) {
          const mint = nft.mint && nft.mint.trim() ? nft.mint.trim() : '';
          if (mint && !seenMints.has(mint)) {
            seenMints.add(mint);
            uniqueNFTs.push(nft);
          } else if (!mint) {
            // Keep NFTs without mint addresses (shouldn't happen, but handle gracefully)
            uniqueNFTs.push(nft);
          } else {
            // Duplicate found - log it
            console.warn(`Duplicate NFT detected - Mint: ${mint}, Name: ${nft.name}`);
          }
        }
        
        if (uniqueNFTs.length !== formattedNFTs.length) {
          console.log(`✓ Removed ${formattedNFTs.length - uniqueNFTs.length} duplicate NFTs`);
        }
        
        // Store mint addresses and NFT data for filtering wallet NFTs
        collectionMintAddresses.clear();
        collectionNFTDataMap.clear();
        // Also store the original JSON data for popup image URL access
        nftData.forEach(originalNft => {
          const mint = (originalNft.mintAddress || '').trim();
          if (mint) {
            collectionMintAddresses.add(mint);
            // Find the corresponding formatted NFT
            const formattedNFT = uniqueNFTs.find(n => n.mint.trim() === mint);
            if (formattedNFT) {
              // Store both formatted NFT data and original JSON data
              collectionNFTDataMap.set(mint, {
                ...formattedNFT,
                // Keep original JSON fields for popup image access
                originalData: originalNft
              });
            }
          }
        });
        console.log(`✓ Stored ${collectionMintAddresses.size} collection mint addresses for wallet filtering`);
        
        // Log statistics
        const withImages = uniqueNFTs.filter(nft => nft.image && nft.image.trim()).length;
        const withoutImages = uniqueNFTs.length - withImages;
        console.log(`✓ Loaded ${uniqueNFTs.length} unique NFTs from JSON file`);
        console.log(`  - ${withImages} with image URLs`);
        if (withoutImages > 0) {
          console.warn(`  - ${withoutImages} without image URLs`);
        }
        if (uniqueNFTs.length > 0) {
          console.log('Sample NFT:', {
            name: uniqueNFTs[0].name,
            image: uniqueNFTs[0].image,
            mint: uniqueNFTs[0].mint
          });
        }
        // Order: Elders → Mushroom Head → OGs → Founders (with sequence numbers within each group)
        return sortMindfolkByDisplayOrder(uniqueNFTs);
      }
    } catch (jsonError) {
      console.warn('Could not load local JSON file, falling back to API:', jsonError);
    }

    // Fallback: Try Helius API if API key is set
    if (CONFIG.HELIUS_API_KEY) {
      return await fetchNFTsViaHelius(collectionAddress);
    }

    // Final fallback: Use public RPC with Metaplex
    return await fetchNFTsViaRPC(collectionAddress);
  } catch (error) {
    console.error('Error fetching NFTs:', error);
    throw error;
  }
}

async function fetchNFTsViaHelius(collectionAddress) {
  // Use Helius DAS API to fetch all NFTs from collection
  const apiKey = CONFIG.HELIUS_API_KEY;
  const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  
  // Validate and potentially convert collection address
  let validatedAddress = collectionAddress.trim();
  
  // Wait for Solana Web3.js to be available if not yet loaded
  let web3 = window.solanaWeb3 || (typeof solanaWeb3 !== 'undefined' ? solanaWeb3 : null);
  
  if (!web3 || !web3.PublicKey) {
    // Try to wait a bit for it to load
    await new Promise(resolve => setTimeout(resolve, 100));
    web3 = window.solanaWeb3 || (typeof solanaWeb3 !== 'undefined' ? solanaWeb3 : null);
  }
  
  if (!web3 || !web3.PublicKey) {
    console.warn('Solana Web3.js not available for address validation');
  } else {
    // Check if address is in hex format (even length, only hex characters, 64 chars for 32 bytes)
    const isHex = /^[0-9a-fA-F]+$/.test(validatedAddress) && validatedAddress.length === 64;
    
    if (isHex) {
      // It's a hex string - convert to base58 using Solana Web3.js
      try {
        // Convert hex to bytes then create PublicKey (which will convert to base58)
        const hexBytes = new Uint8Array(
          validatedAddress.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
        );
        const pubkey = new web3.PublicKey(hexBytes);
        validatedAddress = pubkey.toString();
        console.log(`✓ Converted hex collection address to base58: ${validatedAddress}`);
      } catch (convertError) {
        throw new Error(`Failed to convert hex collection address to base58: ${convertError.message}. Address: "${collectionAddress}"`);
      }
    } else {
      // Try to validate if it's already a valid base58 public key
      try {
        new web3.PublicKey(validatedAddress);
        console.log(`✓ Collection address validated as base58: ${validatedAddress}`);
      } catch (validateError) {
        throw new Error(`Invalid collection address: "${collectionAddress}". Must be a valid Solana public key (base58, ~44 chars) or 64-character hex string. Error: ${validateError.message}`);
      }
    }
  }
  
  try {
    let allNFTs = [];
    let page = 1;
    let hasMore = true;
    
    // Fetch NFTs in pages since API has limits
    while (hasMore && page <= 10) { // Limit to 10 pages (10,000 NFTs max)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `page-${page}`,
          method: 'getAssetsByGroup',
          params: {
            groupKey: 'collection',
            groupValue: validatedAddress, // Use validated/converted address
            page: page,
            limit: 1000, // Get up to 1000 NFTs per page
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Helius API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(`Helius API error: ${data.error.message}`);
      }
      
      if (data.result && data.result.items) {
        const pageNFTs = data.result.items.map(item => formatNFTDataFromHeliusDAS(item));
        allNFTs = allNFTs.concat(pageNFTs);
        
        // Check if there are more pages
        if (data.result.items.length < 1000) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }
    
    console.log(`Fetched ${allNFTs.length} NFTs from collection ${validatedAddress}`);
    return allNFTs;
  } catch (error) {
    console.error('Helius fetch error:', error);
    throw error;
  }
}

function formatNFTDataFromHeliusDAS(item) {
  // Format Helius DAS API response
  const content = item.content || {};
  const metadata = content.metadata || {};
  const files = content.files || [];
  
  // Get mint address - DAS API uses 'id' field for mint address
  const mint = item.id || item.mint || '';
  
  // Get image from various possible locations
  let image = '';
  if (files && files.length > 0) {
    image = files[0].cdn_uri || files[0].uri || files[0].file || '';
  }
  if (!image && content.metadata?.image) {
    image = content.metadata.image;
  }
  if (!image && content.json_uri) {
    // Try to construct image URL from JSON URI
    const baseUrl = content.json_uri.split('/').slice(0, -1).join('/');
    image = `${baseUrl}/image.png`;
  }
  
  // Get name
  let name = metadata.name || item.content?.metadata?.name || '';
  if (!name && mint) {
    name = `NFT ${mint.slice(0, 4)}...${mint.slice(-4)}`;
  }
  if (!name) {
    name = 'Unnamed NFT';
  }
  
  // Get attributes
  let attributes = [];
  if (metadata.attributes && Array.isArray(metadata.attributes)) {
    attributes = metadata.attributes;
  } else if (item.attributes && Array.isArray(item.attributes)) {
    attributes = item.attributes.map(attr => ({
      trait_type: attr.trait_type || attr.name || 'Trait',
      value: attr.value || ''
    }));
  }
  
  return {
    mint: item.id || item.mint || '',
    name: name,
    image: image || `data:image/svg+xml,${encodeURIComponent(`
      <svg width="500" height="500" xmlns="http://www.w3.org/2000/svg">
        <rect width="500" height="500" fill="#1a1a1a"/>
        <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="32" fill="#888" text-anchor="middle" dominant-baseline="middle">No Image Available</text>
      </svg>
    `)}`,
    description: metadata.description || content.metadata?.description || '',
    attributes: attributes,
    external_url: metadata.external_url || content.metadata?.external_url || '',
  };
}

async function fetchNFTsViaRPC(collectionAddress) {
  console.warn('Using fallback method - recommend using Helius API for better results');
  
  // Try using Magic Eden API first
  try {
    // Magic Eden v2 API - get collection stats and then listings
    const collectionUrl = `https://api-mainnet.magiceden.io/v2/collections/${collectionAddress}/stats`;
    const collectionResponse = await fetch(collectionUrl);
    
    if (collectionResponse.ok) {
      // Try to get listings from the collection
      const listingsUrl = `https://api-mainnet.magiceden.io/v2/collections/${collectionAddress}/listings?offset=0&limit=500`;
      const listingsResponse = await fetch(listingsUrl);
      
      if (listingsResponse.ok) {
        const listingsData = await listingsResponse.json();
        if (listingsData && listingsData.length > 0) {
          return formatMagicEdenData(listingsData);
        }
      }
      
      // Try alternative: use Helius without API key (might have rate limits)
      return await fetchNFTsViaHeliusNoKey(collectionAddress);
    }
  } catch (e) {
    console.error('Magic Eden API error:', e);
  }

  // Try Helius without API key
  try {
    return await fetchNFTsViaHeliusNoKey(collectionAddress);
  } catch (e) {
    console.error('Helius no-key fetch error:', e);
  }

  // As a last resort, return demo data
  console.warn('Using demo data - please configure Helius API key for real NFT data');
  return generateDemoNFTs(collectionAddress);
}

async function fetchNFTsViaHeliusNoKey(collectionAddress) {
  // Try Helius public endpoint (may have rate limits)
  const url = 'https://mainnet.helius-rpc.com/?api-key=';
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'my-id',
      method: 'getAssetsByGroup',
      params: {
        groupKey: 'collection',
        groupValue: collectionAddress,
        page: 1,
        limit: 1000,
      },
    }),
  });

  if (response.ok) {
    const data = await response.json();
    if (data.result && data.result.items) {
      return data.result.items.map(item => formatNFTDataFromHeliusDAS(item));
    }
  }
  
  throw new Error('Helius fetch failed');
}

function formatNFTData(item) {
  return {
    mint: item.onChainMetadata?.mint || item.account || '',
    name: item.onChainMetadata?.metadata?.data?.name || 
          item.metadata?.name || 
          `NFT #${item.onChainMetadata?.metadata?.data?.name?.split('#')[1] || 'Unknown'}`,
    image: item.onChainMetadata?.metadata?.data?.uri || 
           item.metadata?.image || 
           item.content?.files?.[0]?.uri || '',
    description: item.metadata?.description || '',
    attributes: item.metadata?.attributes || [],
    external_url: item.metadata?.external_url || '',
  };
}

function formatMagicEdenData(data) {
  // Format Magic Eden API response
  // This is a placeholder - actual implementation would depend on their API
  return data.map((item, index) => ({
    mint: item.tokenMint || '',
    name: item.title || `NFT #${index + 1}`,
    image: item.img || '',
    description: '',
    attributes: [],
    external_url: '',
  }));
}

function generateDemoNFTs(collectionAddress) {
  // Generate demo NFTs for testing - using data URI instead of external URLs
  const demoNFTs = [];
  const count = 20; // Demo count
  
  // Create a simple placeholder SVG as data URI
  const createPlaceholderSVG = (text) => {
    return `data:image/svg+xml,${encodeURIComponent(`
      <svg width="500" height="500" xmlns="http://www.w3.org/2000/svg">
        <rect width="500" height="500" fill="#1a1a1a"/>
        <text x="50%" y="45%" font-family="Arial, sans-serif" font-size="48" fill="#ffc107" text-anchor="middle" dominant-baseline="middle">NFT #${text}</text>
        <text x="50%" y="55%" font-family="Arial, sans-serif" font-size="24" fill="#888" text-anchor="middle" dominant-baseline="middle">Demo Image</text>
      </svg>
    `)}`;
  };
  
  for (let i = 1; i <= count; i++) {
    demoNFTs.push({
      mint: `${collectionAddress.slice(0, 8)}...${i.toString().padStart(4, '0')}`,
      name: `NFT #${i}`,
      image: createPlaceholderSVG(i),
      description: `Demo NFT #${i} from collection`,
      attributes: [
        { trait_type: 'Trait 1', value: 'Value 1' },
        { trait_type: 'Trait 2', value: 'Value 2' },
      ],
      external_url: '',
    });
  }
  
  return demoNFTs;
}

function displayNFTs(nfts) {
  const galleryGrid = document.getElementById('galleryGrid');
  
  // Track already displayed mint addresses AND names to prevent duplicates
  const displayedMints = new Set();
  const displayedNames = new Set();
  const existingCards = galleryGrid.querySelectorAll('.nft-card');
  existingCards.forEach(card => {
    const cardMint = card.getAttribute('data-mint');
    const cardName = card.getAttribute('data-name');
    if (cardMint) {
      displayedMints.add(cardMint.trim());
    }
    if (cardName) {
      displayedNames.add(cardName.trim());
    }
  });
  
  nfts.forEach((nft) => {
    const mint = nft.mint && nft.mint.trim() ? nft.mint.trim() : '';
    const name = nft.name && nft.name.trim() ? nft.name.trim() : '';
    
    // Skip if this mint is already displayed
    if (mint && displayedMints.has(mint)) {
      console.warn(`Skipping duplicate NFT by mint: ${nft.name} (Mint: ${mint})`);
      return;
    }
    
    // Also check by name as fallback (in case mint is missing)
    if (name && displayedNames.has(name)) {
      console.warn(`Skipping duplicate NFT by name: ${nft.name} (Mint: ${mint || 'N/A'})`);
      return;
    }
    
    const nftCard = createNFTCard(nft, true); // true = main gallery
    galleryGrid.appendChild(nftCard);
    
    if (mint) {
      displayedMints.add(mint);
    }
    if (name) {
      displayedNames.add(name);
    }
  });

  // Update loaded count
  const loadedCount = document.querySelectorAll('.nft-card').length;
  document.getElementById('loadedCount').textContent = `${loadedCount} Loaded`;
}

function loadMoreNFTs() {
  const start = currentPage * CONFIG.BATCH_SIZE;
  const end = start + CONFIG.BATCH_SIZE;
  const nextBatch = displayedNFTs.slice(start, end);

  if (nextBatch.length > 0) {
    displayNFTs(nextBatch);
    currentPage++;
    updateLoadMoreButton();
    // Apply current view mode to newly added cards
    applyMainGalleryView();
  }
}

function loadAllNFTs() {
  const loadedCount = document.querySelectorAll('.nft-card').length;
  const remainingNFTs = displayedNFTs.slice(loadedCount);
  
  if (remainingNFTs.length > 0) {
    displayNFTs(remainingNFTs);
    currentPage = Math.ceil(displayedNFTs.length / CONFIG.BATCH_SIZE);
    updateLoadMoreButton();
    // Apply current view mode to newly added cards
    applyMainGalleryView();
  }
}

function updateLoadMoreButton() {
  const loadMoreContainer = document.getElementById('loadMoreContainer');
  const loadedCount = document.querySelectorAll('.nft-card').length;
  
  if (loadedCount < displayedNFTs.length) {
    loadMoreContainer.style.display = 'block';
  } else {
    loadMoreContainer.style.display = 'none';
  }
}

// ========================================
// Mindlings Collection Functions
// ========================================

function displayMindlingsNFTs(nfts) {
  const galleryGrid = document.getElementById('mindlingsGalleryGrid');
  if (!galleryGrid) return;
  
  const displayedMints = new Set();
  const displayedNames = new Set();
  const existingCards = galleryGrid.querySelectorAll('.nft-card');
  existingCards.forEach(card => {
    const cardMint = card.getAttribute('data-mint');
    const cardName = card.getAttribute('data-name');
    if (cardMint) {
      displayedMints.add(cardMint.trim());
    }
    if (cardName) {
      displayedNames.add(cardName.trim());
    }
  });
  
  nfts.forEach((nft) => {
    const mint = nft.mint && nft.mint.trim() ? nft.mint.trim() : '';
    const name = nft.name && nft.name.trim() ? nft.name.trim() : '';
    
    if (mint && displayedMints.has(mint)) {
      return;
    }
    if (name && displayedNames.has(name)) {
      return;
    }
    
    const nftCard = createNFTCard(nft, true);
    galleryGrid.appendChild(nftCard);
    
    if (mint) {
      displayedMints.add(mint);
    }
    if (name) {
      displayedNames.add(name);
    }
  });

  const loadedCount = document.querySelectorAll('#mindlingsGalleryGrid .nft-card').length;
  const mindlingsLoadedCount = document.getElementById('mindlingsLoadedCount');
  if (mindlingsLoadedCount) {
    mindlingsLoadedCount.textContent = `${loadedCount} Loaded`;
  }
}

function loadMoreMindlingsNFTs() {
  const start = mindlingsCurrentPage * CONFIG.BATCH_SIZE;
  const end = start + CONFIG.BATCH_SIZE;
  const nextBatch = mindlingsDisplayedNFTs.slice(start, end);

  if (nextBatch.length > 0) {
    displayMindlingsNFTs(nextBatch);
    mindlingsCurrentPage++;
    updateMindlingsLoadMoreButton();
    applyMindlingsGalleryView();
  }
}

function loadAllMindlingsNFTs() {
  const loadedCount = document.querySelectorAll('#mindlingsGalleryGrid .nft-card').length;
  const remainingNFTs = mindlingsDisplayedNFTs.slice(loadedCount);
  
  if (remainingNFTs.length > 0) {
    displayMindlingsNFTs(remainingNFTs);
    mindlingsCurrentPage = Math.ceil(mindlingsDisplayedNFTs.length / CONFIG.BATCH_SIZE);
    updateMindlingsLoadMoreButton();
    applyMindlingsGalleryView();
  }
}

function updateMindlingsLoadMoreButton() {
  const loadMoreContainer = document.getElementById('mindlingsLoadMoreContainer');
  if (!loadMoreContainer) return;
  
  const loadedCount = document.querySelectorAll('#mindlingsGalleryGrid .nft-card').length;
  
  if (loadedCount < mindlingsDisplayedNFTs.length) {
    loadMoreContainer.style.display = 'block';
  } else {
    loadMoreContainer.style.display = 'none';
  }
}

function switchMindlingsGalleryView(view) {
  mindlingsGalleryView = view;
  localStorage.setItem('mindlingsGalleryView', view);
  
  // Update button states
  const viewBtns = document.querySelectorAll('#mindlingsGalleryHeader .gallery-view-btn');
  viewBtns.forEach(btn => {
    if (btn.dataset.view === view) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Update gallery grid class
  const galleryGrid = document.getElementById('mindlingsGalleryGrid');
  if (galleryGrid) {
    galleryGrid.className = `row g-4 text-start gallery-view-${view}`;
  }
  
  // Re-apply view to existing cards
  applyMindlingsGalleryView();
  
  // Update image sources for all cards based on new view
  updateMindlingsCardImagesForView(view);
  
  // Update load more button
  updateMindlingsLoadMoreButton();
}

function applyMindlingsGalleryView() {
  const cards = document.querySelectorAll('#mindlingsGalleryGrid > div');
  cards.forEach(card => {
    // Remove old column classes
    card.className = card.className.replace(/col-\d+|col-md-\d+|col-lg-\d+|col-xl-\d+|nft-card-list-item/g, '').trim();
    
    // Add new classes based on view
    if (mindlingsGalleryView === 'list') {
      card.classList.add('col-12', 'col-md-4', 'nft-card-list-item');
    } else if (mindlingsGalleryView === '12col') {
      /* Dense tiles on small screens (was col-6 = only 2 per row on mobile = huge cards) */
      card.classList.add('col-4', 'col-sm-3', 'col-md-2', 'col-lg-2', 'col-xl-1');
    } else {
      // 6col (default)
      card.classList.add('col-6', 'col-md-4', 'col-lg-3', 'col-xl-2');
    }
  });
}

function updateMindlingsCardImagesForView(view) {
  // Update all image sources in Mindlings gallery cards based on the new view
  const cards = document.querySelectorAll('#mindlingsGalleryGrid .nft-card');
  
  cards.forEach(card => {
    const img = card.querySelector('.nft-card-image img');
    if (!img) return;
    
    // Get thumbnail URLs from data attribute
    const thumbnailURLsJson = card.getAttribute('data-thumbnail-urls');
    if (!thumbnailURLsJson) return;
    
    try {
      const thumbnailURLs = JSON.parse(thumbnailURLsJson);
      if (!thumbnailURLs || typeof thumbnailURLs !== 'object') return;
      
      // Get original image as fallback
      const originalImage = card.getAttribute('data-original-image') || '';
      
      // Select appropriate thumbnail based on view
      let imageUrl = '';
      if (view === 'list') {
        imageUrl = thumbnailURLs['30x30'] || thumbnailURLs['small'] || '';
      } else if (view === '12col') {
        imageUrl = thumbnailURLs['100x100'] || thumbnailURLs['medium'] || '';
      } else {
        // Default 6-col view
        imageUrl = thumbnailURLs['190x190'] || thumbnailURLs['large'] || '';
      }
      
      // Fallback to original image if thumbnail not available
      if (!imageUrl || imageUrl.trim() === '') {
        imageUrl = originalImage || '';
      }
      
      // Only update if the URL is different to avoid unnecessary reloads
      if (imageUrl && imageUrl !== img.src) {
        img.src = imageUrl;
      }
    } catch (e) {
      console.warn('Error parsing thumbnail URLs for Mindlings card:', e);
    }
  });
}

function switchMainGalleryView(view) {
  mainGalleryView = view;
  localStorage.setItem('mainGalleryView', view);
  
  // Update button states
  const viewBtns = document.querySelectorAll('.gallery-view-btn');
  viewBtns.forEach(btn => {
    if (btn.dataset.view === view) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Update gallery grid class (mosaic = fixed tile sizes; row = list view)
  const galleryGrid = document.getElementById('galleryGrid');
  if (galleryGrid) {
    galleryGrid.className = getMainGalleryGridWrapperClass(view);
  }
  
  // Re-apply view to existing cards
  applyMainGalleryView();
  
  // Update image sources for all cards based on new view
  updateCardImagesForView(view);
  
  // Update load more button for all views
  updateLoadMoreButton();
}

function applyMainGalleryView() {
  document.querySelectorAll('#galleryGrid > div').forEach((card) => {
    if (!card.querySelector('.nft-card')) return;
    card.className = card.className.replace(
      /col-\d+|col-md-\d+|col-lg-\d+|col-xl-\d+|nft-card-list-item|gallery-mosaic-cell|gallery-mosaic-span-full/g,
      ''
    ).trim();

    if (mainGalleryView === 'list') {
      card.classList.add('col-12', 'col-md-4', 'nft-card-list-item');
    } else {
      card.classList.add('gallery-mosaic-cell');
    }
  });
}

function updateCardImagesForView(view) {
  // Update all image sources in gallery cards based on the new view
  const cards = document.querySelectorAll('#galleryGrid .nft-card');
  
  cards.forEach(card => {
    const img = card.querySelector('.nft-card-image img');
    if (!img) return;
    
    // Get thumbnail URLs from data attribute (stored when card was created)
    const thumbnailURLsJson = card.getAttribute('data-thumbnail-urls');
    if (!thumbnailURLsJson) return;
    
    try {
      const thumbnailURLs = JSON.parse(thumbnailURLsJson);
      if (!thumbnailURLs || typeof thumbnailURLs !== 'object') return;
      
      // Get original image as fallback
      const originalImage = card.getAttribute('data-original-image') || '';
      
      // Select appropriate thumbnail based on view
      let imageUrl = '';
      if (view === 'list') {
        imageUrl = thumbnailURLs['30x30'] || thumbnailURLs['small'] || '';
      } else if (view === '12col') {
        imageUrl = thumbnailURLs['100x100'] || thumbnailURLs['medium'] || '';
      } else {
        // Default 6-col view
        imageUrl = thumbnailURLs['190x190'] || thumbnailURLs['large'] || '';
      }
      
      // Fallback to original image if thumbnail not available
      if (!imageUrl || imageUrl.trim() === '') {
        imageUrl = originalImage || '';
      }
      
      // Only update if the URL is different to avoid unnecessary reloads
      if (imageUrl && imageUrl !== img.src) {
        img.src = imageUrl;
      }
    } catch (e) {
      console.warn('Error parsing thumbnail URLs for card:', e);
    }
  });
}


function createNFTCard(nft, isMainGallery = true) {
  const col = document.createElement('div');
  
  // MY GALLERY (connected / pasted wallet): same mosaic tiles as main gallery 6-col view
  if (!isMainGallery) {
    col.className = 'gallery-mosaic-cell';
  } else if (mainGalleryView === 'list') {
    col.className = 'col-12 col-md-4 nft-card-list-item';
  } else {
    col.className = 'gallery-mosaic-cell';
  }

  const card = document.createElement('div');
  card.className = 'nft-card';
  // Add mint address and name as data attributes for duplicate checking
  if (nft.mint && nft.mint.trim()) {
    card.setAttribute('data-mint', nft.mint.trim());
  }
  if (nft.name && nft.name.trim()) {
    card.setAttribute('data-name', nft.name.trim());
  }
  
  // Store thumbnail URLs and original image as data attributes for view switching
  if (nft.thumbnailURLs && typeof nft.thumbnailURLs === 'object') {
    card.setAttribute('data-thumbnail-urls', JSON.stringify(nft.thumbnailURLs));
  }
  if (nft.originalImage && nft.originalImage.trim()) {
    card.setAttribute('data-original-image', nft.originalImage.trim());
  } else if (nft.image && nft.image.trim()) {
    card.setAttribute('data-original-image', nft.image.trim());
  }
  
  card.addEventListener('click', () => showNFTModal(nft));

  const imageDiv = document.createElement('div');
  imageDiv.className = 'nft-card-image';

  // Create a placeholder SVG data URI for missing/broken images
  const createPlaceholderImage = (text = 'No Image') => {
    return `data:image/svg+xml,${encodeURIComponent(`
      <svg width="500" height="500" xmlns="http://www.w3.org/2000/svg">
        <rect width="500" height="500" fill="#1a1a1a"/>
        <text x="50%" y="45%" font-family="Arial, sans-serif" font-size="32" fill="#ffc107" text-anchor="middle" dominant-baseline="middle">${text}</text>
        <text x="50%" y="55%" font-family="Arial, sans-serif" font-size="18" fill="#888" text-anchor="middle" dominant-baseline="middle">Image unavailable</text>
      </svg>
    `)}`;
  };

  const img = document.createElement('img');
  
  // Select thumbnail based on view mode (for main gallery only)
  let imageUrl = '';
  const currentView = typeof mainGalleryView !== 'undefined' ? mainGalleryView : '6col';
  
  // Try to get thumbnail from thumbnailURLs object
  if (nft.thumbnailURLs && typeof nft.thumbnailURLs === 'object' && Object.keys(nft.thumbnailURLs).length > 0) {
    // Both main gallery and MY GALLERY use the same thumbnail selection logic
    // Main gallery selects based on view, MY GALLERY uses default 6-col size (190x190)
    if (isMainGallery) {
      // Main gallery - select based on view
      if (currentView === 'list') {
        imageUrl = nft.thumbnailURLs['30x30'] || nft.thumbnailURLs['small'] || '';
      } else if (currentView === '12col') {
        imageUrl = nft.thumbnailURLs['100x100'] || nft.thumbnailURLs['medium'] || '';
      } else {
        // Default 6-col view
        imageUrl = nft.thumbnailURLs['190x190'] || nft.thumbnailURLs['large'] || '';
      }
    } else {
      // MY GALLERY uses same default size as 6-col view (190x190)
      imageUrl = nft.thumbnailURLs['190x190'] || nft.thumbnailURLs['large'] || '';
    }
  }
  
  // Fallback to thumbnailURL if thumbnailURLs didn't work
  if (!imageUrl && nft.thumbnailURL && nft.thumbnailURL.trim()) {
    imageUrl = nft.thumbnailURL.trim();
  }
  
  // Fallback to original image if no thumbnail available
  if (!imageUrl || imageUrl.trim() === '') {
    imageUrl = (nft.image && nft.image.trim()) ? nft.image.trim() : '';
  }
  
  // Final fallback to placeholder
  if (!imageUrl || imageUrl.trim() === '') {
    imageUrl = createPlaceholderImage(nft.name || 'NFT');
  }
  
  img.src = imageUrl;
  img.alt = nft.name || 'NFT';
  img.loading = 'lazy';
  
  // Handle image load errors - use placeholder instead
  let errorCount = 0;
  img.onerror = function() {
    errorCount++;
    // Only try placeholder once to avoid infinite loop
    if (errorCount === 1 && !this.src.startsWith('data:image/svg+xml')) {
      console.warn(`Failed to load image for NFT "${nft.name}": ${nft.image}`);
      this.src = createPlaceholderImage(nft.name || 'NFT');
    }
  };

  imageDiv.appendChild(img);

  const body = document.createElement('div');
  body.className = 'nft-card-body';

  const name = document.createElement('div');
  name.className = 'nft-card-name';
  // Add class to identify Mindlings NFTs
  if (nft.mint && mindlingsCollectionMintAddresses.has(nft.mint.trim())) {
    name.classList.add('mindling-nft-name');
  }
  name.textContent = nft.name || 'Unnamed NFT';

  // Get Type from attributes or from collection data map
  let typeValue = '';
  if (nft.attributes && Array.isArray(nft.attributes)) {
    const typeAttr = nft.attributes.find(attr => 
      (attr.trait_type === 'Type' || attr.trait_type === 'type' || attr.traitType === 'Type')
    );
    if (typeAttr) {
      typeValue = typeAttr.value || typeAttr.Value || '';
    }
  }
  
  // If not found in attributes, try to get from collection data map
  if (!typeValue && nft.mint) {
    const collectionData = collectionNFTDataMap.get(nft.mint.trim());
    if (collectionData && collectionData.attributes) {
      const typeAttr = collectionData.attributes.find(attr => 
        attr.trait_type === 'Type' || attr.trait_type === 'type'
      );
      if (typeAttr) {
        typeValue = typeAttr.value || '';
      }
    }
  }

  const typeDisplay = document.createElement('div');
  typeDisplay.className = 'nft-card-mint'; // Reusing the same CSS class
  typeDisplay.textContent = typeValue || 'N/A';

  body.appendChild(name);
  body.appendChild(typeDisplay);

  card.appendChild(imageDiv);
  card.appendChild(body);
  col.appendChild(card);

  return col;
}

/**
 * Find .gif URL from Arweave by matching NFT name to filename
 * @param {string} nftName - The NFT name
 * @param {string} nftMint - The NFT mint address (optional, for fallback)
 * @returns {string|null} - The .gif URL from Arweave, or null if not found
 */
function findArweaveGifUrl(nftName, nftMint = '') {
  if (!nftName) return null;
  
  // Try direct name match first (e.g., "Foster Mountain Elder" -> "Foster Mountain Elder.gif")
  const directMatch = `${nftName}.gif`;
  if (arweaveImageMap.has(directMatch)) {
    return arweaveImageMap.get(directMatch);
  }
  
  // Try with sanitized name (replace # with _)
  const sanitizedName = nftName.replace(/#/g, '_');
  const sanitizedMatch = `${sanitizedName}.gif`;
  if (arweaveImageMap.has(sanitizedMatch)) {
    return arweaveImageMap.get(sanitizedMatch);
  }
  
  // Handle "Mindfolk Founder #N" -> "Mindfolk_Founder_000N.gif"
  if (nftName.startsWith('Mindfolk Founder #')) {
    const number = nftName.replace('Mindfolk Founder #', '').trim();
    const paddedNumber = number.padStart(4, '0');
    const founderMatch = `Mindfolk_Founder_${paddedNumber}.gif`;
    if (arweaveImageMap.has(founderMatch)) {
      return arweaveImageMap.get(founderMatch);
    }
  }
  
  // Handle "Mindfolk Elder #N" (Mushroom Heads) -> "Mindfolk_Mushroom_00NN.gif"
  if (nftName.startsWith('Mindfolk Elder #')) {
    const number = nftName.replace('Mindfolk Elder #', '').trim();
    const paddedNumber = number.padStart(4, '0');
    const mushroomMatch = `Mindfolk_Mushroom_${paddedNumber}.gif`;
    if (arweaveImageMap.has(mushroomMatch)) {
      return arweaveImageMap.get(mushroomMatch);
    }
  }
  
  // Try case-insensitive search through all Arweave keys
  for (const [filename, url] of arweaveImageMap.entries()) {
    if (filename.toLowerCase().endsWith('.gif')) {
      // Remove .gif extension and compare
      const nameWithoutExt = filename.replace(/\.gif$/i, '');
      if (nameWithoutExt.toLowerCase() === nftName.toLowerCase() ||
          nameWithoutExt.toLowerCase() === sanitizedName.toLowerCase()) {
        return url;
      }
    }
  }
  
  // Fallback: Try to get from merged data by mint ID (if it's a .gif URL)
  if (nftMint && arweaveMintMap.has(nftMint)) {
    const url = arweaveMintMap.get(nftMint);
    // Check if URL points to a .gif (we can't verify file type, but if it's from merged data, it should be correct)
    // For now, we'll trust the merged data
    return url;
  }
  
  return null;
}

/**
 * Find .png URL from Arweave by matching NFT name to filename
 * @param {string} nftName - The NFT name
 * @param {string} nftMint - The NFT mint address (optional, for fallback)
 * @returns {string|null} - The .png URL from Arweave, or null if not found
 */
function findArweavePngUrl(nftName, nftMint = '') {
  if (!nftName) return null;
  
  // Try direct name match first (e.g., "Mindfolk Founder #8" -> "Mindfolk_Founder_0008.png")
  const directMatch = `${nftName}.png`;
  if (arweaveImageMap.has(directMatch)) {
    return arweaveImageMap.get(directMatch);
  }
  
  // Try with sanitized name (replace # with _)
  const sanitizedName = nftName.replace(/#/g, '_');
  const sanitizedMatch = `${sanitizedName}.png`;
  if (arweaveImageMap.has(sanitizedMatch)) {
    return arweaveImageMap.get(sanitizedMatch);
  }
  
  // Handle "Mindfolk Founder #N" -> "Mindfolk_Founder_000N.png"
  if (nftName.startsWith('Mindfolk Founder #')) {
    const number = nftName.replace('Mindfolk Founder #', '').trim();
    const paddedNumber = number.padStart(4, '0');
    const founderMatch = `Mindfolk_Founder_${paddedNumber}.png`;
    if (arweaveImageMap.has(founderMatch)) {
      return arweaveImageMap.get(founderMatch);
    }
  }
  
  // Handle "Mindfolk Elder #N" (Mushroom Heads) -> "Mindfolk_Mushroom_00NN.png"
  if (nftName.startsWith('Mindfolk Elder #')) {
    const number = nftName.replace('Mindfolk Elder #', '').trim();
    const paddedNumber = number.padStart(4, '0');
    const mushroomMatch = `Mindfolk_Mushroom_${paddedNumber}.png`;
    if (arweaveImageMap.has(mushroomMatch)) {
      return arweaveImageMap.get(mushroomMatch);
    }
  }
  
  // Try case-insensitive search through all Arweave keys
  for (const [filename, url] of arweaveImageMap.entries()) {
    if (filename.toLowerCase().endsWith('.png')) {
      // Remove .png extension and compare
      const nameWithoutExt = filename.replace(/\.png$/i, '');
      if (nameWithoutExt.toLowerCase() === nftName.toLowerCase() ||
          nameWithoutExt.toLowerCase() === sanitizedName.toLowerCase()) {
        return url;
      }
    }
  }
  
  // Fallback: Try to get from merged data by mint ID
  if (nftMint && arweaveMintMap.has(nftMint)) {
    const url = arweaveMintMap.get(nftMint);
    // For .png, we'll check if the URL doesn't end with .gif (merged data might have either)
    // Actually, let's just return it and trust the merged data
    return url;
  }
  
  return null;
}

function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  
  if (!query) {
    // Reset to show all
    displayedNFTs = [...allNFTs];
  } else {
    // Filter NFTs
    displayedNFTs = allNFTs.filter(nft => {
      const nameMatch = nft.name?.toLowerCase().includes(query);
      const mintMatch = nft.mint?.toLowerCase().includes(query);
      const attrMatch = nft.attributes?.some(attr => 
        attr.trait_type?.toLowerCase().includes(query) ||
        attr.value?.toLowerCase().includes(query)
      );
      return nameMatch || mintMatch || attrMatch;
    });
  }

  // Reset display
  document.getElementById('galleryGrid').innerHTML = '';
  currentPage = 0;
  
  // Show filtered results
  if (displayedNFTs.length > 0) {
    displayNFTs(displayedNFTs.slice(0, CONFIG.BATCH_SIZE));
    updateLoadMoreButton();
  } else {
    const eg = mainGalleryEmptyRowClass();
    document.getElementById('galleryGrid').innerHTML =
      `<div class="${eg}"><p class="text-muted">No NFTs found matching your search</p></div>`;
    document.getElementById('loadMoreContainer').style.display = 'none';
  }
}

function showNFTModal(nft) {
  const modalEl = document.getElementById('nftModal');
  const modalContent = document.getElementById('nftModalContent');
  const modalLabel = document.getElementById('nftModalLabel');

  if (!modalEl || !modalContent || !modalLabel) {
    console.error('NFT modal elements not found');
    return;
  }

  // Get full metadata from founder metadata file if available
  const mint = nft.mint && nft.mint.trim();
  const founderMetadata = mint ? founderMetadataMap.get(mint) : null;
  
  // Merge attributes - prefer founder metadata attributes if available
  let allAttributes = [];
  if (founderMetadata && founderMetadata.attributes && Array.isArray(founderMetadata.attributes)) {
    allAttributes = founderMetadata.attributes;
    console.log(`✓ Found ${allAttributes.length} attributes from founder metadata for ${nft.name}`);
  } else if (nft.attributes && Array.isArray(nft.attributes)) {
    allAttributes = nft.attributes;
  }
  
  // Get description from founder metadata if available
  const description = (founderMetadata && founderMetadata.description) || nft.description || '';

  modalLabel.textContent = nft.name || 'NFT Details';

  // Escape HTML to prevent XSS
  const escapeHtml = (text) => {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // Use popup image URL from CSV column F (rectified links for Elder types)
  let modalImageUrl = '';
  const nftName = (nft.name && nft.name.trim()) ? nft.name.trim() : '';
  const nftMint = (nft.mint && nft.mint.trim()) ? nft.mint.trim() : '';
  
  // Check if NFT type is "OG" first (before Elder check)
  const isOGType = allAttributes.some(attr => {
    const traitType = (attr.trait_type || attr.traitType || '').toString().toLowerCase();
    const traitValue = (attr.value || attr.Value || '').toString().toLowerCase();
    return (traitType === 'type' && traitValue === 'og') || traitValue === 'og';
  });
  
  // Check if NFT type is "Elder" to prioritize CSV column F links
  const isElderType = allAttributes.some(attr => {
    const traitType = (attr.trait_type || attr.traitType || '').toString().toLowerCase();
    const traitValue = (attr.value || attr.Value || '').toString().toLowerCase();
    return (traitType === 'type' && traitValue === 'elder') || traitValue === 'elder';
  });
  
  // Check if NFT is a Founder (by name pattern "Mindfolk Founder #N")
  const isFounderType = nftName && nftName.startsWith('Mindfolk Founder #');
  
  // Store original URL for Elder types (needed for clickable link)
  let elderOriginalUrl = '';
  
  // For OG types, use .png from Arweave for the left image
  if (isOGType) {
    const pngUrl = findArweavePngUrl(nftName, nftMint);
    if (pngUrl) {
      modalImageUrl = pngUrl;
      console.log(`✓ Found .png for OG left image: ${nftName} -> ${pngUrl.substring(0, 50)}...`);
    } else {
      // Fallback to original logic if .png not found
      if (nft.originalImage && nft.originalImage.trim()) {
        modalImageUrl = nft.originalImage.trim();
      } else if (nft.image && nft.image.trim()) {
        modalImageUrl = nft.image.trim();
      }
      console.warn(`⚠ Could not find .png for OG left image: ${nftName}`);
    }
  }
  // For Elder types, use Arweave links (prefer .gif, fallback to .png)
  else if (isElderType) {
    // Try .gif first
    const gifUrl = findArweaveGifUrl(nftName, nftMint);
    if (gifUrl) {
      modalImageUrl = gifUrl;
      console.log(`✓ Found .gif for Elder: ${nftName} -> ${gifUrl.substring(0, 50)}...`);
    } else {
      // Fallback to .png
      const pngUrl = findArweavePngUrl(nftName, nftMint);
      if (pngUrl) {
        modalImageUrl = pngUrl;
        console.log(`✓ Found .png for Elder (fallback): ${nftName} -> ${pngUrl.substring(0, 50)}...`);
      } else {
        // Final fallback to local image
    const sanitizedName = nftName.replace(/#/g, '_');
    modalImageUrl = `img/Elders/${sanitizedName}.jpg`;
        console.warn(`⚠ Could not find Arweave link for Elder: ${nftName}, using local image`);
      }
    }
    
    // Store Arweave URL for the clickable link (use the one we found)
    elderOriginalUrl = modalImageUrl && !modalImageUrl.startsWith('img/') && !modalImageUrl.startsWith('data:') 
      ? modalImageUrl 
      : (nft.originalImage || nft.image || '');
  }
  // For Founder types, use Arweave links (prefer .gif, fallback to .png)
  else if (isFounderType) {
    // Try .gif first
    const gifUrl = findArweaveGifUrl(nftName, nftMint);
    if (gifUrl) {
      modalImageUrl = gifUrl;
      console.log(`✓ Found .gif for Founder: ${nftName} -> ${gifUrl.substring(0, 50)}...`);
    } else {
      // Fallback to .png
      const pngUrl = findArweavePngUrl(nftName, nftMint);
      if (pngUrl) {
        modalImageUrl = pngUrl;
        console.log(`✓ Found .png for Founder (fallback): ${nftName} -> ${pngUrl.substring(0, 50)}...`);
      } else {
        // Final fallback to original image
        if (nft.originalImage && nft.originalImage.trim()) {
          modalImageUrl = nft.originalImage.trim();
    } else if (nft.image && nft.image.trim()) {
          modalImageUrl = nft.image.trim();
        }
        console.warn(`⚠ Could not find Arweave link for Founder: ${nftName}`);
      }
    }
  } else {
    // For non-Elder, non-OG types, use original priority order
    // Priority 1: Use originalImage
    if (nft.originalImage && nft.originalImage.trim()) {
      modalImageUrl = nft.originalImage.trim();
    }
    // Priority 2: Try to get from collection data map
    else if (nftMint && collectionNFTDataMap.has(nftMint)) {
      const collectionData = collectionNFTDataMap.get(nftMint);
      if (collectionData && collectionData.originalData && collectionData.originalData.URL && collectionData.originalData.URL.trim()) {
        modalImageUrl = collectionData.originalData.URL.trim();
      } else if (collectionData && collectionData.image && collectionData.image.trim()) {
        modalImageUrl = collectionData.image.trim();
      }
    }
    // Priority 3: Try lookup from CSV mapping by name
    else if (nftName && popupImageMapByName.has(nftName)) {
      modalImageUrl = popupImageMapByName.get(nftName);
    }
    // Priority 4: Try lookup from CSV mapping by mint address
    else if (nftMint && popupImageMapByMint.has(nftMint)) {
      modalImageUrl = popupImageMapByMint.get(nftMint);
    }
    // Fallback to image field
    else if (nft.image && nft.image.trim()) {
      modalImageUrl = nft.image.trim();
    }
  }
  
  // Last resort: placeholder
  if (!modalImageUrl) {
    modalImageUrl = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAwIiBoZWlnaHQ9IjUwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNTAwIiBoZWlnaHQ9IjUwMCIgZmlsbD0iIzFhMWExYSIvPjx0ZXh0IHg9IjUwJSIgeT0iNDUlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMzIiIGZpbGw9IiNmZmMxMDciIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
    console.warn(`[Modal] No popup image found for: "${nftName}" (Mint: ${nftMint ? nftMint.substring(0, 8) + '...' : 'N/A'})`);
  }
  
  // Get the original image URL for the clickable link
  // For Elder types, use the Arweave URL; for OGs use Arweave .png; for Founders use Arweave URL; otherwise use modal image URL
  let originalImageUrl = '';
  if (isElderType && elderOriginalUrl) {
    originalImageUrl = elderOriginalUrl;
  } else if (isOGType || isFounderType) {
    // For OGs and Founders, use the Arweave URL for the clickable link
    originalImageUrl = modalImageUrl && !modalImageUrl.startsWith('data:') && !modalImageUrl.startsWith('img/') ? modalImageUrl : (nft.originalImage || nft.image || '');
  } else {
    originalImageUrl = modalImageUrl && !modalImageUrl.startsWith('data:') ? modalImageUrl : (nft.originalImage || nft.image || '');
  }
  
  // List of specific NFTs that should show a second image (by name or mint address)
  const secondImageNFTs = [
    'Foster Mountain Elder',
    'Moon Night Elder',
    'Falcon Town Elder',
    'Metto Space Elder',
    'Ock Water Elder',
    'Edward Sky Elder',
    'Swanson Wood Elder'
  ];
  const secondImageMints = [
    'CEdJLfpZEbQXGg9yPWqoYXrnGPotthL2S74jKgDYF3o2', // Foster Mountain Elder
    'FdimCnK13wkG2cveqBjBJfHPaXAx1yq5CrLvpTPtWWz3', // Moon Night Elder
    'FW2dG1FZ6uTWvsQ8ZX95MKK1vvAdVrKsXjuvC98JGn7i', // Falcon Town Elder
    '9PQbgyPjpPGpP5xo1VumxCZwMciJ8YphWaTa7feXijzx', // Metto Space Elder
    'DW92g3fivhApR7Gu9mSBkEghGzgwKcP94Wn2urUwzbcp', // Ock Water Elder
    'FEBUmR4qWf4kxkt3FwU6MhdbPhFPZeygcWk7cgzXWhKt',  // Edward Sky Elder
    '4V6wSRGXj8ofcvYZHV4W7xpYaq5QnNpKJMHbBm6GXb8X'  // Swanson Wood Elder
  ];
  
  // Check if this NFT should show a second image
  const shouldShowSecondImage = isOGType || 
    secondImageNFTs.includes(nftName) || 
    (nftMint && secondImageMints.includes(nftMint));
  
  // For NFTs that need a second image, find the .gif version from Arweave (or .png if .gif not available)
  let secondImageUrl = null;
  if (shouldShowSecondImage) {
    const gifUrl = findArweaveGifUrl(nftName, nftMint);
    if (gifUrl) {
      secondImageUrl = gifUrl;
      console.log(`✓ Found .gif for second image: ${nftName} -> ${gifUrl.substring(0, 50)}...`);
    } else {
      // If .gif not found, try .png from Arweave (for cases like Metto Space Elder)
      const pngUrl = findArweavePngUrl(nftName, nftMint);
      if (pngUrl) {
        secondImageUrl = pngUrl;
        console.log(`✓ Found .png for second image (fallback): ${nftName} -> ${pngUrl.substring(0, 50)}...`);
      } else {
        // Final fallback to same image if neither .gif nor .png found
        secondImageUrl = modalImageUrl;
        console.warn(`⚠ Could not find .gif or .png for second image: ${nftName}`);
      }
    }
  }
  
  modalContent.innerHTML = `
    <div class="nft-modal-images" ${shouldShowSecondImage ? 'style="grid-column: 1 / -1;"' : ''}>
      <div class="nft-modal-image">
        <a href="${originalImageUrl}" target="_blank" rel="noopener noreferrer" ${!originalImageUrl || originalImageUrl.startsWith('data:') ? 'onclick="return false;"' : ''}>
          <img src="${modalImageUrl}" 
               alt="${escapeHtml(nft.name || 'NFT')}" 
               crossorigin="anonymous"
               referrerpolicy="no-referrer"
               onerror="if(!this.src.startsWith('data:')){this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAwIiBoZWlnaHQ9IjUwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNTAwIiBoZWlnaHQ9IjUwMCIgZmlsbD0iIzFhMWExYSIvPjx0ZXh0IHg9IjUwJSIgeT0iNDUlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMzIiIGZpbGw9IiNmZmMxMDciIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';}" />
        </a>
      </div>
      ${shouldShowSecondImage && secondImageUrl ? `
      <div class="nft-modal-image nft-modal-image-second">
        <a href="${secondImageUrl}" target="_blank" rel="noopener noreferrer" ${!secondImageUrl || secondImageUrl.startsWith('data:') ? 'onclick="return false;"' : ''}>
          <img src="${secondImageUrl}" 
               alt="${escapeHtml(nft.name || 'NFT')} - Second Image" 
               crossorigin="anonymous"
               referrerpolicy="no-referrer"
               onerror="if(!this.src.startsWith('data:')){this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAwIiBoZWlnaHQ9IjUwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNTAwIiBoZWlnaHQ9IjUwMCIgZmlsbD0iIzFhMWExYSIvPjx0ZXh0IHg9IjUwJSIgeT0iNDUlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMzIiIGZpbGw9IiNmZmMxMDciIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';}" />
        </a>
      </div>
      ` : ''}
    </div>
    <div class="nft-modal-details" ${shouldShowSecondImage ? 'style="grid-column: 1 / -1;"' : ''}>
      <h4>${escapeHtml(nft.name || 'Unnamed NFT')}</h4>
      
      <div class="detail-item">
        <div class="detail-label">Mint Address</div>
        <div class="detail-value" style="font-family: monospace; font-size: 0.85rem; word-break: break-all;">
          ${escapeHtml(nft.mint || '')}
        </div>
      </div>

      ${allAttributes && allAttributes.length > 0 ? `
        <div class="detail-item">
          <div class="detail-label">Attributes & Traits</div>
          <div class="nft-modal-traits">
            ${allAttributes.map(attr => {
              const traitType = (attr.trait_type || attr.traitType || 'Trait').toString().replace(/_/g, ' ');
              const traitValue = (attr.value || attr.Value || 'N/A').toString();
              return `
              <div class="nft-modal-trait">
                <div class="trait-name">${escapeHtml(traitType)}</div>
                <div class="trait-value">${escapeHtml(traitValue)}</div>
              </div>
            `;
            }).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  // Use MDB modal if available, otherwise bootstrap
  function closeModal() {
    if (window.mdb && window.mdb.Modal) {
      const mdbModal = window.mdb.Modal.getInstance(modalEl);
      if (mdbModal) mdbModal.hide();
    } else if (window.bootstrap && window.bootstrap.Modal) {
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
    } else {
      modalEl.style.display = 'none';
      modalEl.classList.remove('show');
      const backdrop = document.getElementById('modalBackdrop');
      if (backdrop) backdrop.remove();
    }
  }
  
  if (window.mdb && window.mdb.Modal) {
    const mdbModal = new window.mdb.Modal(modalEl);
    mdbModal.show();
  } else if (window.bootstrap && window.bootstrap.Modal) {
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
  } else {
    // Fallback: show modal manually
    modalEl.style.display = 'block';
    modalEl.classList.add('show');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop fade show';
    backdrop.id = 'modalBackdrop';
    document.body.appendChild(backdrop);
    
    // Close handlers
    backdrop.addEventListener('click', closeModal);
    const closeBtn = modalEl.querySelector('[data-mdb-dismiss="modal"]');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }
  }
}

function showLoading(show) {
  const loadingIndicator = document.getElementById('loadingIndicator');
  if (loadingIndicator) {
    loadingIndicator.style.display = show ? 'flex' : 'none';
  }
}

function showError(message) {
  alert(message); // In production, use a better notification system
  console.error(message);
}

// Helper function to resolve Solana Web3.js
function resolveWeb3() {
  if (typeof window === 'undefined') return undefined;
  
  // First check if we already found and stored it
  if (window.solanaWeb3 && typeof window.solanaWeb3.PublicKey === 'function') {
    return window.solanaWeb3;
  }
  
  // Check all possible locations
  const possibleLibs = [
    window.web3,
    window.solanaWeb3,
    typeof web3 !== 'undefined' ? web3 : null,
    typeof solanaWeb3 !== 'undefined' ? solanaWeb3 : null,
    window.solana?.web3,
    window.solana?.Web3
  ];
  
  for (const lib of possibleLibs) {
    if (lib && typeof lib.PublicKey === 'function' && typeof lib.Connection === 'function') {
      // Found a valid Solana Web3.js library
      window.solanaWeb3 = lib; // Store for future use
      return lib;
    }
  }
  
  return undefined;
}

// ========================================
// Wallet Connection Functions
// Note: Wallet connection is handled by wallet.js (based on reference site)
// We only need to handle viewing wallet NFTs here
// ========================================

async function handleViewWalletNFTs() {
  const walletState = window.WALLET_STATE || WALLET_STATE;
  if (!walletState || !walletState.wallet) {
    alert('Please connect your wallet first');
    return;
  }
  
  try {
    showLoading(true);
    document.getElementById('galleryHeader').style.display = 'block';
    document.getElementById('galleryHeader').querySelector('h1').textContent = 'My NFTs';
    
    // Fetch NFTs from wallet using Helius API
    const result = await fetchNFTsFromWallet(walletState.wallet.toString());
    const nfts = result.nfts;
    
    if (nfts && nfts.length > 0) {
      allNFTs = nfts;
      displayedNFTs = [...allNFTs];
      document.getElementById('galleryGrid').innerHTML = '';
      document.getElementById('emptyState').style.display = 'none';
      document.getElementById('totalCount').textContent = `${allNFTs.length} NFTs`;
      displayNFTs(displayedNFTs);
    } else {
      const wg = mainGalleryEmptyRowClass();
      document.getElementById('galleryGrid').innerHTML =
        `<div class="${wg}"><p class="text-muted">No NFTs found in your wallet</p></div>`;
      document.getElementById('totalCount').textContent = '0 NFTs';
      document.getElementById('emptyState').style.display = 'none';
    }
  } catch (error) {
    console.error('Error loading wallet NFTs:', error);
    showError(`Error loading wallet NFTs: ${error.message}`);
  } finally {
    showLoading(false);
  }
}

async function fetchNFTsFromWallet(walletAddress) {
  try {
    // Try Helius DAS API (Digital Asset Standard) - more reliable for wallet NFTs
    if (CONFIG.HELIUS_API_KEY) {
      // Use Helius RPC endpoint with DAS API method
      const url = `https://mainnet.helius-rpc.com/?api-key=${CONFIG.HELIUS_API_KEY}`;
      
      try {
        // Fetch all NFTs with pagination (like we do for collections)
        let allWalletNFTsData = [];
        let page = 1;
        let hasMore = true;
        
        // Use the default collection address for filtering
        const collectionAddress = currentCollection || DEFAULT_COLLECTION;
        
        while (hasMore && page <= 10) { // Limit to 10 pages (10,000 NFTs max)
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: `wallet-nfts-page-${page}`,
              method: 'getAssetsByOwner',
              params: {
                ownerAddress: walletAddress,
                page: page,
                limit: 1000, // Get up to 1000 NFTs per page
                // Note: We filter by collection mint addresses after fetching
              },
            }),
          });
          
          if (response.ok) {
            const result = await response.json();
            
            if (result.error) {
              console.error('Helius DAS API error:', result.error);
              throw new Error(`Helius API error: ${result.error.message}`);
            }
            
            const pageData = result.result?.items || [];
            allWalletNFTsData = allWalletNFTsData.concat(pageData);
            
            // Check if there are more pages
            if (pageData.length < 1000) {
              hasMore = false;
            } else {
              page++;
            }
          } else {
            console.error('Helius DAS API response not OK:', response.status, response.statusText);
            hasMore = false;
          }
        }
        
        const data = allWalletNFTsData;
        console.log(`✓ Fetched ${data.length} total NFTs from wallet using Helius DAS API (${page} page(s))`);
          
          // Log first few wallet NFTs to debug
          if (data.length > 0) {
            console.log('Sample wallet NFT IDs:', data.slice(0, 5).map(item => item.id || 'no id'));
          }
          
          // Use the same formatter as collection NFTs (DAS API format)
          const allWalletNFTs = data.map(item => formatNFTDataFromHeliusDAS(item));
          
          // Debug: Check collection mint addresses
          console.log(`Collection has ${collectionMintAddresses.size} mint addresses stored`);
          if (collectionMintAddresses.size > 0) {
            const sampleCollectionMints = Array.from(collectionMintAddresses).slice(0, 5);
            console.log('Sample collection mint addresses:', sampleCollectionMints);
          }
          
          // Filter to only show NFTs from the Mindfolk collection and enhance with JSON data
          const mindfolkNFTs = allWalletNFTs
            .filter(nft => {
              const mint = nft.mint && nft.mint.trim();
              if (!mint) {
                console.warn('Wallet NFT has no mint address:', nft);
                return false;
              }
              const isInCollection = collectionMintAddresses.has(mint);
              if (!isInCollection) {
                // Log first few non-matching mints for debugging
                if (allWalletNFTs.indexOf(nft) < 3) {
                  console.log(`Wallet NFT mint "${mint}" not found in Mindfolk collection`);
                }
              }
              return isInCollection;
            })
            .map(nft => {
              const mint = nft.mint.trim();
              // Enhance with data from JSON file if available
              const jsonData = collectionNFTDataMap.get(mint);
              if (jsonData) {
                return {
                  ...nft,
                  name: jsonData.name || nft.name, // Use name from JSON
                  image: jsonData.image || nft.image, // Original image URL (for modal)
                  originalImage: jsonData.originalImage || jsonData.image || nft.image, // Keep original for modal
                  thumbnailURLs: jsonData.thumbnailURLs || {}, // Thumbnails for gallery cards
                  attributes: jsonData.attributes || nft.attributes,
                  description: jsonData.description || nft.description
                };
              }
              return nft;
            });
          
          // Filter to only show NFTs from the Mindlings collection and enhance with JSON data
          const mindlingsNFTs = allWalletNFTs
            .filter(nft => {
              const mint = nft.mint && nft.mint.trim();
              if (!mint) {
                return false;
              }
              const isInCollection = mindlingsCollectionMintAddresses.has(mint);
              return isInCollection;
            })
            .map(nft => {
              const mint = nft.mint.trim();
              // Enhance with data from JSON file if available
              const jsonData = mindlingsCollectionNFTDataMap.get(mint);
              if (jsonData) {
                return {
                  ...nft,
                  name: jsonData.name || nft.name, // Use name from JSON
                  image: jsonData.image || nft.image, // Original image URL (for modal)
                  originalImage: jsonData.originalImage || jsonData.image || nft.image, // Keep original for modal
                  thumbnailURLs: jsonData.thumbnailURLs || {}, // Thumbnails for gallery cards
                  attributes: jsonData.attributes || nft.attributes,
                  description: jsonData.description || nft.description
                };
              }
              return nft;
            });
          
          console.log(`✓ Found ${mindfolkNFTs.length} Mindfolk NFTs in wallet (out of ${allWalletNFTs.length} total NFTs)`);
          console.log(`✓ Found ${mindlingsNFTs.length} Mindlings NFTs in wallet`);
          // Order Mindfolk: Elders → Mushroom Head → OGs → Founders (with sequence numbers)
          const sortedMindfolk = sortMindfolkByDisplayOrder(mindfolkNFTs);
          // Combine: sorted Mindfolk first, then Mindlings
          const combinedNFTs = [...sortedMindfolk, ...mindlingsNFTs];
          
          // Update wallet NFT counts display
          const walletNFTsCount = document.getElementById('walletNFTsCount');
          const walletMindlingsCount = document.getElementById('walletMindlingsCount');
          if (walletNFTsCount) {
            walletNFTsCount.textContent = `You have ${mindfolkNFTs.length} Mindfolk NFT${mindfolkNFTs.length !== 1 ? 's' : ''}`;
          }
          if (walletMindlingsCount) {
            if (mindlingsNFTs.length > 0) {
              walletMindlingsCount.textContent = `You have ${mindlingsNFTs.length} Mindlings NFT${mindlingsNFTs.length !== 1 ? 's' : ''}`;
              walletMindlingsCount.style.display = 'inline-block';
            } else {
              walletMindlingsCount.style.display = 'none';
            }
          }
          
          if (combinedNFTs.length === 0 && allWalletNFTs.length > 0) {
            console.warn('⚠ No matching Mindfolk or Mindlings NFTs found. Possible issues:');
            console.warn('  1. Mint addresses from Helius API might not match JSON file');
            console.warn('  2. Collection might not be loaded yet');
            console.warn('  3. Mint address format might be different');
            // Show first wallet NFT mint vs first collection mint for comparison
            if (allWalletNFTs[0] && collectionMintAddresses.size > 0) {
              const firstWalletMint = allWalletNFTs[0].mint;
              const firstCollectionMint = Array.from(collectionMintAddresses)[0];
              console.warn(`  Wallet mint format: "${firstWalletMint}" (length: ${firstWalletMint?.length || 0})`);
              console.warn(`  Collection mint format: "${firstCollectionMint}" (length: ${firstCollectionMint.length})`);
            }
          }
          
          // Return combined NFTs with separate counts for display
          return {
            nfts: combinedNFTs,
            mindfolkCount: mindfolkNFTs.length,
            mindlingsCount: mindlingsNFTs.length
          };
      } catch (dasError) {
        console.error('Helius DAS API error:', dasError);
        throw dasError;
      }
    }
    
    // Fallback: Return empty result if API fails
    console.warn('Could not fetch wallet NFTs - Helius API key may be missing or invalid');
    return { nfts: [], mindfolkCount: 0, mindlingsCount: 0 };
  } catch (error) {
    console.error('Error fetching wallet NFTs:', error);
    return { nfts: [], mindfolkCount: 0, mindlingsCount: 0 };
  }
}

// Function to load and display wallet NFTs
async function loadWalletNFTs() {
  const walletState = window.WALLET_STATE;
  if (!walletState || !walletState.wallet || !walletState.connected) {
    // Hide wallet NFTs display if wallet not connected
    const walletNFTsDisplay = document.getElementById('walletNFTsDisplay');
    if (walletNFTsDisplay) {
      walletNFTsDisplay.style.display = 'none';
    }
    return;
  }

  // Wait for Mindfolk collection to be loaded (so we have mint addresses to filter with)
  // Note: Mindlings mint addresses are loaded separately but we don't need to wait for them
  if (collectionMintAddresses.size === 0) {
    console.log('Waiting for Mindfolk collection to load before filtering wallet NFTs...');
    // Wait a bit and try again
    setTimeout(() => {
      if (collectionMintAddresses.size > 0) {
        loadWalletNFTs();
      } else {
        console.warn('Mindfolk collection not loaded yet, cannot filter wallet NFTs');
      }
    }, 2000);
    return;
  }

  try {
    const walletAddress = walletState.wallet.toString();
    console.log('Loading NFTs from wallet (Mindfolk + Mindlings):', walletAddress);
    
    const result = await fetchNFTsFromWallet(walletAddress);
    displayWalletNFTs(result.nfts);
  } catch (error) {
    console.error('Error loading wallet NFTs:', error);
    const walletNFTsDisplay = document.getElementById('walletNFTsDisplay');
    if (walletNFTsDisplay) {
      walletNFTsDisplay.style.display = 'none';
    }
  }
}

/** When set, MY GALLERY shows $WOOD for this address; connected-wallet row stays hidden. */
function syncMyGalleryViewingAddressForWood(viewingAddress) {
  if (typeof window === 'undefined') return;
  window.MY_GALLERY_VIEWING_ADDRESS = viewingAddress || null;
  if (typeof window.updateTokenBalanceDisplay === 'function') {
    window.updateTokenBalanceDisplay();
  }
}

function clearMyGalleryAddressSearchUIOnError() {
  syncMyGalleryViewingAddressForWood(null);
  const searchedAddressWoodDisplay = document.getElementById('searchedAddressWoodDisplay');
  const walletViewingAddressLabel = document.getElementById('walletViewingAddressLabel');
  if (searchedAddressWoodDisplay) searchedAddressWoodDisplay.style.display = 'none';
  if (walletViewingAddressLabel) {
    walletViewingAddressLabel.textContent = '';
    walletViewingAddressLabel.style.display = 'none';
  }
}

// Load NFTs for a given wallet address (search bar) - same display as connected wallet
async function loadNFTsForAddress(address) {
  if (collectionMintAddresses.size === 0) {
    showError('Collection still loading. Please try again in a few seconds.');
    return;
  }

  showLoading(true);
  const walletNFTsDisplay = document.getElementById('walletNFTsDisplay');
  try {
    const resolved = await resolveWalletOrDomain(address);
    if (resolved.error) {
      showError(resolved.error);
      clearMyGalleryAddressSearchUIOnError();
      return;
    }
    const pubkey = resolved.pubkey;
    const viewingDisplayLabel = resolved.displayLabel;

    const result = await fetchNFTsFromWallet(pubkey);
    const nfts = result.nfts;
    const woodBalance = typeof window.fetchWoodBalanceForAddress === 'function'
      ? await window.fetchWoodBalanceForAddress(pubkey)
      : 0;
    if (nfts && nfts.length > 0) {
      displayWalletNFTs(nfts, {
        viewingAddress: pubkey,
        viewingDisplayLabel: viewingDisplayLabel,
        mindfolkCount: result.mindfolkCount,
        mindlingsCount: result.mindlingsCount,
        woodBalance: woodBalance
      });
    } else {
      displayWalletNFTs([], {
        viewingAddress: pubkey,
        viewingDisplayLabel: viewingDisplayLabel,
        emptyMessage: 'No Mindfolk or Mindlings NFTs found for this address.',
        woodBalance: woodBalance
      });
    }
    if (walletNFTsDisplay) walletNFTsDisplay.style.display = 'block';
  } catch (error) {
    console.error('Error loading NFTs for address:', error);
    showError('Failed to load NFTs: ' + (error.message || 'Unknown error'));
    clearMyGalleryAddressSearchUIOnError();
  } finally {
    showLoading(false);
  }
}

// Function to display wallet NFTs in the UI
// options: { viewingAddress?: string, viewingDisplayLabel?: string|null, emptyMessage?: string, mindfolkCount?: number, mindlingsCount?: number, woodBalance?: number }
function displayWalletNFTs(nfts, options) {
  const walletNFTsDisplay = document.getElementById('walletNFTsDisplay');
  const walletNFTsGrid = document.getElementById('walletNFTsGrid');
  const walletNFTsCount = document.getElementById('walletNFTsCount');
  const walletViewingAddressLabel = document.getElementById('walletViewingAddressLabel');
  const walletMindlingsCount = document.getElementById('walletMindlingsCount');
  const searchedAddressWoodDisplay = document.getElementById('searchedAddressWoodDisplay');
  const searchedAddressWoodAmount = document.getElementById('searchedAddressWoodAmount');
  
  if (!walletNFTsDisplay || !walletNFTsGrid || !walletNFTsCount) {
    console.error('Wallet NFTs display elements not found');
    return;
  }

  const viewingAddress = options && options.viewingAddress;
  const viewingDisplayLabel = options && Object.prototype.hasOwnProperty.call(options, 'viewingDisplayLabel')
    ? options.viewingDisplayLabel
    : undefined;
  const emptyMessage = options && options.emptyMessage;
  const mindfolkCount = options && typeof options.mindfolkCount === 'number' ? options.mindfolkCount : null;
  const mindlingsCount = options && typeof options.mindlingsCount === 'number' ? options.mindlingsCount : null;
  const woodBalance = options && typeof options.woodBalance === 'number' ? options.woodBalance : 0;

  syncMyGalleryViewingAddressForWood(viewingAddress);

  if (searchedAddressWoodDisplay && searchedAddressWoodAmount) {
    if (viewingAddress) {
      searchedAddressWoodAmount.textContent = woodBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
      searchedAddressWoodDisplay.style.display = 'block';
    } else {
      searchedAddressWoodDisplay.style.display = 'none';
    }
  }

  if (walletViewingAddressLabel) {
    if (viewingAddress) {
      let line;
      if (viewingDisplayLabel) {
        line = 'Viewing NFTs for: ' + viewingDisplayLabel;
      } else {
        const short = viewingAddress.length > 12 ? viewingAddress.slice(0, 6) + '…' + viewingAddress.slice(-6) : viewingAddress;
        line = 'Viewing NFTs for: ' + short;
      }
      walletViewingAddressLabel.textContent = line;
      walletViewingAddressLabel.style.display = 'block';
    } else {
      walletViewingAddressLabel.textContent = '';
      walletViewingAddressLabel.style.display = 'none';
    }
  }

  if (!nfts || nfts.length === 0) {
    if (viewingAddress && emptyMessage) {
      walletNFTsGrid.innerHTML = '<div class="gallery-mosaic-span-full text-center text-muted py-4">' + emptyMessage + '</div>';
      walletNFTsDisplay.style.display = 'block';
    } else {
      walletNFTsDisplay.style.display = 'none';
    }
    return;
  }

  // Clear existing NFTs
  walletNFTsGrid.innerHTML = '';
  
  // Use the same createNFTCard function as the main gallery for consistent styling
  nfts.forEach(nft => {
    const card = createNFTCard(nft, false); // false = MY GALLERY, always uses default view
    walletNFTsGrid.appendChild(card);
  });
  
  // When viewing by address, show separate Mindfolk and Mindlings counts (same as connected wallet)
  if (viewingAddress && walletNFTsCount) {
    const mf = mindfolkCount != null ? mindfolkCount : nfts.length;
    const ml = mindlingsCount != null ? mindlingsCount : 0;
    walletNFTsCount.textContent = `This address has ${mf} Mindfolk NFT${mf !== 1 ? 's' : ''}`;
    if (walletMindlingsCount) {
      walletMindlingsCount.textContent = `This address has ${ml} Mindlings NFT${ml !== 1 ? 's' : ''}`;
      walletMindlingsCount.style.display = ml > 0 ? 'inline-block' : 'none';
    }
  }

  walletNFTsDisplay.style.display = 'block';
}

function formatNFTDataFromHelius(item) {
  // Helius API v0 returns mint addresses in different possible fields
  // Try multiple possible locations for the mint address
  const mint = item.id || 
               item.mint || 
               item.tokenAddress || 
               item.token_address ||
               item.mintAddress ||
               item.mint_address ||
               '';
  
  // Log structure for debugging if mint is missing
  if (!mint && Object.keys(item).length > 0) {
    console.warn('NFT item missing mint address. Available fields:', Object.keys(item));
    console.warn('Sample item structure:', JSON.stringify(item).substring(0, 200));
  }
  
  return {
    mint: mint,
    name: item.content?.metadata?.name || 
          item.title || 
          item.name ||
          `NFT #${mint?.slice(-4) || 'Unknown'}`,
    image: item.content?.files?.[0]?.uri || 
           item.content?.files?.[0]?.cdn_uri ||
           item.content?.links?.image || 
           item.image || 
           item.content?.metadata?.image ||
           '',
    description: item.content?.metadata?.description || 
                 item.description || 
                 '',
    attributes: item.content?.metadata?.attributes || 
                item.attributes || 
                [],
    external_url: item.content?.links?.external_url || 
                  item.external_url || 
                  '',
  };
}

