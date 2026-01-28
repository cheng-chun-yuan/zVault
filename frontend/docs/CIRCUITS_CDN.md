# Circuit CDN Setup

ZK circuit artifacts are hosted on Cloudflare R2 for better performance and to reduce repository size.

## Current Setup

- **CDN URL:** `https://circuits.amidoggy.xyz`
- **Bucket:** `zvault-circuits`
- **Account:** Cloudflare (fb5def0d0fb624cb76bddca682c8bfaa)

## Circuit Files

| File | Description |
|------|-------------|
| `zvault_claim.json` | Claim circuit artifact |
| `zvault_claim_v2.json` | Claim circuit v2 (with Poseidon syscall) |
| `zvault_transfer.json` | Transfer circuit artifact |
| `zvault_stealth_transfer.json` | Stealth transfer circuit artifact |
| `zvault_split.json` | Split circuit artifact |
| `zvault_partial_withdraw.json` | Partial withdraw circuit artifact |
| `zvault_helpers.json` | Helper functions circuit |
| `zvault_pool_deposit.json` | Yield pool deposit circuit |
| `zvault_pool_withdraw.json` | Yield pool withdraw circuit |
| `zvault_pool_claim_yield.json` | Yield pool claim circuit |

## Updating Circuits

When you recompile circuits in `noir-circuits/`, upload the new artifacts:

```bash
# Set account ID
export CLOUDFLARE_ACCOUNT_ID=fb5def0d0fb624cb76bddca682c8bfaa

# Upload updated circuits
cd frontend
for file in public/circuits/noir/*.json; do
  filename=$(basename "$file")
  wrangler r2 object put "zvault-circuits/$filename" --file="$file" --remote
done
```

## Local Development

For local development, you can either:

1. **Use CDN (recommended):** Set in `.env.local`:
   ```
   NEXT_PUBLIC_CIRCUIT_CDN_URL=https://circuits.amidoggy.xyz
   ```

2. **Use local files:** Keep circuits in `public/circuits/noir/` and don't set the env variable (defaults to `/circuits/noir`)

## Setting Up a New CDN

If you need to set up a new R2 bucket:

```bash
# Login to Cloudflare
wrangler login

# Create bucket
export CLOUDFLARE_ACCOUNT_ID=your_account_id
wrangler r2 bucket create zvault-circuits

# Upload files
for file in public/circuits/noir/*.json; do
  filename=$(basename "$file")
  wrangler r2 object put "zvault-circuits/$filename" --file="$file" --remote
done
```

Then in Cloudflare Dashboard:
1. Go to R2 → zvault-circuits → Settings
2. Enable "Public access" → "Connect Domain"
3. Add your custom domain (e.g., `circuits.yourdomain.com`)

## CORS Configuration

If you encounter CORS issues, add this configuration in R2 bucket settings:

```json
[
  {
    "AllowedOrigins": ["https://yourdomain.com", "http://localhost:3000"],
    "AllowedMethods": ["GET"],
    "AllowedHeaders": ["*"]
  }
]
```
