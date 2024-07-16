import "./struct";
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
    borrower: Address;
    // 0: borrow, 1: withdraw, 2: transfer aToken, 3: liquidation
    action: Int as uint8;
    tokenAddress: Address;
    amount: Int as coins;
}
// TODO: update the message id
message(0x66660004) UserAccountDataResponse {
    queryId: Int as uint64;
    borrower: Address;
    // 0: borrow, 1: withdraw, 2: transfer aToken, 3: liquidation
    action: Int as uint8;
    tokenAddress: Address;
    amount: Int as coins;
    accountData: UserAccountData;
}
message UpdatePosition {
    queryId: Int as uint64;
    address: Address;
    supply: Int as int128;
    borrow: Int as int128;
}
message UserPositionUpdated {
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