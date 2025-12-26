import Irys from "@irys/sdk";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";

const NETWORK = "mainnet";
const TOKEN = "solana";

async function checkBalance() {
  try {
    const privateKey = process.env.SOLANA_PRIVATE_KEY;
    if (!privateKey) {
      console.log("❌ SOLANA_PRIVATE_KEY environment variable not set.");
      return;
    }

    // Create keypair
    const privateKeyBytes = bs58.decode(privateKey);
    const keypair = Keypair.fromSecretKey(privateKeyBytes);
    
    console.log(`\n📍 Wallet Address: ${keypair.publicKey.toString()}\n`);

    // Check wallet balance
    const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
    const walletBalance = await connection.getBalance(keypair.publicKey);
    const walletBalanceSOL = walletBalance / LAMPORTS_PER_SOL;
    console.log(`💰 Wallet SOL Balance: ${walletBalanceSOL.toFixed(4)} SOL`);

    // Check Irys balance
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
    console.log(`💳 Irys Prepaid Balance: ${irysBalanceSOL} SOL`);
    console.log(`📍 Irys Address: ${irys.address}\n`);

    // Calculate totals
    const totalAvailable = walletBalanceSOL + parseFloat(irysBalanceSOL);
    console.log(`📊 Total Available: ${totalAvailable.toFixed(4)} SOL`);
    
    // Calculate what was spent
    const initialFunding = 1.1725; // What we funded initially
    const spent = initialFunding - parseFloat(irysBalanceSOL);
    console.log(`💸 Estimated Spent (from Irys): ~${spent.toFixed(4)} SOL\n`);

  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

checkBalance();










