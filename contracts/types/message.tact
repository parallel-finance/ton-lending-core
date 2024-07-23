import "./struct";
import "../jetton/messages";

// TODO: update the message id
message(0x66660001) AddReserve {
    reserveAddress: Address;
    reserveConfiguration: ReserveConfiguration;
    contents: ATokenDTokenContents;
    reserveInterestRateStrategy: ReserveInterestRateStrategy;
}
// TODO: update the message id
message(0x66660002) DropReserve {
    reserveIndex: Int as uint16;
}
// TODO: update the message id
message(0x66660003) BorrowToken {
    tokenAddress: Address;
    amount: Int as coins;
}
message(0x66660004) GetUserAccountData {
    queryId: Int as uint64;
    user: Address;
    // 0: borrow, 1: withdraw, 2: transfer aToken, 3: liquidation
    action: Int as uint8;
    tokenAddress: Address;
    amount: Int as coins;
}
// TODO: update the message id
message(0x66660005) UserAccountDataResponse {
    queryId: Int as uint64;
    user: Address;
    // 0: borrow, 1: withdraw, 2: transfer aToken, 3: liquidation
    action: Int as uint8;
    tokenAddress: Address;
    amount: Int as coins;
    accountData: UserAccountData;
}
// TODO: update the message id
message(0x66660006) WithdrawToken {
    tokenAddress: Address;
    amount: Int as coins;
}
message UpdatePosition {
    queryId: Int as uint64;
    address: Address;
    supply: Int as int128;
    borrow: Int as int128;
}
message UserPositionUpdated {
    queryId: Int as uint64;
    user: Address;
    asset: Address;
    supply: Int as int128;
    borrow: Int as int128;
}
// Notice: Only for Test
message SetMockOraclePrice {
    asset: Address;
    price: Int as uint128;
}
message RerunBounceMsg {
    queryId: Int as uint64;
    action: Int as uint8;
}
message UpdatePositionBounce {
    to: Address;
    user: Address;
    msg: UpdatePosition;
}
message MintBounce {
    to: Address;
    user: Address;
    msg: Mint;
}
message TokenTransferBounce {
    to: Address;
    user: Address;
    msg: TokenTransfer;
}
message TokenBurnBounce {
    to: Address;
    user: Address;
    msg: TokenBurn;
}
