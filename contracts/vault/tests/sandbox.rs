//! Sandbox integration test: real NEP-141 contract, real cross-contract calls and callbacks.
//! No backend involved, so this is the direct-contract evidence for A08-A14, A25, A26.
//! Build wasm first:  cargo build --release --target wasm32-unknown-unknown
use near_workspaces::{network::Sandbox, types::NearToken, Account, Contract, Worker};
use serde_json::json;

const UNIT: u128 = 1_000_000; // 1 tUSDC (6 decimals)

fn wasm(name: &str) -> Vec<u8> {
    let p = format!("{}/../target/wasm32-unknown-unknown/release/{}.wasm", env!("CARGO_MANIFEST_DIR"), name);
    std::fs::read(&p).unwrap_or_else(|_| panic!("build wasm first, missing {p}"))
}

async fn balance(token: &Contract, who: &Account) -> u128 {
    token.view("ft_balance_of").args_json(json!({"account_id": who.id()})).await.unwrap().json::<String>().unwrap().parse().unwrap()
}

async fn register(token: &Contract, who: &Account) {
    token.call("storage_deposit").args_json(json!({"account_id": who.id()}))
        .deposit(NearToken::from_millinear(20)).transact().await.unwrap().into_result().unwrap();
}

async fn state(vault: &Contract) -> (u128, u128) {
    let s = vault.view("get_state").await.unwrap().json::<serde_json::Value>().unwrap();
    (s["available"].as_str().unwrap().parse().unwrap(), s["reserved"].as_str().unwrap().parse().unwrap())
}

async fn agent_pay(agent: &Account, vault: &Contract, id: &str, to: &Account, amount: u128, expires: u64) -> near_workspaces::result::ExecutionFinalResult {
    agent.call(vault.id(), "pay")
        .args_json(json!({"payment_id": id, "recipient": to.id(), "amount": amount.to_string(),
                          "invoice_ref": "INV-1", "expires_at_ms": expires}))
        .max_gas().transact().await.unwrap()
}

