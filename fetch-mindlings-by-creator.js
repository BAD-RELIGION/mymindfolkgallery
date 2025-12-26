// Alternative method: Fetch NFTs by creator or update authority
// Using native fetch (Node.js 18+)
const HELIUS_API_KEY = '393d535c-31f8-4316-bc07-6f6bb8ae1cdf';
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const HELIUS_V0_ENDPOINT = `https://api.helius.xyz/v0`;

// NFT mint address from user's link
const SAMPLE_MINT = 'bhmgq9A6P1JNvYzY4QrW9Vr3L4hsdcCieKJPu5QB8gC';

/**
 * Fetch NFT metadata using Helius v0 API
 */
async function fetchNFTMetadata(mintAddress) {
  try {
    const response = await fetch(`${HELIUS_V0_ENDPOINT}/token-metadata?api-key=${HELIUS_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mintAccounts: [mintAddress]
      }),
    });

    if (!response.ok) {
      throw new Error(`Helius API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data[0];
  } catch (error) {
    console.error('Error fetching NFT metadata:', error);
    throw error;
  }
}

/**
 * Fetch NFTs by creator address using Helius DAS API
 */
async function fetchNFTsByCreator(creatorAddress) {
  try {
    let allNFTs = [];
    let page = 1;
    let hasMore = true;
    
    console.log(`\n🔍 Fetching NFTs by creator: ${creatorAddress}\n`);
    
    while (hasMore && page <= 100) {
      console.log(`📄 Fetching page ${page}...`);
      
      const response = await fetch(HELIUS_RPC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `page-${page}`,
          method: 'getAssetsByGroup',
          params: {
            groupKey: 'creators',
            groupValue: creatorAddress,
            page: page,
            limit: 1000,
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
        const pageNFTs = data.result.items;
        allNFTs = allNFTs.concat(pageNFTs);
        
        console.log(`   ✓ Found ${pageNFTs.length} NFTs on page ${page} (Total: ${allNFTs.length})`);
        
        if (pageNFTs.length < 1000) {
          hasMore = false;
          console.log(`   ✓ Reached end\n`);
        } else {
          page++;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } else {
        hasMore = false;
      }
    }
    
    return allNFTs;
  } catch (error) {
    console.error('Error fetching by creator:', error);
    throw error;
  }
}

/**
 * Fetch NFTs by owner address (to find collection NFTs)
 */
async function fetchNFTsByOwner(ownerAddress) {
  try {
    let allNFTs = [];
    let page = 1;
    let hasMore = true;
    
    console.log(`\n🔍 Fetching NFTs by owner: ${ownerAddress}\n`);
    
    while (hasMore && page <= 100) {
      console.log(`📄 Fetching page ${page}...`);
      
      const response = await fetch(HELIUS_RPC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `page-${page}`,
          method: 'getAssetsByOwner',
          params: {
            ownerAddress: ownerAddress,
            page: page,
            limit: 1000,
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
        const pageNFTs = data.result.items;
        allNFTs = allNFTs.concat(pageNFTs);
        
        console.log(`   ✓ Found ${pageNFTs.length} NFTs on page ${page} (Total: ${allNFTs.length})`);
        
        if (pageNFTs.length < 1000) {
          hasMore = false;
          console.log(`   ✓ Reached end\n`);
        } else {
          page++;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } else {
        hasMore = false;
      }
    }
    
    return allNFTs;
  } catch (error) {
    console.error('Error fetching by owner:', error);
    throw error;
  }
}

/**
 * Format NFT data
 */
function formatNFTData(item) {
  const content = item.content || {};
  const metadata = content.metadata || {};
  const files = content.files || [];
  
  const mint = item.id || item.mint || '';
  
  let image = '';
  if (files && files.length > 0) {
    image = files[0].cdn_uri || files[0].uri || files[0].file || '';
  }
  if (!image && content.metadata?.image) {
    image = content.metadata.image;
  }
  if (!image && metadata.image) {
    image = metadata.image;
  }
  
  const name = metadata.name || content.metadata?.name || item.title || '';
  const description = metadata.description || content.metadata?.description || '';
  const attributes = metadata.attributes || content.metadata?.attributes || [];
  const externalUrl = metadata.external_url || content.metadata?.external_url || '';
  const symbol = metadata.symbol || content.metadata?.symbol || '';
  
  // Check if this NFT belongs to Mindlings collection
  const collection = item.grouping?.find(g => g.group_key === 'collection')?.group_value || '';
  const isMindling = name && (
    name.toLowerCase().includes('duck') ||
    name.toLowerCase().includes('mindling') ||
    name.toLowerCase().includes('mndflk')
  );
  
  return {
    mint: mint,
    name: name,
    image: image,
    description: description,
    attributes: attributes,
    external_url: externalUrl,
    symbol: symbol,
    collection: collection,
    isMindling: isMindling
  };
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('🚀 Starting Mindlings collection fetch (alternative method)...');
    console.log(`📍 Sample NFT: ${SAMPLE_MINT}\n`);
    
    // First, get the sample NFT metadata to find creators/authority
    console.log('📥 Fetching sample NFT metadata...');
    const sampleMetadata = await fetchNFTMetadata(SAMPLE_MINT);
    
    console.log('\n📋 Sample NFT Info:');
    console.log(JSON.stringify(sampleMetadata, null, 2));
    
    // Try to get creator addresses
    const creators = sampleMetadata?.onChainMetadata?.metadata?.data?.creators || [];
    const updateAuthority = sampleMetadata?.onChainMetadata?.metadata?.updateAuthority || '';
    
    console.log('\n🔍 Found creators:', creators.map(c => c.address));
    console.log('🔍 Update authority:', updateAuthority);
    
    // Try fetching by first verified creator
    if (creators.length > 0) {
      const firstCreator = creators.find(c => c.verified) || creators[0];
      console.log(`\n🔎 Trying method 1: Fetching NFTs by creator ${firstCreator.address}...`);
      
      try {
        const nftsByCreator = await fetchNFTsByCreator(firstCreator.address);
        console.log(`\n✓ Found ${nftsByCreator.length} NFTs by creator`);
        
        // Filter for Mindlings
        const formattedNFTs = nftsByCreator.map(item => formatNFTData(item));
        const mindlingsNFTs = formattedNFTs.filter(nft => nft.isMindling || nft.name.toLowerCase().includes('duck'));
        
        console.log(`\n🎯 Found ${mindlingsNFTs.length} Mindlings NFTs`);
        
        if (mindlingsNFTs.length > 0) {
          // Save to JSON
          const fs = await import('fs/promises');
          const outputData = mindlingsNFTs.map(nft => ({
            mint: nft.mint,
            name: nft.name,
            image: nft.image,
            description: nft.description || '',
            attributes: nft.attributes || [],
            external_url: nft.external_url || '',
            symbol: nft.symbol || ''
          }));
          
          await fs.writeFile('data/mindlings-nfts.json', JSON.stringify(outputData, null, 2), 'utf-8');
          console.log(`\n✅ Saved ${outputData.length} NFTs to data/mindlings-nfts.json`);
          return;
        }
      } catch (error) {
        console.log(`\n⚠️  Method 1 failed: ${error.message}`);
      }
    }
    
    // If that didn't work, try using Solana RPC to search metadata accounts
    console.log('\n🔎 Trying method 2: Using Solana RPC to search...');
    console.log('   (This method searches all metadata accounts - may take longer)');
    
    // We'll need to use a different approach - maybe search by symbol or name pattern
    console.log('\n💡 Suggestion: Check the sample NFT metadata above for collection info');
    console.log('   You may need to provide the correct collection address or search criteria');
    
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

main();

