import "../../types/struct.tact";
import "../math/math-utils";
import "../math/percentage-math";

struct CalcInterestRatesLocalVars {
    availableLiquidity: Int;
    totalDebt: Int;
    currentBorrowRate: Int;
    currentLiquidityRate: Int;
    borrowUsageRatio: Int;
    supplyUsageRatio: Int;
    availableLiquidityPlusDebt: Int;
}

extends fun calculateInterestRates(
    self: ReserveInterestRateStrategy,
    params: CalculateInterestRatesParams
): LiquidityRateAndBorrowRate {
    let vars: CalcInterestRatesLocalVars = CalcInterestRatesLocalVars{
        availableLiquidity: 0,
        totalDebt: params.totalDebt,
        currentBorrowRate: self.baseBorrowRate,
        currentLiquidityRate: 0,
        borrowUsageRatio: 0,
        supplyUsageRatio: 0,
        availableLiquidityPlusDebt: 0
    };
    if (vars.totalDebt != 0) {
        vars.availableLiquidity = ((params.availableLiquidity + params.liquidityAdded) - params.liquidityTaken);
        vars.availableLiquidityPlusDebt = (vars.availableLiquidity + vars.totalDebt);
        vars.borrowUsageRatio = vars.totalDebt.rayDiv(vars.availableLiquidityPlusDebt);
        vars.supplyUsageRatio = vars.totalDebt.rayDiv(vars.availableLiquidityPlusDebt);
    }
    if (vars.borrowUsageRatio > self.optimalUsageRatio) {
        let excessBorrowUsageRatio: Int = (vars.borrowUsageRatio - self.optimalUsageRatio).rayDiv(self.maxUsageRatio);
        vars.currentBorrowRate += (self.slope1 + self.slope2.rayMul(excessBorrowUsageRatio));
    } else {
        vars.currentBorrowRate += self.slope1.rayMul(vars.borrowUsageRatio).rayDiv(self.optimalUsageRatio);
    }
    vars.currentLiquidityRate = vars.currentBorrowRate.rayMul(vars.supplyUsageRatio).percentMul((PERCENTAGE_FACTOR -
            params.reserveFactor)
    );
    return LiquidityRateAndBorrowRate{liquidityRate: vars.currentLiquidityRate, borrowRate: vars.currentBorrowRate};
}