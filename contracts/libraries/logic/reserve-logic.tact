import "../../types/struct.tact";
import "../math/math-utils";
import "../math/percentage-math";
import "./interest-rate-strategy";

extends fun cache(self: ReserveData, reserveConfigration: ReserveConfiguration): ReserveCache {
    return
        ReserveCache{
            currentScaledDebt: self.totalBorrow,
            nextScaledDebt: 0,
            currentLiquidityIndex: self.liquidityIndex,
            nextLiquidityIndex: 0,
            currentBorrowIndex: self.borrowIndex,
            nextBorrowIndex: 0,
            currentLiquidityRate: self.currentLiquidityRate,
            currentBorrowRate: self.currentBorrowRate,
            reserveFactor: reserveConfigration.reserveFactor,
            lastUpdateTimestamp: self.lastUpdateTimestamp
        };
}

// Notice: updateState: mutates
extends mutates fun updateState(self: ReserveData, reserveCache: ReserveCache): ReserveCache {
    reserveCache = self._updateIndexes(reserveCache);
    reserveCache = self._accrueToTreasury(reserveCache);
    return reserveCache;
}

// Notice: _updateIndexes: mutates
extends mutates fun _updateIndexes(self: ReserveData, cache: ReserveCache): ReserveCache {
    cache.nextLiquidityIndex = cache.currentLiquidityIndex;
    cache.nextBorrowIndex = cache.currentBorrowIndex;
    if (cache.currentLiquidityRate != 0) {
        let cumulatedLiquidityInterest: Int = calculateLinearInterest(cache.currentLiquidityRate,
            cache.lastUpdateTimestamp
        );
        cache.nextLiquidityIndex = cumulatedLiquidityInterest.rayMul(cache.currentLiquidityIndex);
        self.liquidityIndex = cache.nextLiquidityIndex;
    }
    if (cache.currentScaledDebt != 0) {
        let cumulatedVariableBorrowInterest: Int = calculateCompoundedInterest(cache.currentBorrowRate,
            cache.lastUpdateTimestamp
        );
        cache.nextBorrowIndex = cumulatedVariableBorrowInterest.rayMul(cache.currentBorrowIndex);
        self.borrowIndex = cache.nextBorrowIndex;
    }
    self.lastUpdateTimestamp = now();
    return cache;
}

// Notice: _accrueToTreasury: mutates
extends mutates fun _accrueToTreasury(self: ReserveData, cache: ReserveCache): ReserveCache {
    if (cache.reserveFactor == 0) {
        return cache;
    }
    let prevTotalDebt: Int = cache.currentScaledDebt.rayMul(cache.currentBorrowIndex);
    let currTotalDebt: Int = cache.currentScaledDebt.rayMul(cache.nextBorrowIndex);
    let totalDebtAccrued: Int = (currTotalDebt - prevTotalDebt);
    let amountToMint: Int = totalDebtAccrued.percentMul(cache.reserveFactor);
    if (amountToMint != 0) {
        self.accruedToTreasury += amountToMint.rayDiv(cache.nextLiquidityIndex);
    }
    return cache;
}

// Notice: updateInterestRates: mutates
extends mutates fun updateInterestRates(
    self: ReserveData,
    cache: ReserveCache,
    rateStrategy: ReserveInterestRateStrategy,
    liquidityAdded: Int,
    liquidityTaken: Int
) {
    let totalDebt: Int = cache.nextScaledDebt.rayMul(cache.nextBorrowIndex);
    let rates: LiquidityRateAndBorrowRate = rateStrategy.calculateInterestRates(CalculateInterestRatesParams{
            availableLiquidity: self.availableLiquidity,
            liquidityAdded: liquidityAdded,
            liquidityTaken: liquidityTaken,
            totalDebt: totalDebt,
            reserveFactor: cache.reserveFactor
        }
    );
    self.currentLiquidityRate = rates.liquidityRate;
    self.currentBorrowRate = rates.borrowRate;
}

extends fun getNormalizedIncome(self: ReserveData): Int {
    dump("getNormalizedIncome");
    dump(now());
    dump(self.lastUpdateTimestamp);
    if (now() == self.lastUpdateTimestamp) {
        return self.liquidityIndex;
    } else {
        dump("calculateLinearInterest");
        return calculateLinearInterest(self.currentLiquidityRate, self.lastUpdateTimestamp).rayMul(self.liquidityIndex);
    }
}

extends fun getNormalizedDebt(self: ReserveData): Int {
    dump("getNormalizedDebt");
    dump(now());
    dump(self.lastUpdateTimestamp);

    if (now() == self.lastUpdateTimestamp) {
        return self.borrowIndex;
    } else {
        dump("calculateCompoundedInterest");
        return calculateCompoundedInterest(self.currentBorrowRate, self.lastUpdateTimestamp).rayMul(self.borrowIndex);
    }
}