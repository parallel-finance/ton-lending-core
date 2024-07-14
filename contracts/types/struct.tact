struct ReserveConfiguration {
    // token addresses
    poolWalletAddress: Address;
    aTokenAddress: Address;
    dTokenAddress: Address;
    // liquidation configuration
    ltv: Int as uint16;
    liquidationThreshold: Int as uint16;
    liquidationBonus: Int as uint16;
    reserveFactor: Int as uint16;
    liquidationProtocolFee: Int as uint16;
    // supply and borrow configuration
    isActive: Bool;
    isFrozen: Bool;
    borrowingEnabled: Bool;
    supplyCap: Int as uint32;
    borrowCap: Int as uint32;
}
struct ReserveInterestRateStrategy {
    optimalUsageRatio: Int as uint128;
    maxUsageRatio: Int as uint128;
    baseBorrowRate: Int as uint128;
    slope1: Int as uint128;
    slope2: Int as uint128;
}
// Warning: The struct value must fit in a cell or the compiler will throw an error
// So we have to split the reserve configuration out
struct ReserveData {
    liquidityIndex: Int as uint128;
    currentLiquidityRate: Int as uint128;
    borrowIndex: Int as uint128;
    currentBorrowRate: Int as uint128;
    totalSupply: Int as coins;
    availableLiquidity: Int as coins;
    accruedToTreasury: Int as coins;
    totalBorrow: Int as coins;
    lastUpdateTimestamp: Int as uint32;
}
struct ReserveCache {
    currentScaledDebt: Int;
    nextScaledDebt: Int;
    currentLiquidityIndex: Int;
    nextLiquidityIndex: Int;
    currentBorrowIndex: Int;
    nextBorrowIndex: Int;
    currentLiquidityRate: Int;
    currentBorrowRate: Int;
    reserveFactor: Int;
    lastUpdateTimestamp: Int;
}
struct ATokenDTokenContents {
    aTokenContent: Cell;
    dTokenContent: Cell;
}
struct ATokenDTokenAddress {
    aToken: Address;
    dToken: Address;
}
struct CalculateInterestRatesParams {
    availableLiquidity: Int;
    liquidityAdded: Int;
    liquidityTaken: Int;
    totalDebt: Int;
    reserveFactor: Int;
}
struct LiquidityRateAndBorrowRate {
    liquidityRate: Int;
    borrowRate: Int;
}