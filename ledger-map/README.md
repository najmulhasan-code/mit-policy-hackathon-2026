# Ledger map

A branching map of what happens to a teenager's donated chat log. One line per custodian,
one station per signed event, a curve wherever one event authorises another.

Demo only. The chat data is synthetic and every party, the AI vendor included, is simulated.
The vendor receipt and the canary leak-test result are simulated.

## Run it

    npm install
    npm run dev        # http://localhost:5173
    npm run build      # static site in dist/

Needs Node 20 or newer. No backend.

## What is real and what is simulated

Real, computed in your browser with the Web Crypto API every time a switch changes:
- fingerprints (HMAC-SHA-256, one key per control class)
- dataset roots (Merkle root over the fingerprints)
- event hashes and the chain between them (SHA-256)
- signatures (Ed25519; falls back to ECDSA P-256 on browsers without Ed25519)
- the ledger check under the map, including the failure when you alter an event

Simulated: the parties themselves, the vendor's receipts, the leak-test result, the perceptual
hash of the photo, the deletion of any actual data.

## The three switches

- The export contains: some teen-only items / shared items only
- Withdrawal is fired by: the teen / the parent
- The AI vendor: signs receipts / stays silent

With teen-only items present and the parent firing, the flow branches: an authority check by
class label, the shared items are purged, the teen-only items stay.

## Files

- `src/ledger.ts`    canonical bytes, fingerprints, Merkle root, signed and chained events, verification
- `src/scenario.ts`  the story: which events happen, who signs, what each one authorises
- `src/Map.tsx`      the SVG map
- `src/App.tsx`      switches, playback, detail panel, receipt
- `src/index.css`    styles

## Links for screenshots

- `#end`      opens on the finished map
- `#altered`  opens with event #04 altered, so the check fails
- `#branch`   opens on the parent-withdraws case with a silent vendor

Keys: left and right arrows step through the events.
