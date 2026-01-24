//! Deposit Tracker API Endpoints
//!
//! REST and WebSocket endpoints for deposit tracking:
//! - POST /api/deposits - Register a new deposit
//! - GET /api/deposits/:id - Get deposit status
//! - WS /ws/deposits/:id - Subscribe to status updates
//! - WS /ws/deposits - Subscribe to all updates

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};

use super::service::DepositTrackerService;
use super::types::{
    DepositStatusResponse, RegisterDepositRequest, RegisterDepositResponse,
};
use super::websocket::{
    create_ws_state, ws_all_deposits_handler, ws_deposit_handler, SharedWebSocketState,
};

/// Combined application state
pub struct AppState {
    pub tracker: Arc<RwLock<DepositTrackerService>>,
    pub ws_state: SharedWebSocketState,
}

/// Shared app state type
pub type SharedAppState = Arc<AppState>;

/// Create the deposit tracker API router
pub fn create_deposit_router(tracker: DepositTrackerService) -> Router {
    let ws_state = create_ws_state();
    let tracker_with_ws = tracker.with_websocket(ws_state.clone());

    let state = Arc::new(AppState {
        tracker: Arc::new(RwLock::new(tracker_with_ws)),
        ws_state,
    });

    // CORS configuration
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // REST endpoints
        .route("/api/deposits", post(handle_register_deposit))
        .route("/api/deposits/:id", get(handle_get_deposit))
        .route("/api/deposits", get(handle_list_deposits))
        // WebSocket endpoints
        .route("/ws/deposits/:id", get(ws_deposit_handler_wrapper))
        .route("/ws/deposits", get(ws_all_deposits_handler_wrapper))
        // Health check
        .route("/api/tracker/health", get(handle_health))
        .layer(cors)
        .with_state(state)
}

// =============================================================================
// REST Handlers
// =============================================================================

/// POST /api/deposits
///
/// Register a new deposit to track.
async fn handle_register_deposit(
    State(state): State<SharedAppState>,
    Json(req): Json<RegisterDepositRequest>,
) -> impl IntoResponse {
    let mut tracker = state.tracker.write().await;

    match tracker.register_deposit(req.taproot_address, req.commitment, req.amount_sats) {
        Ok(id) => {
            let response = RegisterDepositResponse {
                success: true,
                deposit_id: Some(id),
                message: Some("Deposit registered for tracking".to_string()),
            };
            (StatusCode::OK, Json(response))
        }
        Err(e) => {
            let response = RegisterDepositResponse {
                success: false,
                deposit_id: None,
                message: Some(e.to_string()),
            };
            (StatusCode::BAD_REQUEST, Json(response))
        }
    }
}

/// GET /api/deposits/:id
///
/// Get the status of a specific deposit.
async fn handle_get_deposit(
    State(state): State<SharedAppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let tracker = state.tracker.read().await;

    match tracker.get_deposit(&id) {
        Some(record) => {
            let response = DepositStatusResponse::from(record);
            (StatusCode::OK, Json(response)).into_response()
        }
        None => {
            let error = serde_json::json!({
                "error": "Not found",
                "details": format!("Deposit {} not found", id)
            });
            (StatusCode::NOT_FOUND, Json(error)).into_response()
        }
    }
}

/// GET /api/deposits
///
/// List all deposits (for admin/debugging).
async fn handle_list_deposits(State(state): State<SharedAppState>) -> impl IntoResponse {
    let tracker = state.tracker.read().await;

    let deposits: Vec<DepositStatusResponse> = tracker
        .get_all_deposits()
        .iter()
        .map(|r| DepositStatusResponse::from(*r))
        .collect();

    Json(serde_json::json!({
        "deposits": deposits,
        "stats": tracker.stats()
    }))
}

/// GET /api/tracker/health
///
/// Health check endpoint.
async fn handle_health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "sbbtc-deposit-tracker",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

// =============================================================================
// WebSocket Handler Wrappers
// =============================================================================

/// WebSocket handler wrapper for single deposit
async fn ws_deposit_handler_wrapper(
    ws: axum::extract::ws::WebSocketUpgrade,
    Path(id): Path<String>,
    State(state): State<SharedAppState>,
) -> impl IntoResponse {
    ws_deposit_handler(ws, Path(id), State(state.ws_state.clone())).await
}

/// WebSocket handler wrapper for all deposits
async fn ws_all_deposits_handler_wrapper(
    ws: axum::extract::ws::WebSocketUpgrade,
    State(state): State<SharedAppState>,
) -> impl IntoResponse {
    ws_all_deposits_handler(ws, State(state.ws_state.clone())).await
}

// =============================================================================
// Combined API Server
// =============================================================================

/// Start the deposit tracker API server
///
/// This can be used standalone or combined with the redemption API.
pub async fn start_tracker_server(
    tracker: DepositTrackerService,
    port: u16,
) -> Result<(), std::io::Error> {
    let app = create_deposit_router(tracker);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));

    println!("=== sbBTC Deposit Tracker API ===");
    println!("Listening on http://{}", addr);
    println!();
    println!("Endpoints:");
    println!("  POST /api/deposits          - Register deposit to track");
    println!("  GET  /api/deposits/:id      - Get deposit status");
    println!("  GET  /api/deposits          - List all deposits");
    println!("  WS   /ws/deposits/:id       - Subscribe to deposit updates");
    println!("  WS   /ws/deposits           - Subscribe to all updates");
    println!("  GET  /api/tracker/health    - Health check");
    println!();

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_health_endpoint() {
        let config = super::super::types::TrackerConfig::default();
        let tracker = DepositTrackerService::new_testnet(config);
        let app = create_deposit_router(tracker);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/tracker/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_register_deposit() {
        let config = super::super::types::TrackerConfig::default();
        let tracker = DepositTrackerService::new_testnet(config);
        let app = create_deposit_router(tracker);

        let body = serde_json::json!({
            "taproot_address": "tb1p123abc",
            "commitment": "a".repeat(64),
            "amount_sats": 100000
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/deposits")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_get_nonexistent_deposit() {
        let config = super::super::types::TrackerConfig::default();
        let tracker = DepositTrackerService::new_testnet(config);
        let app = create_deposit_router(tracker);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/deposits/nonexistent")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
