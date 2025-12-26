import { Connection, PublicKey } from '@solana/web3.js';
import { fetchNFTMetadata } from './fetch-nft-metadata.js';
import fs from 'fs';

// Metaplex Token Metadata Program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Solana RPC endpoint
const RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';

/**
 * Decode string from buffer (removes null bytes)
 */
function decodeString(buffer, offset, length) {
  const slice = buffer.slice(offset, offset + length);
  return slice.toString('utf8').replace(/\0/g, '').trim();
}

/**
 * Decode optional field
 */
function decodeOption(buffer, offset) {
  const option = buffer.readUInt8(offset);
  if (option === 0) {
    return { hasValue: false, offset: offset + 1 };
  }
  return { hasValue: true, offset: offset + 1 };
}

/**
 * Decode collection from metadata buffer
 */
function decodeCollection(buffer, offset) {
  const option = decodeOption(buffer, offset);
  if (!option.hasValue) {
    return { collection: null, offset: option.offset };
  }
  
  const key = new PublicKey(buffer.slice(option.offset, option.offset + 32));
  const verified = buffer.readUInt8(option.offset + 32) === 1;
  
  return {
    collection: {
      key: key.toString(),
      verified
    },
    offset: option.offset + 33
  };
}

/**
 * Check if metadata account belongs to collection (without full decode)
 */
