# onePOS Server

Backend runtime boundary.

- `server.js` - Express bootstrap.
- `routes/` - HTTP adapters.
- `services/` - authoritative domain/platform services.
- `utils/` - backend utilities.

Root-level `server.js`, `routes`, `services`, and `utils` are compatibility symlinks during the structure-only migration so existing imports and tests continue to work without business-logic rewrites.
