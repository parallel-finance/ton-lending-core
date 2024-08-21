message(0x2daf1323) ClaimTargetJetton {
    jettonAddress: Address;
    owner: Address;
    amount: Int as coins;
}

message(0x8aed76c1) ConfigureJettonMapping {
    originJettonAddress: Address;
    claimableJettonAddress: Address;
    claimHelper: Address;
}

message(0x5891a820) DropJettonMapping {
    originJettonAddress: Address;
}

message(0x4b6be393) ResetJettonWalletAddress {
    newAddress: Address
}