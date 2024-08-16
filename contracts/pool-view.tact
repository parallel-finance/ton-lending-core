import "@stdlib/deploy";
import "@stdlib/ownable";
import "@stdlib/stoppable";
import "./user-account";
import "./jetton/assetToken/atoken";
import "./jetton/debtToken/dtoken";
import "./jetton/assetToken/atoken-wallet";
import "./jetton/debtToken/dtoken-wallet";
import "./types/struct";
import "./types/message";
import "./libraries/logic/reserve-logic";
import "./constants";

trait PoolView with Ownable, Resumable {
    owner: Address;
    stopped: Bool;
    // pool query id to trach the messages
    queryId: Int = 0;
    // index -> baseTokenAddress, this index starts from 0
    reserves: map<Int, Address>;
    // length of reserves
    reservesLength: Int = 0;
    // baseTokenAddress -> reserveData
    reservesData: map<Address, ReserveData>;
    // baseTokenAddress -> reserveConfiguration
    reservesConfiguration: map<Address, ReserveConfiguration>;
    reservesInterestRateStrategy: map<Address, ReserveInterestRateStrategy>;

    // oracle provider address
    oracleProvider: Address?;
    
    // bounce messages
    updatePositionMsg: map<Int, UpdatePositionBounce>;

    // user reentrancy lock
    userLock: map<Address, Bool>;

    // ===== Get functions =====

    get fun userAccountHealthInfo(userAccountData: UserAccountData): UserAccountHealthInfo {
        // sum(reserve supply amount * reserve price)
        let totalSupply: Int = 0;
        // sum(reserve supply amount * reserve price * reserve ltv)
        let totalSupplyMulLtv: Int = 0;
        // sum(reserve supply amount * reserve price * reserve LiquidationThreshold)
        let totalSupplyMulLT: Int = 0;
        // sum(reserve borrow amount * reserve price)
        let totalDebt: Int = 0;

        foreach (reserve, tokenData in userAccountData.positionsDetail) {
            let reserveData: ReserveData = self.reservesData.get(reserve)!!;
            let reserveConfiguration: ReserveConfiguration = self.reservesConfiguration.get(reserve)!!;
            let reserveUint: Int = pow(10, reserveConfiguration.decimals);

            if (tokenData.supply > 0) {
                let normalizedIncome: Int = reserveData.getNormalizedIncome();
                let supplyValue: Int = tokenData.supply.rayMul(normalizedIncome) * reserveData.price / reserveUint;
                totalSupply += supplyValue;
                totalSupplyMulLtv += supplyValue * reserveConfiguration.ltv;
                totalSupplyMulLT += supplyValue  * reserveConfiguration.liquidationThreshold;
            }
            if (tokenData.borrow > 0) {
                let normalizedDebt: Int = reserveData.getNormalizedDebt();
                let borrowValue: Int = tokenData.borrow.rayMul(normalizedDebt) * reserveData.price / reserveUint;
                totalDebt += borrowValue;
            }
        }

        let avgLtv: Int = totalSupply != 0 ? totalSupplyMulLtv / totalSupply : 0;
        let availableBorrows: Int = totalSupply.percentMul(avgLtv);
        if (availableBorrows < totalDebt) {
            availableBorrows = 0;
        } else {
            availableBorrows = availableBorrows - totalDebt;
        }

        return UserAccountHealthInfo{
            avgLtv: avgLtv,
            avgLiquidationThreshold: totalSupply != 0 ? totalSupplyMulLT / totalSupply : 0,
            totalSupplyInBaseCurrency: totalSupply,
            totalDebtInBaseCurrency: totalDebt,
            availableBorrowsInBaseCurrency: availableBorrows,
            healthFactorInRay: totalDebt != 0 ? (totalSupplyMulLT / PERCENTAGE_FACTOR).rayDiv(totalDebt) : UINT256_MAX // base in RAY
        };
    }

    get fun batchUserAccountHealthInfo(accountDatas: map<Address, UserAccountData>): map<Address, UserAccountHealthInfo> {
        let healthInfos: map<Address, UserAccountHealthInfo> = emptyMap();
        foreach (userAddress, userAccountData in accountDatas) {
            healthInfos.set(userAddress, self.userAccountHealthInfo(userAccountData));
        }
        return healthInfos;
    }

    get fun getUserAccountInit(userAddress: Address): StateInit {
        return initOf UserAccount(myAddress(), userAddress);
    }

    get fun getAssetATokenInit(content: Cell, asset: Address): StateInit {
        return initOf AToken(myAddress(), content, asset);
    }

    get fun getAssetDTokenInit(content: Cell, asset: Address): StateInit {
        return initOf DToken(myAddress(), content, asset);
    }

    get fun reservesLength(): Int {
        return self.reservesLength;
    }

    get fun reserves(): map<Int, Address> {
        return self.reserves;
    }

    get fun reserveAddress(reserveIndex: Int): Address {
        return self.reserves.get(reserveIndex)!!;
    }

