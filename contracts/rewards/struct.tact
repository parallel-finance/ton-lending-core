struct ClaimableConfiguration {
    claimHelper: Address;
    jettonWalletAddress: Address;
    targetBeneficiary: Address;
    claimType: Int;
    // - 0: Claim via transfer
    // - 1; Claim via time vesting
}