import { Connection, PublicKey } from '@solana/web3.js';
import { createHash } from 'crypto';

// Metaplex Token Metadata Program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Solana RPC endpoint (using public endpoint, can be replaced with a private one for better rate limits)
const RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';

/**
 * Find the metadata PDA (Program Derived Address) for a given mint
 */
function findMetadataPDA(mint) {
  const seeds = [
    Buffer.from('metadata'),
    TOKEN_METADATA_PROGRAM_ID.toBuffer(),
    mint.toBuffer(),
  ];
  
  const [pda] = PublicKey.findProgramAddressSync(
    seeds,
    TOKEN_METADATA_PROGRAM_ID
  );
  
  return pda;
}

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
 * Decode creator array
 */
function decodeCreators(buffer, offset) {
  const option = decodeOption(buffer, offset);
  if (!option.hasValue) {
    return { creators: null, offset: option.offset };
  }
  
  const length = buffer.readUInt32LE(option.offset);
  const creators = [];
  let currentOffset = option.offset + 4;
  
  for (let i = 0; i < length; i++) {
    const address = new PublicKey(buffer.slice(currentOffset, currentOffset + 32));
    currentOffset += 32;
    const verified = buffer.readUInt8(currentOffset) === 1;
    currentOffset += 1;
    const share = buffer.readUInt8(currentOffset);
    currentOffset += 1;
    
    creators.push({
      address: address.toString(),
      verified,
      share
    });
  }
  
  return { creators, offset: currentOffset };
}

/**
 * Decode collection
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
 * Decode uses
 */
function decodeUses(buffer, offset) {
  const option = decodeOption(buffer, offset);
  if (!option.hasValue) {
    return { uses: null, offset: option.offset };
  }
  
  const useMethod = buffer.readUInt8(option.offset);
  const remaining = buffer.readBigUInt64LE(option.offset + 1);
  const total = buffer.readBigUInt64LE(option.offset + 9);
  
  return {
    uses: {
      useMethod,
      remaining: remaining.toString(),
      total: total.toString()
    },
    offset: option.offset + 17
  };
}

/**
 * Decode metadata account data
 */
function decodeMetadata(buffer) {
  let offset = 0;
  
  // Key (1 byte) - skip
  offset += 1;
  
  // Update authority (32 bytes)
  const updateAuthority = new PublicKey(buffer.slice(offset, offset + 32));
  offset += 32;
  
  // Mint (32 bytes)
  const mint = new PublicKey(buffer.slice(offset, offset + 32));
  offset += 32;
  
  // Name (4 bytes length + string)
  const nameLength = buffer.readUInt32LE(offset);
  offset += 4;
  const name = decodeString(buffer, offset, nameLength);
  offset += nameLength;
  
  // Symbol (4 bytes length + string)
  const symbolLength = buffer.readUInt32LE(offset);
  offset += 4;
  const symbol = decodeString(buffer, offset, symbolLength);
  offset += symbolLength;
  
  // URI (4 bytes length + string)
  const uriLength = buffer.readUInt32LE(offset);
  offset += 4;
  const uri = decodeString(buffer, offset, uriLength);
  offset += uriLength;
  
  // Seller fee basis points (2 bytes)
  const sellerFeeBasisPoints = buffer.readUInt16LE(offset);
  offset += 2;
  
  // Creators (optional array)
  const creatorsData = decodeCreators(buffer, offset);
  const creators = creatorsData.creators;
  offset = creatorsData.offset;
  
  // Primary sale happened (1 byte)
  const primarySaleHappened = buffer.readUInt8(offset) === 1;
  offset += 1;
  
  // Is mutable (1 byte)
  const isMutable = buffer.readUInt8(offset) === 1;
  offset += 1;
  
  // Edition nonce (optional, 1 byte)
  const editionNonceOption = decodeOption(buffer, offset);
  const editionNonce = editionNonceOption.hasValue ? buffer.readUInt8(editionNonceOption.offset) : null;
  offset = editionNonceOption.hasValue ? editionNonceOption.offset + 1 : editionNonceOption.offset;
  
  // Token standard (optional, 1 byte)
  const tokenStandardOption = decodeOption(buffer, offset);
  const tokenStandard = tokenStandardOption.hasValue ? buffer.readUInt8(tokenStandardOption.offset) : null;
  offset = tokenStandardOption.hasValue ? tokenStandardOption.offset + 1 : tokenStandardOption.offset;
  
  // Collection (optional)
  const collectionData = decodeCollection(buffer, offset);
  const collection = collectionData.collection;
  offset = collectionData.offset;
  
  // Uses (optional)
  const usesData = decodeUses(buffer, offset);
  const uses = usesData.uses;
  offset = usesData.offset;
  
  return {
    updateAuthority: updateAuthority.toString(),
    mint: mint.toString(),
    name,
    symbol,
    uri,
    sellerFeeBasisPoints,
    creators,
    primarySaleHappened,
    isMutable,
    editionNonce,
    tokenStandard,
    collection,
    uses
  };
}

