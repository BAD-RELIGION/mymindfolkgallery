import Irys from "@irys/sdk";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import readline from "readline";

const NETWORK = "mainnet";
const TOKEN = "solana";

// Helper function to ask user input
function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Check actual wallet SOL balance
async function getWalletBalance(keypair) {
  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const publicKey = keypair.publicKey;
  const balance = await connection.getBalance(publicKey);
  return balance / LAMPORTS_PER_SOL;
}

// Connect to wallet
async function connectPhantom() {
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("SOLANA_PRIVATE_KEY environment variable not set.");
  }

  try {
    const privateKeyBytes = bs58.decode(privateKey);
    const keypair = Keypair.fromSecretKey(privateKeyBytes);
    return keypair;
  } catch (error) {
    throw new Error("Invalid private key format.");
  }
}

// Main function
async function main() {
  try {
    console.log("💰 Total Cost Calculator\n");
    console.log("This will calculate your total SOL spending on uploads.\n");

    // Connect to wallet
    const keypair = await connectPhantom();
    console.log(`📍 Wallet Address: ${keypair.publicKey.toString()}\n`);

    // Check current balances
    const walletBalance = await getWalletBalance(keypair);
    
    const irys = new Irys({
      network: NETWORK,
      token: TOKEN,
      key: keypair.secretKey,
      config: {
        providerUrl: "https://api.mainnet-beta.solana.com",
      },
    });

    const irysBalance = await irys.getLoadedBalance();
    const irysBalanceSOL = irys.utils.fromAtomic(irysBalance);

    console.log("📊 Current Balances:");
    console.log(`💰 Wallet SOL Balance: ${walletBalance.toFixed(4)} SOL`);
    console.log(`💳 Irys Prepaid Balance: ${irysBalanceSOL} SOL\n`);

    // Known funding amounts from our conversation
    console.log("📝 Known Funding History:");
    console.log("  - Initial funding: 1.1725 SOL");
    console.log("  - Additional funding: 0.4 SOL");
    const totalFunded = 1.1725 + 0.4;
    console.log(`  - Total funded to Irys: ${totalFunded} SOL\n`);

    // Calculate spending
    const spentOnUploads = totalFunded - parseFloat(irysBalanceSOL);
    const totalSpent = totalFunded - parseFloat(irysBalanceSOL);

    console.log("💸 Spending Breakdown:");
    console.log(`  - Total funded to Irys: ${totalFunded.toFixed(4)} SOL`);
    console.log(`  - Remaining in Irys: ${irysBalanceSOL} SOL`);
    console.log(`  - Spent on uploads: ${spentOnUploads.toFixed(4)} SOL\n`);

    // Ask for starting wallet balance to calculate total wallet spending
    console.log("To calculate total wallet spending, I need your starting wallet balance.");
    console.log("(Before you started the uploads)");
    const startingBalance = await askQuestion("What was your wallet balance when you started? (SOL, or press Enter to skip): ");
    
    if (startingBalance && !isNaN(parseFloat(startingBalance))) {
      const startingBal = parseFloat(startingBalance);
      const totalWalletSpent = startingBal - walletBalance;
      
      console.log("\n📊 Complete Spending Analysis:");
      console.log(`  - Starting wallet balance: ${startingBal.toFixed(4)} SOL`);
      console.log(`  - Current wallet balance: ${walletBalance.toFixed(4)} SOL`);
      console.log(`  - Total wallet spending: ${totalWalletSpent.toFixed(4)} SOL`);
      console.log(`  - Spent on uploads (from Irys): ${spentOnUploads.toFixed(4)} SOL`);
      console.log(`  - Remaining in Irys: ${irysBalanceSOL} SOL`);
      console.log(`  - Total SOL used for uploads: ${spentOnUploads.toFixed(4)} SOL\n`);
      
      // Estimate USD value (approximate SOL price)
      const solPrice = 133; // Approximate USD price, user can update
      console.log(`💵 Estimated USD Cost (at ~$${solPrice}/SOL):`);
      console.log(`  - Total upload cost: $${(spentOnUploads * solPrice).toFixed(2)}`);
    } else {
      console.log("\n📊 Upload Spending Summary:");
      console.log(`  - Total funded to Irys: ${totalFunded.toFixed(4)} SOL`);
      console.log(`  - Spent on uploads: ${spentOnUploads.toFixed(4)} SOL`);
      console.log(`  - Remaining in Irys: ${irysBalanceSOL} SOL`);
      console.log(`  - Can be withdrawn: ${(parseFloat(irysBalanceSOL) - 0.001).toFixed(4)} SOL (leaving 0.001 for fees)\n`);
    }

  } catch (error) {
    console.error("\n❌ Error:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();










