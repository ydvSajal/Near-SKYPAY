//! Unit tests with a mocked NEAR environment. They call the contract directly,
//! with no backend involved (acceptance A09-A14, A25, A26 at logic level).
//! Sandbox integration tests live in `tests/sandbox.rs`.
use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(pred: &str, ts_ms: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("vault.test"))
        .predecessor_account_id(acc(pred))
        .signer_account_id(acc(pred))
        .block_timestamp(ts_ms * 1_000_000);
    b
}

const T0: u64 = 1_800_000_000_000; // fixed "now"
const HOUR: u64 = 3_600_000;

/// Vault funded with 1_000 units, agent limits 500/tx and 1000/day, payee bob.
fn setup() -> Vault {
    testing_env!(ctx("owner.test", T0).build());
    let mut v = Vault::new(acc("owner.test"), acc("usdc.test"));
    v.add_payee(acc("bob.test"));
    v.set_agent(acc("agent.test"), U128(500), U128(1000), T0 + 24 * HOUR);
    testing_env!(ctx("usdc.test", T0).build());
    let r = v.ft_on_transfer(acc("owner.test"), U128(1000), "fund".into());
    assert!(matches!(r, PromiseOrValue::Value(U128(0))));
    v
}

fn pay(v: &mut Vault, id: &str, amount: u128, ts: u64) -> PromiseOrValue<PaymentStatus> {
    testing_env!(ctx("agent.test", ts).build());
    v.pay(id.into(), acc("bob.test"), U128(amount), "INV-1".into(), ts + HOUR)
}

fn callback(v: &mut Vault, id: &str, ok: bool) -> PaymentStatus {
    let res = if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
    testing_env!(ctx("vault.test", T0).build(), test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![res]);
    v.on_paid(id.into())
}

fn bal(v: &Vault) -> (u128, u128) {
    (v.available, v.reserved)
}

#[test]
fn a08_allowed_payment_reserves_then_settles() {
    let mut v = setup();
    assert!(matches!(pay(&mut v, "p1", 400, T0), PromiseOrValue::Promise(_)));
    assert_eq!(bal(&v), (600, 400));
    assert_eq!(callback(&mut v, "p1", true), PaymentStatus::Settled);
    assert_eq!(bal(&v), (600, 0));
}

#[test]
#[should_panic(expected = "invoice_ref longer than 64 bytes")]
fn oversized_reference_refused() {
    let mut v = setup();
    testing_env!(ctx("agent.test", T0).build());
    v.pay("p1".into(), acc("bob.test"), U128(10), "x".repeat(65), T0 + HOUR);
}

#[test]
#[should_panic(expected = "payment_id must be 1-64 bytes")]
fn oversized_payment_id_refused() {
    let mut v = setup();
    pay(&mut v, &"p".repeat(65), 10, T0);
}

#[test]
#[should_panic(expected = "vault storage reserve low")]
fn payment_refused_when_storage_reserve_is_exhausted() {
    let mut v = setup();
    let mut c = ctx("agent.test", T0);
    c.account_balance(NearToken::from_yoctonear(0));
    testing_env!(c.build());
    v.pay("p1".into(), acc("bob.test"), U128(10), "INV-1".into(), T0 + HOUR);
}

#[test]
#[should_panic(expected = "exceeds per-payment limit")]
fn a09_over_per_payment_limit_refused() {
    let mut v = setup();
    pay(&mut v, "p1", 501, T0);
}

#[test]
#[should_panic(expected = "recipient not allow-listed")]
fn a09_unlisted_recipient_refused() {
    let mut v = setup();
    testing_env!(ctx("agent.test", T0).build());
    v.pay("p1".into(), acc("mallory.test"), U128(10), "INV-1".into(), T0 + HOUR);
}

#[test]
#[should_panic(expected = "exceeds daily limit")]
fn a10_second_request_cannot_exceed_daily_cap() {
    let mut v = setup();
    pay(&mut v, "p1", 500, T0);
    pay(&mut v, "p2", 400, T0);
    pay(&mut v, "p3", 101, T0); // 500+400+101 > 1000 while p1/p2 still unresolved
}

#[test]
fn a10_daily_budget_resets_next_day() {
    let mut v = setup();
    pay(&mut v, "p1", 500, T0);
    pay(&mut v, "p2", 500, T0);
    callback(&mut v, "p1", true);
    callback(&mut v, "p2", true);
    // vault now has 0 available; refund it then pay on the next day
    testing_env!(ctx("usdc.test", T0).build());
    v.ft_on_transfer(acc("owner.test"), U128(500), "fund".into());
    assert!(matches!(pay(&mut v, "p3", 500, T0 + 20 * HOUR), PromiseOrValue::Promise(_)));
}

#[test]
fn a11_same_id_same_payload_does_not_double_spend() {
    let mut v = setup();
    pay(&mut v, "p1", 300, T0);
    let before = bal(&v);
    match pay(&mut v, "p1", 300, T0) {
        PromiseOrValue::Value(s) => assert_eq!(s, PaymentStatus::Reserved),
        _ => panic!("replay must not dispatch a second transfer"),
    }
    assert_eq!(bal(&v), before);
}

