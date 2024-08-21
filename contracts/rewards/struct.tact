struct ClaimableJettonConfiguration {
    claimHelper: Address;
    jettonWalletAddress: Address;
    jettonActionType: Int;
    // - 0: Claim via transfer
    // - 1; Claim via time vesting
}