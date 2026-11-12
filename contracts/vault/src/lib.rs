//! SkyPay company operating vault (native NEAR, NEP-141 USDC).
//!
//! The company owner funds the vault and sets policy. An agent account may only
//! call `pay`, and the contract itself enforces: live agent, allow-listed payee,
//! per-payment and daily limits, expiry, and replay protection by payment id.
//! The backend is NOT trusted: every rule below is checked on-chain.
use near_sdk::json_types::U128;
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    env, ext_contract, near, require, serde_json::json, AccountId, Gas, NearToken, PanicOnDefault,
    PromiseOrValue, PromiseResult,
};

const DAY_MS: u64 = 86_400_000;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const GAS_TRANSFER: Gas = Gas::from_tgas(30);
const GAS_CALLBACK: Gas = Gas::from_tgas(20);

#[ext_contract(ext_ft)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[ext_contract(ext_self)]
trait SelfCallbacks {
    fn on_paid(&mut self, payment_id: String);
    fn on_withdrawn(&mut self, amount: U128);
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PaymentStatus {
    /// Funds and daily budget are reserved; transfer outcome not yet known.
    Reserved,
    Settled,
    /// Transfer definitively failed; reservation released exactly once.
    Failed,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Agent {
    pub per_tx_limit: U128,
    pub daily_limit: U128,
    /// Unix ms; agent is refused after this instant.
    pub expires_at_ms: u64,
    pub revoked: bool,
    /// Day index (block time / 24h) that `spent_today` belongs to.
    pub day: u64,
    /// Reserved + settled spend for `day`.
    pub spent_today: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Payment {
    /// sha256 over the canonical payload; binds id to recipient/amount/ref/expiry.
    pub request_hash: String,
    pub agent: AccountId,
    pub recipient: AccountId,
    pub amount: U128,
    pub invoice_ref: String,
    pub status: PaymentStatus,
    pub day: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    token: AccountId,
    available: u128,
    reserved: u128,
    agents: LookupMap<AccountId, Agent>,
    payees: LookupSet<AccountId>,
    payments: LookupMap<String, Payment>,
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "skypay_vault", "version": "1.0.0", "event": event, "data": data})
    ));
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[near]
impl Vault {
    #[init]
    pub fn new(owner: AccountId, token: AccountId) -> Self {
        Self {
            owner,
            token,
            available: 0,
            reserved: 0,
            agents: LookupMap::new(b"a"),
            payees: LookupSet::new(b"p"),
            payments: LookupMap::new(b"m"),
        }
    }

    // ---------------------------------------------------------------- funding

