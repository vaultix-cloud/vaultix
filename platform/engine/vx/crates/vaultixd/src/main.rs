//! `vaultixd`: the Vaultix core. One process, one Postgres, no cache and no queue service.
//!
//! Environment:
//!   VX_DATABASE_URL     required, a Postgres URL
//!   VX_LISTEN           default 127.0.0.1:8210
//!   VX_ROOT_KEY_FILE    a file holding the root key as hex or as the recovery key; without it the
//!                       instance starts sealed
//!   VX_BOOTSTRAP_TOKEN  guards the operate routes until the identity domain lands; without it they answer 503

mod app;
mod secrets;

use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

/// `vaultixd init --key-file PATH`: create the root key file. The key is written to the file and is
/// never printed, so it cannot end up in a terminal log, a chat or a screenshot. Keep an offline copy.
fn init(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Write;
    let path = match args {
        [flag, path] if flag == "--key-file" => path,
        _ => return Err("usage: vaultixd init --key-file PATH".into()),
    };
    let root = vx_keys::Keyring::generate_root();
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|_| "the key file already exists or cannot be created; it is never overwritten")?;
    writeln!(file, "{}", vx_keys::recovery_string(&root))?;
    #[allow(clippy::print_stdout)] // a one-time instruction to the person running init
    {
        println!("Wrote the root key to {path}. It is not shown here. Keep an offline copy: without it the secrets cannot be recovered.");
    }
    Ok(())
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("init") {
        if let Err(error) = init(&args[1..]) {
            #[allow(clippy::print_stderr)]
            {
                eprintln!("vaultixd init: {error}");
            }
            std::process::exit(1);
        }
        return;
    }
    tracing_subscriber::fmt().json().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    if let Err(error) = run().await {
        tracing::error!(%error, "vaultixd stopped");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let url = std::env::var("VX_DATABASE_URL").map_err(|_| "VX_DATABASE_URL is required")?;
    let listen = std::env::var("VX_LISTEN").unwrap_or_else(|_| "127.0.0.1:8210".into());
    let pool = vx_store::open(&url, 8).await?;
    let applied = vx_store::migrate(&pool).await?;
    tracing::info!(?applied, "store ready");

    let keyring = match std::env::var("VX_ROOT_KEY_FILE") {
        Ok(path) => Some(Arc::new(app::load_keyring(&path)?)),
        Err(_) => None,
    };
    tracing::info!(sealed = keyring.is_none(), "key state");

    let stop = CancellationToken::new();
    vx_jobs::register(
        &pool,
        &vx_jobs::Schedule {
            name: "operate.prune".into(),
            kind: "operate.prune".into(),
            spec: "30 3 * * *".into(),
            description: "Remove finished jobs older than 7 days and run history older than 30 days".into(),
        },
    )
    .await?;
    let mut worker = vx_jobs::Worker::new(pool.clone(), vx_jobs::Config::new());
    let prune_pool = pool.clone();
    worker.handle("operate.prune", move |_job, _cancel| {
        let pool = prune_pool.clone();
        async move {
            vx_jobs::prune(&pool, Duration::from_secs(7 * 86_400), Duration::from_secs(30 * 86_400))
                .await
                .map(|_| ())
                .map_err(|error| vx_jobs::JobError::Retry(error.to_string()))
        }
    });
    let worker_task = tokio::spawn({
        let stop = stop.clone();
        async move { worker.run(stop).await }
    });

    let state = app::Inner::new(pool, keyring, std::env::var("VX_BOOTSTRAP_TOKEN").ok());
    let listener = tokio::net::TcpListener::bind(&listen).await?;
    tracing::info!(%listen, "listening");
    axum::serve(listener, app::router(state))
        .with_graceful_shutdown({
            let stop = stop.clone();
            async move {
                let _ = tokio::signal::ctrl_c().await;
                stop.cancel();
            }
        })
        .await?;
    stop.cancel();
    worker_task.await??;
    Ok(())
}
