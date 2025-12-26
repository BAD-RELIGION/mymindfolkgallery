// Helius API key (same as in gallery.js)
// Using native fetch (Node.js 18+)
const HELIUS_API_KEY = '393d535c-31f8-4316-bc07-6f6bb8ae1cdf';
const HELIUS_ENDPOINT = 'https://api.helius.xyz/v0';
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Mindlings collection address (base58 format) - CORRECTED from NFT metadata
const MINDLINGS_COLLECTION = '5YugNNZcTAPY2tVCv5PDLPmjyCgK4PKQnmn6b36d4XCr';

/**
 * Format NFT data from Helius DAS API response
 */
function formatNFTDataFromHeliusDAS(item) {
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
  if (!image && metadata.image) {
    image = metadata.image;
  }
  
  // Get name
  const name = metadata.name || content.metadata?.name || item.title || '';
  
  // Get description
  const description = metadata.description || content.metadata?.description || '';
  
  // Get attributes
  const attributes = metadata.attributes || content.metadata?.attributes || [];
  
  // Get external URL
  const externalUrl = metadata.external_url || content.metadata?.external_url || '';
  
  // Get symbol
  const symbol = metadata.symbol || content.metadata?.symbol || '';
  
  return {
    mint: mint,
    name: name,
    image: image,
    description: description,
    attributes: attributes,
    external_url: externalUrl,
    symbol: symbol,
    // Include full metadata for reference
    fullMetadata: item
  };
}

/**
 * Fetch all NFTs from a collection using Helius DAS API
 */
async function fetchCollectionNFTs(collectionAddress) {
  try {
    let allNFTs = [];
    let page = 1;
    let hasMore = true;
    
    console.log(`\n🔍 Fetching NFTs from collection: ${collectionAddress}\n`);
    console.log(`🔗 Using Helius RPC endpoint...\n`);
    
    // Fetch NFTs in pages since API has limits
    while (hasMore && page <= 100) { // Limit to 100 pages (100,000 NFTs max)
      console.log(`📄 Fetching page ${page}...`);
      
      try {
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
              groupKey: 'collection',
              groupValue: collectionAddress,
              page: page,
              limit: 1000, // Get up to 1000 NFTs per page
            },
          }),
        });

        if (!response.ok) {
          console.log(`   ⚠️  Response not OK: ${response.status} ${response.statusText}`);
          throw new Error(`Helius API error: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (data.error) {
          console.log(`   ⚠️  API Error: ${JSON.stringify(data.error)}`);
          throw new Error(`Helius API error: ${data.error.message || JSON.stringify(data.error)}`);
        }
        
        if (data.result) {
          if (data.result.items && Array.isArray(data.result.items)) {
            const pageNFTs = data.result.items.map(item => formatNFTDataFromHeliusDAS(item));
            allNFTs = allNFTs.concat(pageNFTs);
            
            console.log(`   ✓ Found ${pageNFTs.length} NFTs on page ${page} (Total: ${allNFTs.length})`);
            
            // Check if there are more pages
            if (data.result.items.length < 1000 || !data.result.items.length) {
              hasMore = false;
              console.log(`   ✓ Reached end of collection\n`);
            } else {
              page++;
              // Small delay to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } else {
            console.log(`   ⚠️  No items array in result: ${JSON.stringify(data.result).substring(0, 200)}`);
            hasMore = false;
            console.log(`   ✓ No more items found\n`);
          }
        } else {
          console.log(`   ⚠️  No result in response: ${JSON.stringify(data).substring(0, 200)}`);
          hasMore = false;
          console.log(`   ✓ No more items found\n`);
        }
      } catch (fetchError) {
        console.error(`   ❌ Error on page ${page}:`, fetchError.message);
        // Try alternative method for first page
        if (page === 1) {
          console.log(`\n🔄 Trying alternative method: Direct blockchain query...\n`);
          return await fetchCollectionNFTsAlternative(collectionAddress);
        }
        throw fetchError;
      }
    }
    
    console.log(`✅ Successfully fetched ${allNFTs.length} NFTs from collection\n`);
    return allNFTs;
  } catch (error) {
    console.error('❌ Error fetching collection:', error);
    throw error;
  }
}

/**
 * Alternative method: Use fetch-collection-metadata.js approach
 */
async function fetchCollectionNFTsAlternative(collectionAddress) {
  console.log('📥 Using alternative method: fetch-collection-metadata.js\n');
  const { execSync } = await import('child_process');
  const outputFile = 'mindlings-collection-metadata.json';
  
  try {
    // Run the existing script
    execSync(`node fetch-collection-metadata.js "${collectionAddress}" "${outputFile}"`, {
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    // Read the results
    const fs = await import('fs/promises');
    const data = await fs.readFile(outputFile, 'utf-8');
    const metadata = JSON.parse(data);
    
    // Transform to our format
    const nfts = metadata
      .filter(item => !item.error)
      .map(item => ({
        mint: item.mintAddress || item.mint,
        name: item.jsonMetadata?.name || item.name || '',
        image: item.jsonMetadata?.image || item.image || '',
        description: item.jsonMetadata?.description || item.description || '',
        attributes: item.jsonMetadata?.attributes || item.attributes || [],
        external_url: item.jsonMetadata?.external_url || item.external_url || '',
        symbol: item.jsonMetadata?.symbol || item.symbol || ''
      }));
    
    console.log(`✅ Fetched ${nfts.length} NFTs using alternative method\n`);
    return nfts;
  } catch (error) {
    console.error('❌ Alternative method also failed:', error.message);
    throw error;
  }
}

/**
 * Save NFTs to JSON file
 */
async function saveNFTsToJSON(nfts, filename) {
  const fs = await import('fs/promises');
  
  // Format the data to match the expected format (similar to mindfolk-nfts.json)
  const formattedData = nfts.map(nft => ({
    mint: nft.mint,
    name: nft.name,
    image: nft.image,
    description: nft.description || '',
    attributes: nft.attributes || [],
    external_url: nft.external_url || '',
    symbol: nft.symbol || ''
  }));
  
  await fs.writeFile(filename, JSON.stringify(formattedData, null, 2), 'utf-8');
  console.log(`✅ Saved ${formattedData.length} NFTs to ${filename}\n`);
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('🚀 Starting Mindlings collection fetch...');
    console.log(`📍 Collection Address: ${MINDLINGS_COLLECTION}`);
    
    // Fetch all NFTs
    const nfts = await fetchCollectionNFTs(MINDLINGS_COLLECTION);
    
    // Save to JSON file
    await saveNFTsToJSON(nfts, 'data/mindlings-nfts.json');
    
    console.log('✨ Done!');
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

main();

