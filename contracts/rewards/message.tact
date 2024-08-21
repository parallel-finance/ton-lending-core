message(0x2daf1323) ClaimTargetJetton {
    jettonAddress: Address;
    owner: Address;
    amount: Int as coins;
}

message(0x8aed76c1) ConfigureClaimableConfiguration {
    originJettonAddress: Address;
    jettonWalletAddress: Address;
    targetBeneficiary: Address;
    claimType: Int;
    claimHelper: Address;
}

message(0x5891a820) DropJettonMapping {
    originJettonAddress: Address;
}

message(0x4b6be393) SetJettonWalletAddress {
    newAddress: Address
}