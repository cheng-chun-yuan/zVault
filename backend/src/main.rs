//! sbBTC Backend - Minimal Services
//!
//! Server-side services:
//! 1. Header Relay (TypeScript) - Submits Bitcoin headers to Solana light client
//! 2. Redemption Processor - Processes BTC withdrawals
//! 3. Deposit Tracker - Tracks BTC deposits and handles SPV verification
//!
//! All other functionality is handled by the SDK on the client side.
//!
//! Run modes:
//!   cargo run                    - Show usage
//!   cargo run -- api             - Start REST API (for frontend)
//!   cargo run -- redemption      - Start redemption processor (background)
//!   cargo run -- tracker         - Start deposit tracker (background)
//!   cargo run -- demo            - Run interactive demo

use sbbtc::api;
use sbbtc::deposit_tracker::{self, TrackerConfig};
use sbbtc::redemption::{RedemptionConfig, RedemptionService, SingleKeySigner};
use sbbtc::units;
use std::env;

#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        print_usage();
        return;
    }

    match args[1].as_str() {
        "api" => run_api_server(&args[2..]).await,
        "redemption" => run_redemption_service(&args[2..]).await,
        "tracker" => run_tracker_service(&args[2..]).await,
        "demo" => run_demo().await,
        "help" | "--help" | "-h" => print_usage(),
        _ => print_usage(),
    }
}

fn print_usage() {
    println!("sbBTC Backend - Server-Side Services");
    println!();
    println!("Usage:");
    println!("  sbbtc-api api [--port <port>]               Start REST API server (default: 3001)");
    println!("  sbbtc-api redemption [--interval <secs>]    Start redemption processor");
    println!("  sbbtc-api tracker [--interval <secs>]       Start deposit tracker");
    println!("  sbbtc-api demo                              Run interactive demo");
    println!();
    println!("Environment Variables:");
    println!("  POOL_SIGNING_KEY      Hex-encoded private key for BTC signing");
    println!("  POOL_RECEIVE_ADDRESS  Pool wallet address for swept funds");
    println!("  API_PORT              REST API port (default: 3001)");
    println!("  SOLANA_RPC_URL        Solana RPC endpoint");
    println!("  VERIFIER_KEYPAIR      Path to Solana keypair for verification");
    println!();
    println!("Note: Most functionality is handled by the SDK on the client side.");
    println!();
    println!("Header Relay (TypeScript):");
    println!("  cd backend/header-relayer && bun run start");
}

/// Create redemption service from environment
fn create_service(config: RedemptionConfig) -> RedemptionService {
    if let Ok(key_hex) = env::var("POOL_SIGNING_KEY") {
        match SingleKeySigner::from_hex(&key_hex) {
            Ok(signer) => RedemptionService::new_with_signer(config, signer),
            Err(e) => {
                eprintln!("Warning: Invalid POOL_SIGNING_KEY: {}", e);
                RedemptionService::new_testnet()
            }
        }
    } else {
        RedemptionService::new_testnet()
    }
}

/// Start REST API server
async fn run_api_server(args: &[String]) {
    let mut port: u16 = env::var("API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);

    // Parse arguments
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--port" if i + 1 < args.len() => {
                port = args[i + 1].parse().unwrap_or(3001);
                i += 2;
            }
            _ => i += 1,
        }
    }

    let config = RedemptionConfig::default();
    let service = create_service(config);

    if let Err(e) = api::start_server(service, port).await {
        eprintln!("API server error: {}", e);
    }
}

async fn run_redemption_service(args: &[String]) {
    let mut config = RedemptionConfig::default();

    // Parse arguments
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--interval" if i + 1 < args.len() => {
                config.check_interval_secs = args[i + 1].parse().unwrap_or(30);
                i += 2;
            }
            "--min-amount" if i + 1 < args.len() => {
                config.min_withdrawal = args[i + 1].parse().unwrap_or(10_000);
                i += 2;
            }
            _ => i += 1,
        }
    }

    let service = create_service(config.clone());

    println!("=== sbBTC Redemption Processor ===");
    println!();
    println!("Configuration:");
    println!("  Check Interval: {} seconds", config.check_interval_secs);
    println!("  Min Withdrawal: {}", units::format_sats(config.min_withdrawal));
    println!("  Max Withdrawal: {}", units::format_sats(config.max_withdrawal));
    println!();
    println!("Signer: {} ({})", service.signer_type(), service.pool_public_key());
    println!();
    println!("Watching for RedemptionRequest PDAs on Solana...");
    println!("Press Ctrl+C to stop");
    println!();

    if let Err(e) = service.run().await {
        eprintln!("Error: {}", e);
    }
}