#[tokio::test]
async fn full_vault_scenario_in_sandbox() -> anyhow::Result<()> {
    let worker: Worker<Sandbox> = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let mk = |n: &'static str| {
        let root = root.clone();
        async move { root.create_subaccount(n).initial_balance(NearToken::from_near(20)).transact().await.unwrap().into_result().unwrap() }
    };
    let (owner, agent, bob, carol, mallory) = (mk("owner").await, mk("agent").await, mk("bob").await, mk("carol").await, mk("mallory").await);

    let token = worker.dev_deploy(&wasm("skypay_test_ft")).await?;
    token.call("new").transact().await?.into_result()?;
    let vault = worker.dev_deploy(&wasm("skypay_vault")).await?;
    vault.call("new").args_json(json!({"owner": owner.id(), "token": token.id()})).transact().await?.into_result()?;

    for a in [&owner, &bob, &mallory] { register(&token, a).await; }
    register(&token, &vault.as_account().clone()).await;
    token.call("mint").args_json(json!({"account_id": owner.id(), "amount": (1000 * UNIT).to_string()})).transact().await?.into_result()?;

    // --- owner policy (A25) ---
    owner.call(vault.id(), "add_payee").args_json(json!({"payee": bob.id()})).transact().await?.into_result()?;
    owner.call(vault.id(), "add_payee").args_json(json!({"payee": carol.id()})).transact().await?.into_result()?; // carol NOT registered on token
    let far_future: u64 = 4_000_000_000_000;
    owner.call(vault.id(), "set_agent")
        .args_json(json!({"agent": agent.id(), "per_tx_limit": (100 * UNIT).to_string(), "daily_limit": (150 * UNIT).to_string(), "expires_at_ms": far_future}))
        .transact().await?.into_result()?;

    // --- funding via ft_transfer_call; wrong sender / wrong token refunded ---
    owner.call(token.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": vault.id(), "amount": (500 * UNIT).to_string(), "msg": "fund"}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert_eq!(state(&vault).await, (500 * UNIT, 0));
    token.call("mint").args_json(json!({"account_id": mallory.id(), "amount": (10 * UNIT).to_string()})).transact().await?.into_result()?;
    mallory.call(token.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": vault.id(), "amount": (10 * UNIT).to_string(), "msg": "fund"}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert_eq!(state(&vault).await, (500 * UNIT, 0), "non-owner deposit must not be credited");
    assert_eq!(balance(&token, &mallory).await, 10 * UNIT, "non-owner deposit refunded");

    // --- A08: permitted payment really moves tokens ---
    let r = agent_pay(&agent, &vault, "pay-1", &bob, 60 * UNIT, far_future).await;
    assert!(r.is_success(), "{:?}", r.failures());
    assert_eq!(r.json::<String>()?, "Settled");
    assert_eq!(balance(&token, &bob).await, 60 * UNIT);
    assert_eq!(state(&vault).await, (440 * UNIT, 0));

    // --- A11: replay of same id does nothing ---
    let r = agent_pay(&agent, &vault, "pay-1", &bob, 60 * UNIT, far_future).await;
    assert!(r.is_success());
    assert_eq!(balance(&token, &bob).await, 60 * UNIT, "replay must not pay twice");

    // --- A12: same id, changed payload, rejected ---
    let r = agent_pay(&agent, &vault, "pay-1", &bob, 61 * UNIT, far_future).await;
    assert!(r.is_failure());

    // --- A09: over per-payment limit, unlisted recipient ---
    assert!(agent_pay(&agent, &vault, "pay-big", &bob, 101 * UNIT, far_future).await.is_failure());
    assert!(agent_pay(&agent, &vault, "pay-mal", &mallory, 1 * UNIT, far_future).await.is_failure());

    // --- A10: daily cap (150): 60 already spent, 90 more ok, 1 more refused ---
    assert_eq!(agent_pay(&agent, &vault, "pay-2", &bob, 90 * UNIT, far_future).await.json::<String>()?, "Settled");
    assert!(agent_pay(&agent, &vault, "pay-3", &bob, 1 * UNIT, far_future).await.is_failure());

    // --- A26: attacker calls the vault directly, bypassing any backend ---
    assert!(agent_pay(&mallory, &vault, "pay-x", &bob, 1 * UNIT, far_future).await.is_failure());
    assert!(mallory.call(vault.id(), "set_agent")
        .args_json(json!({"agent": mallory.id(), "per_tx_limit": "999999999", "daily_limit": "999999999", "expires_at_ms": far_future}))
        .transact().await?.is_failure());
    assert!(mallory.call(vault.id(), "withdraw").args_json(json!({"amount": "1"})).transact().await?.is_failure());

    // --- A14: real token failure (carol not registered on token) releases reservation once ---
    owner.call(vault.id(), "set_agent")
        .args_json(json!({"agent": agent.id(), "per_tx_limit": (100 * UNIT).to_string(), "daily_limit": (1000 * UNIT).to_string(), "expires_at_ms": far_future}))
        .transact().await?.into_result()?;
    let before = state(&vault).await;
    let r = agent_pay(&agent, &vault, "pay-fail", &carol, 5 * UNIT, far_future).await;
    let logs = format!("{:?}", r.logs());
    assert_eq!(r.json::<String>()?, "Failed", "{logs}");
    assert_eq!(state(&vault).await, before, "failed transfer must release the reservation");

    // --- A13: revoked agent refused ---
    owner.call(vault.id(), "revoke_agent").args_json(json!({"agent": agent.id()})).transact().await?.into_result()?;
    assert!(agent_pay(&agent, &vault, "pay-after-revoke", &bob, 1 * UNIT, far_future).await.is_failure());

    // --- A25: owner withdraws available funds ---
    let (avail, _) = state(&vault).await;
    owner.call(vault.id(), "withdraw").args_json(json!({"amount": avail.to_string()})).max_gas().transact().await?.into_result()?;
    assert_eq!(state(&vault).await, (0, 0));
    assert_eq!(balance(&token, &owner).await, 1000 * UNIT - 150 * UNIT);
    Ok(())
}
