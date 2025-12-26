# Arweave Upload Script Instructions

This script uploads all images from your Mindfolk Images folder to Arweave via Irys using your Phantom wallet.

## Prerequisites

1. **Node.js installed** ✅ (You mentioned it's installed)
2. **Phantom wallet** with SOL balance (~$15-20 worth for 10,725 images)
3. **Phantom private key** exported from your wallet

## Setup Steps

### 1. Install Dependencies

Open PowerShell/CMD in the project folder and run:

```bash
cd "E:\Tralha\Stuff\crypto design\MY MINDFOLK\mindfolkgallery"
npm install
```

### 2. Export Your Phantom Private Key

1. Open Phantom wallet browser extension
2. Click the menu (☰) → Settings
3. Go to **Security & Privacy**
4. Click **Export Private Key**
5. Enter your Phantom password
6. **Copy the private key** (it's a long base58 string)
7. **Keep this secure!** Never share it or commit it to git.

### 3. Set Environment Variable

**Windows PowerShell:**
```powershell
$env:SOLANA_PRIVATE_KEY='your_private_key_here'
```

**Windows CMD:**
```cmd
set SOLANA_PRIVATE_KEY=your_private_key_here
```

**Important:** This only sets it for the current terminal session. If you close the terminal, you'll need to set it again.

### 4. Run the Upload Script

```bash
node upload-to-irys.js
```

## What the Script Does

1. ✅ Scans `E:\Tralha\Stuff\crypto design\MY MINDFOLK\Mindfolk Images` for all images
2. ✅ Connects to your Phantom wallet using the private key
3. ✅ Initializes Irys with Solana payment
4. ✅ Uploads images in batches of 10
5. ✅ Saves progress after each upload (can resume if interrupted)
6. ✅ Generates `arweave_image_mapping.json` with format: `{"filename": "arweave-url"}`

## Output

The script creates `arweave_image_mapping.json` in the same folder with:
```json
{
  "Mindfolk_Founder_0008.png": "https://arweave.net/abc123...",
  "Mindfolk_Founder_0009.gif": "https://arweave.net/def456...",
  ...
}
```

## Resuming Uploads

If the script stops (network error, etc.), just run it again. It will:
- Load existing mappings from `arweave_image_mapping.json`
- Skip already uploaded files
- Continue from where it left off

## Cost Estimate

- **Per image:** ~0.0001 SOL
- **10,725 images:** ~1.07 SOL (~$15-20 depending on SOL price)
- Make sure you have enough SOL in your Phantom wallet

## Troubleshooting

**Error: "SOLANA_PRIVATE_KEY environment variable not set"**
- Make sure you set the environment variable in the same terminal session
- Check that the private key is correct (no extra spaces)

**Error: "Invalid private key format"**
- Make sure you copied the entire private key
- It should be a long base58 string

**Error: "Insufficient balance"**
- Add more SOL to your Phantom wallet
- Check current balance in Phantom

**Upload stops mid-way**
- Just run the script again - it will resume from where it stopped
- Already uploaded files are saved in the JSON file

## Security Note

⚠️ **NEVER commit your private key to git or share it publicly!**
- The private key gives full access to your wallet
- Keep it secure and private
- Consider using a separate wallet for uploads if you're concerned










