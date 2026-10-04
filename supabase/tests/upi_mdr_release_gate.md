# Release gate

Release requires: migrations apply cleanly; SQL boundary assertions pass; provider/server metadata wiring is trusted; actual fee precedence is verified; customer payable does not change; settlement deduction is visible exactly once.