    get fun reserveData(reserveAddress: Address): ReserveData {
        return self.reservesData.get(reserveAddress)!!;
    }

    get fun reserveDataAndConfiguration(reserveAddress: Address): ReserveDataAndConfiguration {
        let reserveData: ReserveData = self.reservesData.get(reserveAddress)!!;
        let reserveConfiguration: ReserveConfiguration = self.reservesConfiguration.get(reserveAddress)!!;
        return
            ReserveDataAndConfiguration{
                reserveData: reserveData,
                reserveConfiguration: reserveConfiguration,
                normalizedIncome: reserveData.getNormalizedIncome(),
                normalizedDebt: reserveData.getNormalizedDebt()
            };
    }

    get fun allReserveDataAndConfiguration(): map<Address, ReserveDataAndConfiguration> {
        let allDataAndConfigurations: map<Address, ReserveDataAndConfiguration> = emptyMap();

        let i: Int = 0;
        while (i < self.reservesLength) {
            let reserveAddress: Address = self.reserves.get(i)!!;
            let reserveData: ReserveData = self.reservesData.get(reserveAddress)!!;
            let reserveConfiguration: ReserveConfiguration = self.reservesConfiguration.get(reserveAddress)!!;
            
            allDataAndConfigurations.set(reserveAddress, ReserveDataAndConfiguration{
                reserveData: reserveData,
                reserveConfiguration: reserveConfiguration,
                normalizedIncome: reserveData.getNormalizedIncome(),
                normalizedDebt: reserveData.getNormalizedDebt()
            });
            i = i + 1;
        }
        return allDataAndConfigurations;
    }

    get fun reserveConfiguration(reserveAddress: Address): ReserveConfiguration {
        return self.reservesConfiguration.get(reserveAddress)!!;
    }

    get fun reserveInterestRateStrategy(reserveAddress: Address): ReserveInterestRateStrategy {
        return self.reservesInterestRateStrategy.get(reserveAddress)!!;
    }

    get fun calculateATokenAddress(content: Cell, reserveAddress: Address): Address {
        let sinit: StateInit = self.getAssetATokenInit(content, reserveAddress);
        let aTokenAddress: Address = contractAddress(sinit);
        return aTokenAddress;
    }

    get fun calculateDTokenAddress(content: Cell, reserveAddress: Address): Address {
        let sinit: StateInit = self.getAssetDTokenInit(content, reserveAddress);
        let dTokenAddress: Address = contractAddress(sinit);
        return dTokenAddress;
    }

    get fun userATokenWalletAddress(asset: Address, user: Address): Address {
        let aToken: Address = self.reservesConfiguration.get(asset)!!.aTokenAddress;
        let sinit: StateInit = initOf ATokenDefaultWallet(aToken, myAddress(), asset, user);
        return contractAddress(sinit);
    }

    get fun userDTokenWalletAddress(asset: Address, user: Address): Address {
        let dToken: Address = self.reservesConfiguration.get(asset)!!.dTokenAddress;
        let sinit: StateInit = initOf DTokenDefaultWallet(dToken, myAddress(), asset, user);
        return contractAddress(sinit);
    }

    get fun userAccountAddress(user: Address): Address {
        let sinit: StateInit = self.getUserAccountInit(user);
        return contractAddress(sinit);
    }

    get fun queryId(): Int {
        return self.queryId;
    }

    get fun bounceMsg(queryId: Int): Cell? {
        let updatePositionMsg: UpdatePositionBounce? = self.updatePositionMsg.get(queryId);
        if (updatePositionMsg != null) {
            return updatePositionMsg!!.toCell();
        }
        return null;
    }

    get fun oracleProvider(): Address? {
        return self.oracleProvider;
    }

    get fun userLock(user: Address): Bool {
        return self.userLock.get(user) == true;
    }

    get fun MIN_TONS_FOR_STORAGE(): Int {
        return self.MIN_TONS_FOR_STORAGE();
    }

    get fun TOKEN_TRANSFER_GAS_CONSUMPTION(): Int {
        return self.TOKEN_TRANSFER_GAS_CONSUMPTION();
    }
    
    get fun TOKEN_MINT_GAS_CONSUMPTION(): Int {
        return self.TOKEN_MINT_GAS_CONSUMPTION();
    }

    get fun TOKEN_BURN_GAS_CONSUMPTION(): Int {
        return self.TOKEN_BURN_GAS_CONSUMPTION();
    }

    get fun SUPPLY_REPAY_GAS_CONSUMPTION(): Int {
        return self.SUPPLY_REPAY_GAS_CONSUMPTION();
    }

    get fun BORROW_GAS_CONSUMPTION(): Int {
        return self.BORROW_GAS_CONSUMPTION();
    }

    get fun WITHDRAW_GAS_CONSUMPTION(): Int {
        return self.WITHDRAW_GAS_CONSUMPTION();
    }
    
    get fun LIQUIDATION_GAS_CONSUMPTION(): Int {
        return self.LIQUIDATION_GAS_CONSUMPTION();
    }
}