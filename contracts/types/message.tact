import "./struct";
import "../jetton/messages";
// TODO: update the all of the message ids
message(0x66660001) AddReserve {
    reserveAddress: Address;
    reserveConfiguration: ReserveConfiguration;
    contents: ATokenDTokenContents;
    reserveInterestRateStrategy: ReserveInterestRateStrategy;
}
message(0x66660002) DropReserve {
    reserveIndex: Int as uint16;
}
// gas cost: 0.01
message(0x66660003) BorrowToken {
    tokenAddress: Address;
    amount: Int as coins;
}
// gas cost: 0.006
message(0x66660004) GetUserAccountData {
    queryId: Int as uint64;
    user: Address;
    // 0: borrow, 1: withdraw, 2: transfer aToken, 3: liquidation
    action: Int as uint8;
    tokenAddress: Address;
    amount: Int;
    payload: Slice as remaining;
}
// gas cost:
//      borrow: 0.027
message(0x66660005) UserAccountDataResponse {
    queryId: Int as uint64;
    user: Address;
    // 0: borrow, 1: withdraw, 2: transfer aToken, 3: liquidation
    action: Int as uint8;
    tokenAddress: Address;
    amount: Int;
    accountData: UserAccountData;
    payload: Slice as remaining;
}
//
message(0x66660006) WithdrawToken {
    tokenAddress: Address;
    amount: Int;
}
// gas cost: 0.006
message(0x66660007) UpdatePosition {
    queryId: Int as uint64;
    address: Address;
    supply: Int as int128;
    borrow: Int as int128;
    releaseUserLock: Bool;
}
// gas cost:
//      supply: 0.011
// .    borrow: 0.009
message(0x66660008) UserPositionUpdated {
    queryId: Int as uint64;
    user: Address;
    asset: Address;
    supply: Int as int128;
    borrow: Int as int128;
    releaseUserLock: Bool;
}
message(0x66660009) SupplyTon {
    amount: Int as coins;
}
message(0x66660010) BorrowTon {
    amount: Int as coins;
}
message(0x66660011) WithdrawTon {
    amount: Int;
}
message(0x66660012) RepayTon {
    amount: Int as coins;
}
message(0x66660013) LiquidateTon {
    borrower: Address;
    collateralReserve: Address;
    liquidationAmount: Int as coins;
}
message(0x66660014) MintToTreasury {
    reserve: Address;
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
message UpdateReserveConfiguration {
    reserve: Address;
    reserveConfiguration: ReserveConfiguration;
}
message SyncPrices {
    prices: map<Address, Int>;
    responseDestination: Address;
}
message UpdateOracleProvider {
    oracle: Address;
}
message ReleaseUserLock {
    user: Address;
}