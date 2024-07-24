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
    reserveInterestRateStrategy: map<Address, ReserveInterestRateStrategy>;
    // bounce messages
    updatePositionMsg: map<Int, UpdatePositionBounce>;

    // ===== Get functions =====

    get fun userAccountHealthInfo(userAccountData: UserAccountData): UserAccountHealthInfo {
        // sum(reserve supply amount * reserve price)
        let totalSupply: Int = 0;
        // sum(reserve Collateral amount * reserve price)
        let totalCollateral: Int = 0;
        // sum(reserve Collateral amount * reserve price * reserve ltv)
        let totalCollateralMulLtv: Int = 0;
        // sum(reserve Collateral amount * reserve price * reserve LiquidationThreshold)
        let totalCollateralMulLT: Int = 0;
        // sum(reserve borrow amount * reserve price)
        let totalDebt: Int = 0;

        foreach (reserve, tokenData in userAccountData.positionsDetail) {
            let reserveData: ReserveData = self.reservesData.get(reserve)!!;
            let reserveConfiguration: ReserveConfiguration = self.reservesConfiguration.get(reserve)!!;

            if (tokenData.supply > 0) {
                let normalizedIncome: Int = reserveData.getNormalizedIncome();
                let supplyValue: Int = tokenData.supply.rayMul(normalizedIncome) * reserveData.price / JETTON_UNIT;
                totalSupply += supplyValue;
                if (tokenData.asCollateral) {
                    totalCollateral += supplyValue;
                    totalCollateralMulLtv += supplyValue * reserveConfiguration.ltv;
                    totalCollateralMulLT += supplyValue  * reserveConfiguration.liquidationThreshold;
                }
            }
            if (tokenData.borrow > 0) {
                let normalizedDebt: Int = reserveData.getNormalizedDebt();
                let borrowValue: Int = tokenData.borrow.rayMul(normalizedDebt) * reserveData.price / JETTON_UNIT;
                totalDebt += borrowValue;
            }
        }
        return UserAccountHealthInfo{
            avgLtv: totalCollateralMulLtv / totalCollateral,
            avgLiquidationThreshold: totalCollateralMulLT / totalCollateral,
            totalSupplyInBaseCurrency: totalSupply,
            totalCollateralInBaseCurrency: totalCollateral,
            totalDebtInBaseCurrency: totalDebt,
            healthFactorInRay: totalDebt != 0 ? (totalCollateralMulLT / PERCENTAGE_FACTOR).rayDiv(totalDebt) : UINT256_MAX // base in RAY
        };
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

    get fun reserveConfiguration(reserveAddress: Address): ReserveConfiguration {
        return self.reservesConfiguration.get(reserveAddress)!!;
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
}