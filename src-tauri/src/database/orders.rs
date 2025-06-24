use chrono::Utc;
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use sqlx::{Pool, Sqlite, Row};
use serde_json;
use std::collections::HashMap;

use crate::orders::{Order, OrderEvent};

pub async fn init_orders_db(pool: &Pool<Sqlite>) -> Result<(), sqlx::Error> {
    // Orders table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            client_order_id TEXT UNIQUE NOT NULL,
            broker_order_id TEXT,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            quantity REAL NOT NULL,
            order_type TEXT NOT NULL,
            order_params TEXT NOT NULL,
            status TEXT NOT NULL,
            filled_quantity REAL DEFAULT 0,
            average_fill_price REAL,
            commission REAL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            metadata TEXT
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create indices
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol)")
        .execute(pool)
        .await?;
    
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)")
        .execute(pool)
        .await?;
    
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)")
        .execute(pool)
        .await?;

    // Trades table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS trades (
            id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL REFERENCES orders(id),
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            quantity REAL NOT NULL,
            price REAL NOT NULL,
            commission REAL,
            commission_currency TEXT,
            executed_at INTEGER NOT NULL,
            broker_trade_id TEXT,
            venue TEXT,
            metadata TEXT
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Order events table (event sourcing)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS order_events (
            id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            event_data TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON order_events(order_id)")
        .execute(pool)
        .await?;

    // Position summary table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS position_summary (
            symbol TEXT PRIMARY KEY,
            net_quantity REAL NOT NULL,
            average_price REAL NOT NULL,
            realized_pnl REAL DEFAULT 0,
            unrealized_pnl REAL DEFAULT 0,
            total_commission REAL DEFAULT 0,
            last_updated INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Risk limits table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS risk_limits (
            id TEXT PRIMARY KEY,
            limit_type TEXT NOT NULL,
            symbol TEXT,
            max_position_size REAL,
            max_order_size REAL,
            max_daily_loss REAL,
            current_daily_pnl REAL DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn save_order(pool: &Pool<Sqlite>, order: &Order) -> Result<(), sqlx::Error> {
    let order_params = serde_json::to_string(&order.order_type).unwrap();
    let metadata = serde_json::to_string(&order.metadata).unwrap();
    
    sqlx::query(
        r#"
        INSERT INTO orders (
            id, client_order_id, broker_order_id, symbol, side, quantity,
            order_type, order_params, status, filled_quantity, average_fill_price,
            commission, created_at, updated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            broker_order_id = excluded.broker_order_id,
            status = excluded.status,
            filled_quantity = excluded.filled_quantity,
            average_fill_price = excluded.average_fill_price,
            commission = excluded.commission,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&order.id.to_string())
    .bind(&order.client_order_id)
    .bind(&order.broker_order_id)
    .bind(&order.symbol)
    .bind(format!("{:?}", order.side))
    .bind(order.quantity.to_f64().unwrap())
    .bind("market") // Simplified for now
    .bind(&order_params)
    .bind(format!("{:?}", order.status))
    .bind(order.filled_quantity.to_f64().unwrap())
    .bind(order.average_fill_price.map(|p| p.to_f64().unwrap()))
    .bind(order.commission.map(|c| c.to_f64().unwrap()))
    .bind(order.created_at.timestamp())
    .bind(order.updated_at.timestamp())
    .bind(&metadata)
    .execute(pool)
    .await?;

    Ok(())
}

#[allow(dead_code)]
pub async fn save_order_event(
    pool: &Pool<Sqlite>,
    event: &OrderEvent,
) -> Result<(), sqlx::Error> {
    let event_data = serde_json::to_string(&event.details).unwrap();
    
    sqlx::query(
        r#"
        INSERT INTO order_events (id, order_id, event_type, event_data, created_at)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(&event.id.to_string())
    .bind(&event.order_id.to_string())
    .bind(format!("{:?}", event.event_type))
    .bind(&event_data)
    .bind(event.timestamp.timestamp())
    .execute(pool)
    .await?;

    Ok(())
}

#[allow(dead_code)]
pub async fn get_order_by_id(pool: &Pool<Sqlite>, order_id: &str) -> Result<Option<Order>, sqlx::Error> {
    let _row = sqlx::query_as::<_, (
        String, String, Option<String>, String, String, f64,
        String, String, String, f64, Option<f64>, Option<f64>,
        i64, i64, String,
    )>(
        r#"
        SELECT id, client_order_id, broker_order_id, symbol, side, quantity,
               order_type, order_params, status, filled_quantity, average_fill_price,
               commission, created_at, updated_at, metadata
        FROM orders
        WHERE id = ?
        "#,
    )
    .bind(order_id)
    .fetch_optional(pool)
    .await?;

    // Convert row to Order struct (simplified for now)
    // In production, we'd properly deserialize all fields
    Ok(None)
}

pub async fn get_recent_orders(
    pool: &Pool<Sqlite>,
    limit: i32,
) -> Result<Vec<HashMap<String, serde_json::Value>>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT id, symbol, side, quantity, status, filled_quantity,
               average_fill_price, created_at
        FROM orders
        ORDER BY created_at DESC
        LIMIT ?
        "#,
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let mut orders = Vec::new();
    for row in rows {
        let mut order = HashMap::new();
        order.insert("id".to_string(), serde_json::Value::String(row.get(0)));
        order.insert("symbol".to_string(), serde_json::Value::String(row.get(1)));
        order.insert("side".to_string(), serde_json::Value::String(row.get(2)));
        order.insert("quantity".to_string(), serde_json::Value::Number(
            serde_json::Number::from_f64(row.get(3)).unwrap()
        ));
        order.insert("status".to_string(), serde_json::Value::String(row.get(4)));
        order.insert("filled_quantity".to_string(), serde_json::Value::Number(
            serde_json::Number::from_f64(row.get(5)).unwrap()
        ));
        
        if let Ok(price) = row.try_get::<Option<f64>, _>(6) {
            if let Some(p) = price {
                order.insert("average_fill_price".to_string(), 
                    serde_json::Value::Number(serde_json::Number::from_f64(p).unwrap())
                );
            }
        }
        
        order.insert("created_at".to_string(), serde_json::Value::Number(
            serde_json::Number::from(row.get::<i64, _>(7))
        ));
        
        orders.push(order);
    }

    Ok(orders)
}

#[allow(dead_code)]
pub async fn update_position_summary(
    pool: &Pool<Sqlite>,
    symbol: &str,
    quantity_change: Decimal,
    price: Decimal,
    commission: Decimal,
) -> Result<(), sqlx::Error> {
    // This is a simplified version - in production we'd calculate proper P&L
    sqlx::query(
        r#"
        INSERT INTO position_summary (
            symbol, net_quantity, average_price, realized_pnl,
            unrealized_pnl, total_commission, last_updated
        ) VALUES (?, ?, ?, 0, 0, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            net_quantity = net_quantity + excluded.net_quantity,
            total_commission = total_commission + excluded.total_commission,
            last_updated = excluded.last_updated
        "#,
    )
    .bind(symbol)
    .bind(quantity_change.to_f64().unwrap())
    .bind(price.to_f64().unwrap())
    .bind(commission.to_f64().unwrap())
    .bind(Utc::now().timestamp())
    .execute(pool)
    .await?;

    Ok(())
}