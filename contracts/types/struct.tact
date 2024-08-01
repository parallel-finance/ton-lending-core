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
    isFrozen: Bool; // disable supply and borrow
    borrowingEnabled: Bool;
    supplyCap: Int as coins;
    borrowCap: Int as coins;
    // reserve treasury address
    treasury: Address;
    decimals: Int as uint8;
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
    price: Int as uint64;
}
struct ReserveDataAndConfiguration {
    reserveData: ReserveData;
    reserveConfiguration: ReserveConfiguration;
    normalizedIncome: Int as uint128;
    normalizedDebt: Int as uint128;
}
struct TokenData {
    supply: Int as coins;
    borrow: Int as coins;
    asCollateral: Bool;
}
struct UserAccountData {
    positions: map<Int, Address>;
    positionsLength: Int;
    positionsDetail: map<Address, TokenData>;
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
struct UserAccountHealthInfo {
    // base in 10000
    avgLtv: Int as uint16;
    // base in 10000
    avgLiquidationThreshold: Int as uint16;
    // base in oracle price decimal: 10**9
    totalSupplyInBaseCurrency: Int as uint128;
    // base in oracle price decimal: 10**9
    totalCollateralInBaseCurrency: Int as uint128;
    // base in oracle price decimal: 10**9
    totalDebtInBaseCurrency: Int as uint128;
    // base in RAY
    healthFactorInRay: Int as uint256;
}
struct Liquidation {
    liquidator: Address;
    borrower: Address;
    liquidationReserve: Address;
    collateralReserve: Address;
    liquidationAmount: Int;
}
struct PriceData {
    price: Int;
    lastUpdateTime: Int as uint32;
}