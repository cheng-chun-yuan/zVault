//! REST API for Redemption Service
//!
//! Minimal API with 2 endpoints:
//! - POST /api/redeem - Submit withdrawal request
//! - GET /api/withdrawal/:id - Check withdrawal status
//!
//! All other operations (deposit, claim, split) are handled client-side via SDK.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};

use crate::redemption::{RedemptionService, WithdrawalStatus};

// =============================================================================
// Request/Response Types
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct RedeemRequest {
    pub amount_sats: u64,
    pub btc_address: String,
    pub solana_address: String,
}

#[derive(Debug, Serialize)]
pub struct RedeemResponse {
    pub success: bool,
    pub request_id: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct WithdrawalStatusResponse {
    pub request_id: String,
    pub status: String,
    pub amount_sats: u64,
    pub btc_address: String,
    pub btc_txid: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub details: Option<String>,
}

// =============================================================================
// Application State
// =============================================================================

pub type AppState = Arc<RwLock<RedemptionService>>;

// =============================================================================
// API Handlers
// =============================================================================

/// POST /api/redeem
///
/// Submit a withdrawal request. The redemption processor will:
/// 1. Validate the request
/// 2. Build and sign a BTC transaction
/// 3. Broadcast to the Bitcoin network
///
/// Returns a request_id to track status.
async fn handle_redeem(
    State(service): State<AppState>,
    Json(req): Json<RedeemRequest>,
) -> impl IntoResponse {
    let service = service.read().await;

    match service
        .submit_withdrawal(
            format!("api_request_{}", chrono::Utc::now().timestamp_millis()),
            req.solana_address.clone(),
            req.amount_sats,
            req.btc_address.clone(),
        )
        .await
    {
        Ok(request_id) => {
            let response = RedeemResponse {
                success: true,
                request_id: Some(request_id),
                message: Some("Withdrawal request submitted".to_string()),
            };
            (StatusCode::OK, Json(response))
        }
        Err(e) => {
            let response = RedeemResponse {
                success: false,
                request_id: None,
                message: Some(e.to_string()),
            };
            (StatusCode::BAD_REQUEST, Json(response))
        }
    }
}

/// GET /api/withdrawal/:id
///
/// Check the status of a withdrawal request.
async fn handle_withdrawal_status(
    State(service): State<AppState>,
    Path(request_id): Path<String>,
) -> impl IntoResponse {
    let service = service.read().await;

    match service.get_request(&request_id).await {
        Some(request) => {
            let status_str = match request.status {
                WithdrawalStatus::Pending => "pending",
                WithdrawalStatus::Building => "processing",
                WithdrawalStatus::Signing => "processing",
                WithdrawalStatus::Broadcasting => "broadcasting",
                WithdrawalStatus::Confirming => "broadcasting",
                WithdrawalStatus::Complete => "completed",
                WithdrawalStatus::Failed => "failed",
            };

            let response = WithdrawalStatusResponse {
                request_id: request.id,
                status: status_str.to_string(),
                amount_sats: request.amount_sats,
                btc_address: request.btc_address,
                btc_txid: request.btc_txid,
                created_at: request.created_at,
                updated_at: request.updated_at,
            };
            (StatusCode::OK, Json(response)).into_response()
        }
        None => {
            let response = ErrorResponse {
                error: "Not found".to_string(),
                details: Some(format!("Withdrawal request {} not found", request_id)),
            };
            (StatusCode::NOT_FOUND, Json(response)).into_response()
        }
    }
}

/// GET /api/health
///
/// Health check endpoint.
async fn handle_health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "sbbtc-redemption-api",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

// =============================================================================
// Router Setup
// =============================================================================

/// Create the API router with all endpoints
pub fn create_router(service: RedemptionService) -> Router {
    let state: AppState = Arc::new(RwLock::new(service));

    // CORS configuration - allow frontend origins
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/api/health", get(handle_health))
        .route("/api/redeem", post(handle_redeem))
        .route("/api/withdrawal/status/:id", get(handle_withdrawal_status))
        .layer(cors)
        .with_state(state)
}

/// Start the API server
pub async fn start_server(service: RedemptionService, port: u16) -> Result<(), std::io::Error> {
    let app = create_router(service);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));

    println!("=== sbBTC Redemption API ===");
    println!("Listening on http://{}", addr);
    println!();
    println!("Endpoints:");
    println!("  POST /api/redeem          - Submit withdrawal request");
    println!("  GET  /api/withdrawal/:id  - Check withdrawal status");
    println!("  GET  /api/health          - Health check");
    println!();

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_health_endpoint() {
        let service = RedemptionService::new_testnet();
        let app = create_router(service);

        let response = app
            .oneshot(Request::builder().uri("/api/health").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }
}