#[test]
#[should_panic(expected = "payment_id reused with different payload")]
fn a12_same_id_changed_payload_rejected() {
    let mut v = setup();
    pay(&mut v, "p1", 300, T0);
    pay(&mut v, "p1", 301, T0);
}

#[test]
#[should_panic(expected = "agent revoked")]
fn a13_revoked_agent_refused_even_for_prepared_request() {
    let mut v = setup();
    testing_env!(ctx("owner.test", T0).build());
    v.revoke_agent(acc("agent.test"));
    pay(&mut v, "p1", 10, T0);
}

#[test]
#[should_panic(expected = "agent expired")]
fn a13_expired_agent_refused() {
    let mut v = setup();
    pay(&mut v, "p1", 10, T0 + 25 * HOUR);
}

#[test]
#[should_panic(expected = "payment request expired")]
fn expired_payment_request_refused() {
    let mut v = setup();
    testing_env!(ctx("agent.test", T0 + 2 * HOUR).build());
    v.pay("p1".into(), acc("bob.test"), U128(10), "INV-1".into(), T0 + HOUR);
}

#[test]
fn a14_failed_transfer_releases_reservation_exactly_once() {
    let mut v = setup();
    pay(&mut v, "p1", 400, T0);
    assert_eq!(callback(&mut v, "p1", false), PaymentStatus::Failed);
    assert_eq!(bal(&v), (1000, 0));
    // duplicate callback must not release again
    assert_eq!(callback(&mut v, "p1", false), PaymentStatus::Failed);
    assert_eq!(bal(&v), (1000, 0));
    // failed spend also frees the daily budget
    assert!(matches!(pay(&mut v, "p2", 500, T0), PromiseOrValue::Promise(_)));
    assert!(matches!(pay(&mut v, "p3", 500, T0), PromiseOrValue::Promise(_)));
}

#[test]
fn a14_success_callback_cannot_be_replayed_to_credit_twice() {
    let mut v = setup();
    pay(&mut v, "p1", 400, T0);
    callback(&mut v, "p1", true);
    callback(&mut v, "p1", false); // late/contradictory callback ignored
    assert_eq!(bal(&v), (600, 0));
    assert_eq!(v.get_payment("p1".into()).unwrap().status, PaymentStatus::Settled);
}

#[test]
#[should_panic(expected = "caller is not an agent")]
fn a26_random_account_cannot_spend() {
    let mut v = setup();
    testing_env!(ctx("attacker.test", T0).build());
    v.pay("p1".into(), acc("bob.test"), U128(10), "x".into(), T0 + HOUR);
}

#[test]
#[should_panic(expected = "owner only")]
fn a26_non_owner_cannot_set_agent() {
    let mut v = setup();
    testing_env!(ctx("attacker.test", T0).build());
    v.set_agent(acc("attacker.test"), U128(1_000_000), U128(1_000_000), T0 + HOUR);
}

#[test]
#[should_panic(expected = "owner only")]
fn a26_agent_cannot_edit_its_own_limits() {
    let mut v = setup();
    testing_env!(ctx("agent.test", T0).build());
    v.set_agent(acc("agent.test"), U128(9_999), U128(9_999), T0 + HOUR);
}

#[test]
#[should_panic(expected = "no deposit allowed")]
fn pay_rejects_attached_deposit() {
    let mut v = setup();
    let mut c = ctx("agent.test", T0);
    c.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(c.build());
    v.pay("p1".into(), acc("bob.test"), U128(10), "x".into(), T0 + HOUR);
}

#[test]
fn funding_from_wrong_token_or_wrong_sender_is_refunded() {
    let mut v = setup();
    testing_env!(ctx("fake-usdc.test", T0).build());
    let r = v.ft_on_transfer(acc("owner.test"), U128(77), "fund".into());
    assert!(matches!(r, PromiseOrValue::Value(U128(77))));
    testing_env!(ctx("usdc.test", T0).build());
    let r = v.ft_on_transfer(acc("stranger.test"), U128(77), "fund".into());
    assert!(matches!(r, PromiseOrValue::Value(U128(77))));
    let r = v.ft_on_transfer(acc("owner.test"), U128(77), "other".into());
    assert!(matches!(r, PromiseOrValue::Value(U128(77))));
    assert_eq!(bal(&v), (1000, 0));
}

#[test]
fn a25_owner_withdraws_only_available_funds() {
    let mut v = setup();
    pay(&mut v, "p1", 400, T0); // 400 reserved, 600 available
    testing_env!(ctx("owner.test", T0).build());
    let _ = v.withdraw(U128(600));
    assert_eq!(bal(&v), (0, 400));
}

#[test]
#[should_panic(expected = "amount exceeds available balance")]
fn a25_withdraw_cannot_touch_reserved_funds() {
    let mut v = setup();
    pay(&mut v, "p1", 400, T0);
    testing_env!(ctx("owner.test", T0).build());
    let _ = v.withdraw(U128(601));
}