    /// NEP-141 receiver hook. Only the pinned token, only from the owner, only msg "fund".
    /// Anything else is refunded in full (returned as unused amount).
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.token || sender_id != self.owner || msg != "fund" {
            return PromiseOrValue::Value(amount);
        }
        self.available += amount.0;
        emit("fund", json!({"amount": amount.0.to_string()}));
        PromiseOrValue::Value(U128(0))
    }

    // ------------------------------------------------------------ owner policy

    pub fn set_agent(&mut self, agent: AccountId, per_tx_limit: U128, daily_limit: U128, expires_at_ms: u64) {
        self.assert_owner();
        require!(per_tx_limit.0 <= daily_limit.0, "per_tx_limit exceeds daily_limit");
        let (day, spent) = self
            .agents
            .get(&agent)
            .map(|a| (a.day, a.spent_today))
            .unwrap_or((Self::today(), U128(0)));
        self.agents.insert(
            agent.clone(),
            Agent { per_tx_limit, daily_limit, expires_at_ms, revoked: false, day, spent_today: spent },
        );
        emit("set_agent", json!({"agent": agent, "per_tx_limit": per_tx_limit.0.to_string(),
            "daily_limit": daily_limit.0.to_string(), "expires_at_ms": expires_at_ms}));
    }

    pub fn revoke_agent(&mut self, agent: AccountId) {
        self.assert_owner();
        let mut a = self.agents.get(&agent).cloned().unwrap_or_else(|| env::panic_str("unknown agent"));
        a.revoked = true;
        self.agents.insert(agent.clone(), a);
        emit("revoke_agent", json!({"agent": agent}));
    }

    pub fn add_payee(&mut self, payee: AccountId) {
        self.assert_owner();
        self.payees.insert(payee.clone());
        emit("add_payee", json!({"payee": payee}));
    }

    pub fn remove_payee(&mut self, payee: AccountId) {
        self.assert_owner();
        self.payees.remove(&payee);
        emit("remove_payee", json!({"payee": payee}));
    }

    /// Owner pulls unreserved funds back to the owner account.
    pub fn withdraw(&mut self, amount: U128) -> near_sdk::Promise {
        self.assert_owner();
        require!(amount.0 > 0 && amount.0 <= self.available, "amount exceeds available balance");
        self.available -= amount.0;
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_TRANSFER)
            .ft_transfer(self.owner.clone(), amount, Some("skypay withdraw".into()))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_withdrawn(amount))
    }

    // ------------------------------------------------------------- agent spend

    /// Agent-only, zero deposit. Idempotent by `payment_id`.
    pub fn pay(
        &mut self,
        payment_id: String,
        recipient: AccountId,
        amount: U128,
        invoice_ref: String,
        expires_at_ms: u64,
    ) -> PromiseOrValue<PaymentStatus> {
        require!(env::attached_deposit().is_zero(), "no deposit allowed");
        let agent_id = env::predecessor_account_id();
        let hash = self.request_hash(&agent_id, &recipient, amount.0, &invoice_ref, expires_at_ms);

        // Replay protection: same id + same payload returns the existing outcome; changed payload panics.
        if let Some(existing) = self.payments.get(&payment_id) {
            require!(existing.request_hash == hash && existing.agent == agent_id, "payment_id reused with different payload");
            return PromiseOrValue::Value(existing.status);
        }

        let now = env::block_timestamp_ms();
        let mut agent = self.agents.get(&agent_id).cloned().unwrap_or_else(|| env::panic_str("caller is not an agent"));
        require!(!agent.revoked, "agent revoked");
        require!(now <= agent.expires_at_ms, "agent expired");
        require!(now <= expires_at_ms, "payment request expired");
        require!(self.payees.contains(&recipient), "recipient not allow-listed");
        require!(amount.0 > 0, "amount must be positive");
        require!(amount.0 <= agent.per_tx_limit.0, "exceeds per-payment limit");

        let today = now / DAY_MS;
        if agent.day != today {
            agent.day = today;
            agent.spent_today = U128(0);
        }
        let new_spent = agent.spent_today.0.checked_add(amount.0).unwrap_or_else(|| env::panic_str("overflow"));
        require!(new_spent <= agent.daily_limit.0, "exceeds daily limit");
        require!(amount.0 <= self.available, "insufficient vault balance");

        // Reserve before dispatch so concurrent requests cannot oversubscribe.
        agent.spent_today = U128(new_spent);
        self.agents.insert(agent_id.clone(), agent);
        self.available -= amount.0;
        self.reserved += amount.0;
        self.payments.insert(
            payment_id.clone(),
            Payment {
                request_hash: hash,
                agent: agent_id.clone(),
                recipient: recipient.clone(),
                amount,
                invoice_ref: invoice_ref.clone(),
                status: PaymentStatus::Reserved,
                day: today,
            },
        );
        emit("pay_reserved", json!({"payment_id": payment_id, "agent": agent_id, "recipient": recipient,
            "amount": amount.0.to_string(), "invoice_ref": invoice_ref}));

        PromiseOrValue::Promise(
            ext_ft::ext(self.token.clone())
                .with_attached_deposit(ONE_YOCTO) // vault supplies the 1 yocto; agent key attaches none
                .with_static_gas(GAS_TRANSFER)
                .ft_transfer(recipient, amount, Some(payment_id.clone()))
                .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_paid(payment_id)),
        )
    }

    // -------------------------------------------------------------- callbacks

    #[private]
    pub fn on_paid(&mut self, payment_id: String) -> PaymentStatus {
        let mut p = self.payments.get(&payment_id).cloned().unwrap_or_else(|| env::panic_str("unknown payment"));
        // Idempotent: only a Reserved payment can transition, so a reservation is released at most once.
        if p.status != PaymentStatus::Reserved {
            return p.status;
        }
        self.reserved -= p.amount.0;
        if matches!(env::promise_result(0), PromiseResult::Successful(_)) {
            p.status = PaymentStatus::Settled;
            emit("pay_settled", json!({"payment_id": payment_id}));
        } else {
            p.status = PaymentStatus::Failed;
            self.available += p.amount.0;
            if let Some(mut a) = self.agents.get(&p.agent).cloned() {
                if a.day == p.day {
                    a.spent_today = U128(a.spent_today.0.saturating_sub(p.amount.0));
                    self.agents.insert(p.agent.clone(), a);
                }
            }
            emit("pay_failed", json!({"payment_id": payment_id}));
        }
        self.payments.insert(payment_id, p.clone());
        p.status
    }

    #[private]
    pub fn on_withdrawn(&mut self, amount: U128) {
        if matches!(env::promise_result(0), PromiseResult::Successful(_)) {
            emit("withdraw", json!({"amount": amount.0.to_string()}));
        } else {
            self.available += amount.0; // transfer failed: funds stay in the vault
            emit("withdraw_failed", json!({"amount": amount.0.to_string()}));
        }
    }

    // ------------------------------------------------------------------ views

    pub fn get_state(&self) -> near_sdk::serde_json::Value {
        json!({"owner": self.owner, "token": self.token,
               "available": self.available.to_string(), "reserved": self.reserved.to_string()})
    }
    pub fn get_agent(&self, agent: AccountId) -> Option<Agent> {
        self.agents.get(&agent).cloned()
    }
    pub fn get_payment(&self, payment_id: String) -> Option<Payment> {
        self.payments.get(&payment_id).cloned()
    }
    pub fn is_payee(&self, payee: AccountId) -> bool {
        self.payees.contains(&payee)
    }

    // --------------------------------------------------------------- internal

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }
    fn today() -> u64 {
        env::block_timestamp_ms() / DAY_MS
    }
    fn request_hash(&self, agent: &AccountId, recipient: &AccountId, amount: u128, invoice_ref: &str, expires_at_ms: u64) -> String {
        let canonical = format!("{}|{}|{}|{}|{}|{}|{}", env::current_account_id(), self.token, agent, recipient, amount, invoice_ref, expires_at_ms);
        hex(&env::sha256(canonical.as_bytes()))
    }
}

#[cfg(test)]
mod tests;