/**
 * Fetch NFT metadata from Solana blockchain
 * @param {string} mintAddress - The mint address of the NFT
 * @returns {Promise<Object>} Complete NFT metadata
 */
async function fetchNFTMetadata(mintAddress) {
  try {
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const mintPubkey = new PublicKey(mintAddress);

    // Optional: verbose mode (set via environment variable or parameter)
    const verbose = process.env.VERBOSE === 'true' || (typeof fetchNFTMetadata.verbose !== 'undefined' && fetchNFTMetadata.verbose);
    
    if (verbose) {
      console.log(`\n🔍 Fetching metadata for: ${mintAddress}`);
    }

    // Get the metadata PDA
    const metadataPDA = findMetadataPDA(mintPubkey);
    
    if (verbose) {
      console.log(`📍 Metadata account: ${metadataPDA.toString()}`);
    }

    // Fetch the metadata account data
    const metadataAccount = await connection.getAccountInfo(metadataPDA);
    
    if (!metadataAccount) {
      throw new Error('Metadata account not found. This might not be a valid NFT mint address.');
    }

    // Decode the metadata
    const metadata = decodeMetadata(metadataAccount.data);
    
    if (verbose) {
      console.log(`✓ Metadata account found`);
      console.log(`  Name: ${metadata.name}`);
      console.log(`  Symbol: ${metadata.symbol}`);
      console.log(`  URI: ${metadata.uri}`);
    }

    // Fetch the JSON metadata from the URI
    let jsonMetadata = null;
    if (metadata.uri) {
      try {
        if (verbose) {
          console.log(`\n📥 Fetching JSON metadata from URI...`);
        }
        const response = await fetch(metadata.uri);
        if (response.ok) {
          jsonMetadata = await response.json();
          if (verbose) {
            console.log(`✓ JSON metadata fetched successfully`);
          }
        } else {
          if (verbose) {
            console.warn(`⚠️  Failed to fetch JSON metadata: ${response.status} ${response.statusText}`);
          }
        }
      } catch (error) {
        if (verbose) {
          console.warn(`⚠️  Error fetching JSON metadata: ${error.message}`);
        }
      }
    }

    // Compile complete metadata
    const completeMetadata = {
      // On-chain metadata
      mintAddress: mintAddress,
      metadataAccount: metadataPDA.toString(),
      ...metadata,
      // Off-chain JSON metadata
      jsonMetadata: jsonMetadata
    };

    return completeMetadata;

  } catch (error) {
    console.error(`❌ Error fetching metadata: ${error.message}`);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node fetch-nft-metadata.js <mint-address> [output-file.json]');
    console.log('\nExample:');
    console.log('  node fetch-nft-metadata.js 7HMXWrYSBXu5gdEDKNSFaFgQ1H6uEZ8GAbPvKs2PfpRX');
    console.log('  node fetch-nft-metadata.js 7HMXWrYSBXu5gdEDKNSFaFgQ1H6uEZ8GAbPvKs2PfpRX output.json');
    process.exit(1);
  }

  const mintAddress = args[0];
  const outputFile = args[1] || null;

  try {
    const metadata = await fetchNFTMetadata(mintAddress);

    // Display summary
    console.log('\n' + '='.repeat(60));
    console.log('📋 COMPLETE METADATA');
    console.log('='.repeat(60));
    console.log(JSON.stringify(metadata, null, 2));

    // Save to file if specified
    if (outputFile) {
      const fs = await import('fs');
      fs.writeFileSync(outputFile, JSON.stringify(metadata, null, 2), 'utf8');
      console.log(`\n💾 Metadata saved to: ${outputFile}`);
    }

  } catch (error) {
    console.error(`\n❌ Failed to fetch metadata: ${error.message}`);
    process.exit(1);
  }
}

// Run main function
main();

export { fetchNFTMetadata };
