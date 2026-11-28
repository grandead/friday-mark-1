# Server technical debt

## Smart home

Each voice tool binds a model command to its schema and formats the result. The command verifies the returned state for every caller.

- [ ] **Browser controls.** Add an HTTP endpoint that selects a model command, validates its arguments and invokes it with the registered credentials. Design the device pages separately, reuse each command’s argument schema and show the state returned by the device.
- [ ] **Hardware verification.** Exercise the refactored entry points on the local network. Read state over miIO and Syncleo, confirm a reversible setting change, and restore its previous value. For Ballu, verify discovery using the registered IPv4 address.