function checkCollectionInBuffer(buffer, collectionAddress) {
  try {
    let offset = 0;
    
    // Skip key (1 byte)
    offset += 1;
    
    // Skip updateAuthority (32 bytes)
    offset += 32;
    
    // Skip mint (32 bytes)
    offset += 32;
    
    // Skip name (4 bytes length + string)
    const nameLength = buffer.readUInt32LE(offset);
    offset += 4 + nameLength;
    
    // Skip symbol (4 bytes length + string)
    const symbolLength = buffer.readUInt32LE(offset);
    offset += 4 + symbolLength;
    
    // Skip URI (4 bytes length + string)
    const uriLength = buffer.readUInt32LE(offset);
    offset += 4 + uriLength;
    
    // Skip sellerFeeBasisPoints (2 bytes)
    offset += 2;
    
    // Skip creators (optional array)
    const creatorsOption = decodeOption(buffer, offset);
    if (creatorsOption.hasValue) {
      const creatorsLength = buffer.readUInt32LE(creatorsOption.offset);
      offset = creatorsOption.offset + 4;
      // Each creator is 32 (address) + 1 (verified) + 1 (share) = 34 bytes
      offset += creatorsLength * 34;
    } else {
      offset = creatorsOption.offset;
    }
    
    // Skip primarySaleHappened (1 byte)
    offset += 1;
    
    // Skip isMutable (1 byte)
    offset += 1;
    
    // Skip editionNonce (optional, 1 byte)
    const editionNonceOption = decodeOption(buffer, offset);
    offset = editionNonceOption.hasValue ? editionNonceOption.offset + 1 : editionNonceOption.offset;
    
    // Skip tokenStandard (optional, 1 byte)
    const tokenStandardOption = decodeOption(buffer, offset);
    offset = tokenStandardOption.hasValue ? tokenStandardOption.offset + 1 : tokenStandardOption.offset;
    
    // Now check collection
    const collectionData = decodeCollection(buffer, offset);
    if (collectionData.collection && collectionData.collection.key === collectionAddress) {
      return true;
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Get all NFT mint addresses in a collection
 */
async function getAllNFTsInCollection(collectionAddress) {
  const connection = new Connection(RPC_ENDPOINT, 'confirmed');
  
  console.log(`\n🔍 Finding all NFTs in collection: ${collectionAddress}`);
  console.log('⏳ Fetching all metadata accounts (this may take a few minutes)...\n');

  try {
    // Get all metadata accounts from the Token Metadata program
    // We'll fetch them in batches and filter by collection
    const allMetadataAccounts = await connection.getProgramAccounts(
      TOKEN_METADATA_PROGRAM_ID,
      {
        // Get full account data to check collection
        dataSlice: undefined
      }
    );

    console.log(`✓ Found ${allMetadataAccounts.length} metadata accounts`);
    console.log('🔍 Filtering by collection...\n');

    const mintAddresses = [];
    let processed = 0;

    for (const account of allMetadataAccounts) {
      processed++;
      if (processed % 100 === 0) {
        console.log(`  Processed ${processed}/${allMetadataAccounts.length} accounts... (Found: ${mintAddresses.length})`);
      }

      try {
        const data = account.account.data;
        
        // Extract mint address (at offset 33, after key and updateAuthority)
        const mintPubkey = new PublicKey(data.slice(33, 65));
        
        // Check if this NFT belongs to our collection
        if (checkCollectionInBuffer(data, collectionAddress)) {
          mintAddresses.push(mintPubkey.toString());
          console.log(`  ✓ Found NFT #${mintAddresses.length}: ${mintPubkey.toString()}`);
        }
      } catch (error) {
        // Skip invalid accounts
        continue;
      }
    }

    console.log(`\n✓ Found ${mintAddresses.length} NFTs in collection\n`);
    return mintAddresses;

  } catch (error) {
    console.error(`❌ Error fetching collection NFTs: ${error.message}`);
    throw error;
  }
}

/**
 * Fetch metadata for all NFTs in collection
 */
async function fetchCollectionMetadata(collectionAddress, outputFile = 'collection-metadata.json') {
  try {
    // Get all mint addresses in the collection
    let mintAddresses;
    try {
      mintAddresses = await getAllNFTsInCollection(collectionAddress);
    } catch (error) {
      console.log('\n⚠️  Primary method failed, trying alternative...\n');
      mintAddresses = await getAllNFTsInCollectionAlternative(collectionAddress);
    }

    if (mintAddresses.length === 0) {
      console.log('⚠️  No NFTs found in collection. The collection address might be incorrect.');
      return;
    }

    console.log(`\n📋 Found ${mintAddresses.length} NFTs in collection`);
    console.log('📥 Fetching metadata for each NFT...\n');

    const allMetadata = [];
    let successCount = 0;
    let failCount = 0;

    // Fetch metadata for each NFT
    for (let i = 0; i < mintAddresses.length; i++) {
      const mintAddress = mintAddresses[i];
      const progress = `[${i + 1}/${mintAddresses.length}]`;
      
      try {
        process.stdout.write(`${progress} Fetching metadata... `);
        const metadata = await fetchNFTMetadata(mintAddress);
        allMetadata.push(metadata);
        successCount++;
        console.log(`✓ ${metadata.name}`);
        
        // Save progress periodically (every 10 NFTs)
        if ((i + 1) % 10 === 0) {
          fs.writeFileSync(
            outputFile.replace('.json', '_progress.json'),
            JSON.stringify(allMetadata, null, 2),
            'utf8'
          );
          console.log(`  💾 Progress saved (${i + 1}/${mintAddresses.length})`);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        failCount++;
        console.log(`❌ ${error.message}`);
        
        // Still add a placeholder entry
        allMetadata.push({
          mintAddress: mintAddress,
          error: error.message
        });
      }
    }

    // Save final results
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total NFTs: ${mintAddresses.length}`);
    console.log(`✓ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`\n💾 Saving to: ${outputFile}`);

    fs.writeFileSync(outputFile, JSON.stringify(allMetadata, null, 2), 'utf8');
    
    // Also save a summary file
    const summary = {
      collectionAddress: collectionAddress,
      totalNFTs: mintAddresses.length,
      successful: successCount,
      failed: failCount,
      fetchedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(
      outputFile.replace('.json', '_summary.json'),
      JSON.stringify(summary, null, 2),
      'utf8'
    );

    console.log(`✓ Complete! Metadata saved to: ${outputFile}`);
    console.log(`✓ Summary saved to: ${outputFile.replace('.json', '_summary.json')}`);

    // Clean up progress file if it exists
    const progressFile = outputFile.replace('.json', '_progress.json');
    if (fs.existsSync(progressFile)) {
      fs.unlinkSync(progressFile);
    }

  } catch (error) {
    console.error(`\n❌ Failed to fetch collection metadata: ${error.message}`);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node fetch-collection-metadata.js <collection-address> [output-file.json]');
    console.log('\nExample:');
    console.log('  node fetch-collection-metadata.js 5wCZpceCqXqnDudAYmzD8PZTZL72zgWZuyadMP6XVRo');
    console.log('  node fetch-collection-metadata.js 5wCZpceCqXqnDudAYmzD8PZTZL72zgWZuyadMP6XVRo aliens-collection.json');
    console.log('\nNote: This script will fetch metadata for ALL NFTs in the collection.');
    console.log('      This may take a while depending on collection size.');
    process.exit(1);
  }

  const collectionAddress = args[0];
  const outputFile = args[1] || 'collection-metadata.json';

  try {
    await fetchCollectionMetadata(collectionAddress, outputFile);
  } catch (error) {
    console.error(`\n❌ Failed: ${error.message}`);
    process.exit(1);
  }
}

main();

