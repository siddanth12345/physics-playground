# Boss Fight Combat Update

## Build
- Make blue tables spawn beside the boss, move at 1.5× normal speed, deal 2 damage, and vanish on contact.
- Add two weakened normal ranged tables every 10 seconds during the boss fight; each has 5 HP and fires half-speed shots.
- Replace the sword circle with a vertical light beam and remove the quarter-room overlay while keeping its floor attack.
- Add a telegraphed boss stomp: lock aim, lean back for one second, then launch a boss-sized plate straight ahead.
- Alternate sword and stomp attacks with one second of recovery; quarter attacks and table spawns remain independent.
- Increase the magazine to 40.
- Enlarge the minimap to approximately the pause-panel size and ensure furniture and all table markers update clearly.
- Replace the victory illustration with a live 3D green table on the left and a results chart on the right, following the supplied reference.

## Technical details
- Extend pooled boss-fight entities and hazards rather than adding per-frame React state.
- Keep movement and attack timing delta-based, with continuous plate collision to prevent tunneling.
- Preserve the current pause, restart, boss health, and statistics behavior.

## Verify
- Check the latest build diagnostics.
- Open the game at desktop and mobile sizes, confirm the menu and minimap render, and inspect the victory layout through a controlled test state.
