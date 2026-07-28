# SignalLottery Bot — Bot specification

**Archetype:** custom

**Voice:** professional and playful — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot that rewards cryptocurrency traders with lottery entries when their devices detect specified real-world radio signals. Auto-credits entries, manages weekly draws, and tracks manual crypto payouts.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- cryptocurrency traders
- location-based reward enthusiasts

## Success criteria

- Users receive lottery entries when valid radio signals are detected
- Weekly draws with winner notifications and manual payout tracking
- Privacy-first opt-in system with detection transparency

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with opt-in and balance checks
- **Pause Credits** (button, actor: user, callback: pause:start) — Temporarily disable automatic ticket allocation
- **View Balance** (button, actor: user, callback: balance:show) — Display current lottery ticket balance
- **Upcoming Draws** (button, actor: user, callback: draws:upcoming) — List scheduled lottery events

## Flows

### Signal Detection Flow
_Trigger:_ device detection event

1. Verify signal matches monitored list
2. Check anti-fraud rules (rate limits, dedupe)
3. Generate lottery ticket
4. Send confirmation message

_Data touched:_ Detection Record, Lottery Ticket

### Draw Management Flow
_Trigger:_ scheduled draw time

1. Select winner from active tickets
2. Notify winner via private message
3. Post draw summary to all participants

_Data touched:_ Draw, Lottery Ticket

### Payout Management Flow
_Trigger:_ /payout command by admin

1. Mark winner as paid
2. Record transaction details
3. Send confirmation to admin

_Data touched:_ Draw, Lottery Ticket

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User** _(retention: persistent)_ — Telegram account with opt-in status and privacy preferences
  - fields: telegram_id, location_opt_in, last_active
- **Radio Signal Event** _(retention: persistent)_ — Monitored radio signal parameters
  - fields: signal_id, frequency, geo_radius, time_window
- **Detection Record** _(retention: session)_ — Verified signal detection by user device
  - fields: user_id, signal_id, timestamp, device_metadata
- **Lottery Ticket** _(retention: persistent)_ — Entry into a scheduled draw
  - fields: entry_id, user_id, draw_id, source_detection_id
- **Draw** _(retention: persistent)_ — Scheduled lottery with prize and winner data
  - fields: draw_id, prize, scheduled_time, winner_id, payout_status

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Add new radio signals to monitor
- Schedule and configure lottery draws
- Update payout status for winners

## Notifications

- Ticket issued confirmation
- Upcoming draw reminders
- Winner notification with prize details
- Draw summary for non-winners

## Permissions & privacy

- Location access requires explicit opt-in
- Detection data stored only for dispute resolution window
- Users can pause credits at any time

## Edge cases

- Duplicate detection reports from same device
- Draw occurs with no valid entries
- Manual payout status updates by admin

## Required tests

- End-to-end detection-to-draw flow with winner notification
- Anti-fraud dedupe rules enforcement
- Payout status update workflow

## Assumptions

- Initial 5 pre-configured signals for launch
- Weekly draw cadence with fixed prize schedule
- Manual crypto transfers handled outside bot