async fn run_tracker_service(args: &[String]) {
    let mut config = TrackerConfig::default();

    // Parse arguments
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--interval" if i + 1 < args.len() => {
                config.poll_interval_secs = args[i + 1].parse().unwrap_or(10);
                i += 2;
            }
            "--confirmations" if i + 1 < args.len() => {
                config.required_confirmations = args[i + 1].parse().unwrap_or(6);
                i += 2;
            }
            _ => i += 1,
        }
    }

    // Load pool address from env
    if let Ok(addr) = env::var("POOL_RECEIVE_ADDRESS") {
        config.pool_receive_address = addr;
    }

    // Load Solana RPC from env
    if let Ok(rpc) = env::var("SOLANA_RPC_URL") {
        config.solana_rpc = rpc;
    }

    // Create service with optional sweeper
    let service = deposit_tracker::DepositTrackerService::new_testnet(config.clone());

    // Configure sweeper if signing key available
    let service = if let Ok(key_hex) = env::var("POOL_SIGNING_KEY") {
        match service.with_sweeper(&key_hex) {
            Ok(s) => {
                println!("Sweeper configured with pool signing key");
                s
            }
            Err(e) => {
                eprintln!("Warning: Failed to configure sweeper: {}", e);
                // Recreate service without sweeper
                deposit_tracker::DepositTrackerService::new_testnet(config.clone())
            }
        }
    } else {
        service
    };

    // Configure verifier if keypair available
    let mut service = if let Ok(keypair_path) = env::var("VERIFIER_KEYPAIR") {
        match sbbtc::load_keypair_from_file(&keypair_path) {
            Ok(keypair) => {
                println!("Verifier configured with Solana keypair");
                service.with_verifier(keypair)
            }
            Err(e) => {
                eprintln!("Warning: Failed to load verifier keypair: {}", e);
                service
            }
        }
    } else {
        service
    };

    println!("=== sbBTC Deposit Tracker ===");
    println!();
    println!("Configuration:");
    println!("  Poll Interval: {} seconds", config.poll_interval_secs);
    println!("  Required Confirmations: {}", config.required_confirmations);
    println!(
        "  Required Sweep Confirmations: {}",
        config.required_sweep_confirmations
    );
    println!("  Pool Address: {}", config.pool_receive_address);
    println!();
    println!("Watching for Bitcoin deposits...");
    println!("Press Ctrl+C to stop");
    println!();

    if let Err(e) = service.run().await {
        eprintln!("Error: {}", e);
    }
}

async fn run_demo() {
    use sbbtc::taproot::{generate_deposit_address, PoolKeys};
    use bitcoin::Network;

    println!("\n=== sbBTC Demo ===\n");
    println!("Note: In production, use the SDK for client-side operations.");
    println!();

    // Create pool keys
    let pool_keys = PoolKeys::new();
    println!("Pool Public Key: {}", hex::encode(pool_keys.internal_key.serialize()));
    println!();

    // Generate a sample commitment
    let sample_commitment = [0x42u8; 32];
    let amount = 100_000u64; // 0.001 BTC

    // Generate deposit address
    let deposit_addr =
        generate_deposit_address(&pool_keys, &sample_commitment, Network::Testnet).unwrap();
    println!("Sample Deposit Address: {}", deposit_addr.address);
    println!("Amount: {}", units::format_sats(amount));
    println!();

    println!("=== Flow Overview ===");
    println!();
    println!("1. DEPOSIT (Client-side via SDK):");
    println!("   - SDK generates note (nullifier + secret)");
    println!("   - SDK derives taproot address");
    println!("   - User sends BTC externally");
    println!("   - SDK verifies via Esplora + submits to Solana");
    println!();
    println!("2. CLAIM (Client-side via SDK):");
    println!("   - SDK generates Noir ZK proof locally");
    println!("   - SDK submits claim transaction to Solana");
    println!("   - sbBTC minted to user's wallet");
    println!();
    println!("3. WITHDRAW (Server-side redemption processor):");
    println!("   - User burns sbBTC via SDK (creates RedemptionRequest PDA)");
    println!("   - Redemption processor detects request");
    println!("   - Processor signs and broadcasts BTC transaction");
    println!("   - Processor calls complete_redemption after confirms");
    println!();

    println!("=== Demo Complete ===");
}
