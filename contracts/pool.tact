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

contract Pool with Deployable, Ownable, Resumable {

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

    init() {
        self.owner = sender();
        self.stopped = false;
    }

    receive(msg: AddReserve) {
        self.requireOwner();
        self.requireNotStopped();
        self.addReserve(msg.reserveAddress, msg.reserveConfiguration, msg.contents, msg.reserveInterestRateStrategy);
        self.reply("Reserve added".asComment());
    }

    receive(msg: DropReserve) {
        self.requireOwner();
        self.requireNotStopped();
        self.dropReserve(msg.reserveIndex);
        self.reply("Reserve dropped".asComment());
    }

    receive(msg: TokenNotification) {
        self.processTokenNotification(msg);
    }

    receive(msg: CheckAndTransferAToken) {
        self.requireNotStopped();
        // TODO: check isActive status of this asset
        self.checkHFAndTransferAToken(msg);
    }

    receive(msg: UserPositionUpdated) {
        // for supply
        if (msg.supply > 0) {
            self.mintAToken(msg.asset, msg.user, msg.supply);
        }
        // for withdraw
        if (msg.supply < 0) {
            self.burnAToken(msg.asset, msg.user, -msg.supply);
        }
        // for repay
        // for borrow
        if (msg.borrow > 0) {
            self.mintDToken(msg.asset, msg.user, msg.borrow);
        }
    }

    receive(msg: BorrowToken) {
        // send message to get user account data
        let userAccountInit: StateInit = initOf UserAccount(myAddress(), sender());
        let userAccountAddress: Address = contractAddress(userAccountInit);
        let reserveAddress: Address = msg.tokenAddress;
        let reserveConfiguration: ReserveConfiguration? = self.reservesConfiguration.get(reserveAddress);
        require(reserveConfiguration != null, "Reserve not found");

        send(SendParameters{
            to: userAccountAddress,
            value: 0,
            bounce: false,
            mode: SendRemainingValue,
            body: GetUserAccountData{
                queryId: self.queryId,
                user: context().sender,
                action: ACTION_BORROW,
                tokenAddress: msg.tokenAddress,
                amount: msg.amount
            }.toCell()
        });
        self.queryId += 1;
    }

    receive(msg: WithdrawToken) {
        // send message to get user account data
        let userAccountInit: StateInit = initOf UserAccount(myAddress(), sender());
        let userAccountAddress: Address = contractAddress(userAccountInit);
        let reserveAddress: Address = msg.tokenAddress;
        let reserveConfiguration: ReserveConfiguration? = self.reservesConfiguration.get(reserveAddress);
        require(reserveConfiguration != null, "Reserve not found");
        send(SendParameters{
            to: userAccountAddress,
            value: 0,
            bounce: false,
            mode: SendRemainingValue,
            body: GetUserAccountData{
                queryId: self.queryId,
                user: context().sender,
                action: ACTION_WITHDRAW,
                tokenAddress: msg.tokenAddress,
                amount: msg.amount
            }.toCell()
        });
        self.queryId += 1;
    }

    receive(msg: UserAccountDataResponse) {
        let reserveAddress: Address = msg.tokenAddress;
        let userAccountData: UserAccountData = msg.accountData;

        self.validateForAction(msg.action, msg.tokenAddress, msg.amount, userAccountData);

        let reserveData: ReserveData = self.reservesData.get(reserveAddress)!!;
        let reserveConfigration: ReserveConfiguration = self.reservesConfiguration.get(reserveAddress)!!;
        let reserveCache: ReserveCache = reserveData.cache(reserveConfigration);
        // _updateIndexes and _accrueToTreasury
        reserveCache = reserveData.updateState(reserveCache);

        let rateStrategy: ReserveInterestRateStrategy = self.reserveInterestRateStrategy.get(reserveAddress)!!;

        if(msg.action == ACTION_BORROW) {
            let borrowAmount: Int = msg.amount;
            // update (scaled) total debt
            let scaledBorrowAmount: Int = borrowAmount.rayDiv(reserveCache.nextBorrowIndex);
            reserveData.totalBorrow += scaledBorrowAmount;
            reserveCache.nextScaledDebt = reserveData.totalBorrow;
            // updateInterestRates
            reserveData.updateInterestRates(reserveCache, rateStrategy, 0, borrowAmount);
            // update available liquidity
            reserveData.availableLiquidity -= borrowAmount;
            // set reserveData to storage back
            self.reservesData.set(reserveAddress, reserveData);
            // Transfer borrowAmount Token(tokenAddress) to the user.
            let poolWalletAddress: Address = reserveConfigration.poolWalletAddress;
            self.sendTokenTransferByPool(msg.queryId, poolWalletAddress, msg.user, borrowAmount);
            // TODO: calculate fees and Ton to send
            self.updateUserAccountPosition(msg.queryId, msg.user, msg.tokenAddress, 0, scaledBorrowAmount); 
        }

        if(msg.action == ACTION_WITHDRAW) {
            let withdrawAmount: Int = msg.amount;
            // updateInterestRates
            reserveData.updateInterestRates(reserveCache, rateStrategy, 0, withdrawAmount);
            // update (scaled) total supply and available liquidity
            let scaledWithdrawAmount: Int = withdrawAmount.rayDiv(reserveCache.nextLiquidityIndex);
            reserveData.availableLiquidity -= withdrawAmount;
            reserveData.totalSupply -= scaledWithdrawAmount;
            // set reserveData to storage back
            self.reservesData.set(reserveAddress, reserveData);
            // Transfer withdrawAmount Token(tokenAddress) to the user.
            let poolWalletAddress: Address = reserveConfigration.poolWalletAddress;
            self.sendTokenTransferByPool(msg.queryId, poolWalletAddress, msg.user, withdrawAmount);
            // TODO: calculate fees and Ton to send
            self.updateUserAccountPosition(msg.queryId, msg.user, msg.tokenAddress, -scaledWithdrawAmount, 0);
        }
    }

    // Notice: Only for Test
    receive(msg: SetMockOraclePrice) {
        let reserveData: ReserveData = self.reservesData.get(msg.asset)!!;
        reserveData.price = msg.price;
        self.reservesData.set(msg.asset, reserveData);
    }

    receive(msg: TokenExcesses) {
        // accept excesses and do nothing
        // TODO: consider store the token transfer data and transfer token here
    }

    fun sendTokenTransferByPool(queryId: Int, poolWalletAddress: Address, toAddress: Address, amount: Int) {
        send(SendParameters{
            to: poolWalletAddress,
            value: ton("0.05"),
            bounce: true,
            mode: SendPayGasSeparately,
            body: TokenTransfer{
                queryId: queryId,
                amount: amount,
                destination: toAddress,
                response_destination: toAddress,
                custom_payload: emptyCell(),
                forward_ton_amount: 0,
                forward_payload: emptyCell()
            }.toCell()
        });
    }

    fun validateForAction(
        action: Int,
        reserve: Address,
        amount: Int,
        userAccountData: UserAccountData
    ): Bool {
        let healthInfo: UserAccountHealthInfo = self.userAccountHealthInfo(userAccountData);
        let reserveData: ReserveData = self.reservesData.get(reserve)!!;
        let reserveConfigration: ReserveConfiguration = self.reservesConfiguration.get(reserve)!!;
        if (action == ACTION_BORROW) {
            // 1. check borrowingEnabled
            // 2. check reserve isActive / isFrozen
            // 3. check reserve availableLiquidity
            // 4. check HF for borrow
            require(reserveConfigration.borrowingEnabled, "Borrowing disable for this token");
            require(reserveConfigration.isActive, "Token inactive");
            require(!reserveConfigration.isFrozen, "Token Frozen");
            require(reserveData.availableLiquidity >= amount, "invalid available liquidity");

            require(healthInfo.healthFactorInRay >= RAY, "HF < 1");
            let borrowAmountValue: Int = amount * reserveData.price / JETTON_UNIT;
            let collateralNeeded: Int = borrowAmountValue.percentDiv(healthInfo.avgLtv);
            require(healthInfo.totalDebtInBaseCurrency + collateralNeeded <= healthInfo.totalCollateralInBaseCurrency, "collateral can't cover new borrow");
        }
        if (action == ACTION_WITHDRAW) {
            // 1. check reserve isActive
            // 2. check reserve availableLiquidity
            // 3. check withdraw amount <= supply position
            // 4. check HF
            require(reserveConfigration.isActive, "Token inactive");
            require(reserveData.availableLiquidity >= amount, "invalid available liquidity");

            let userReservePosition: TokenData = userAccountData.positionsDetail.get(reserve)!!;
            let normalizedIncome: Int = reserveData.getNormalizedIncome();
            require(userReservePosition.supply.rayMul(normalizedIncome) >= amount, "invalid user supply position");

            require(healthInfo.healthFactorInRay >= RAY, "HF < 1");
            let withdrawValue: Int = amount * reserveData.price / JETTON_UNIT;
            let withdrawValueMulLT: Int = withdrawValue.percentMul(reserveConfigration.liquidationThreshold);
            let totalCollateralMulLT: Int = healthInfo.totalCollateralInBaseCurrency.percentMul(healthInfo.avgLiquidationThreshold);
            require(totalCollateralMulLT - withdrawValueMulLT >= healthInfo.totalDebtInBaseCurrency, "the left collateral can't cover debt");
        }
        if (action == ACTION_LIQUIDATION) {
            require(healthInfo.healthFactorInRay < RAY, "HF >= 1");
        }

        return true;
    }

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

    fun mintAToken(asset: Address, user: Address, amount: Int) {
        let aTokenAddress: Address = self.reservesConfiguration.get(asset)!!.aTokenAddress;
        send(SendParameters{
            to: aTokenAddress,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: Mint{
                amount: amount,
                receiver: user
            }.toCell()
        });
    }

    fun burnAToken(asset: Address, user: Address, amount: Int) {
        send(SendParameters{
            to: self.userATokenWalletAddress(asset, user),
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: TokenBurn{
                queryId: self.queryId,
                amount: amount,
                owner: user,
                response_destination: user // This field isn't used in TokenBurn
            }.toCell()
        });
    }

    // TODO: handle bounce message
    fun mintDToken(asset: Address, user: Address, amount: Int) {
        let dTokenAddress: Address = self.reservesConfiguration.get(asset)!!.dTokenAddress;
        send(SendParameters{
            to: dTokenAddress,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: Mint{
                amount: amount,
                receiver: user
            }.toCell()
        });
    }

    fun checkHFAndTransferAToken(msg: CheckAndTransferAToken) {
        let userATokenWallet: Address = self.userATokenWalletAddress(msg.asset, msg.from);
        require(context().sender == userATokenWallet, "invalid sender");
        // TODO: check user health factor
        let isHealthy: Bool = true;
        // chech HF
        require(isHealthy == true, "invalid health factor");
        // send TokenTransferByPool back to aTokenWallet
        send(SendParameters{
            to: userATokenWallet,
            value: 0,
            bounce: false,
            mode: SendRemainingValue,
            body: TokenTransferByPool{
                queryId: msg.queryId,
                amount: msg.amount,
                destination: msg.destination,
                response_destination: msg.response_destination,
                custom_payload: msg.custom_payload,
                forward_ton_amount: msg.forward_ton_amount,
                forward_payload: msg.forward_payload
            }.toCell()
        });
    }

    // TODO: process user account position update message

    fun processTokenNotification(msg: TokenNotification) {
        let matchedReserve: Address? = self.findReserveByPoolWalletAddress(context().sender);
        require(matchedReserve != null, "Reserve not found");

        let forwardPayload: Cell = msg.forward_payload;
        let forwardPayloadSlice: Slice = forwardPayload.beginParse();
        let opCode: Int = forwardPayloadSlice.loadUint(32);
        // use crc32 code of 'Supply': utils.calculateRequestOpcode_1('Supply')
        if (opCode == 0x55b591ba) {
            let supplyAmount: Int = msg.amount;
            let reserveData: ReserveData = self.reserveData(matchedReserve!!);
            let reserveConfigration: ReserveConfiguration = self.reservesConfiguration.get(matchedReserve!!)!!;
            let reserveCache: ReserveCache = reserveData.cache(reserveConfigration);
            // _updateIndexes and _accrueToTreasury
            reserveCache = reserveData.updateState(reserveCache);

            // TODO: validateSupply

            // updateInterestRates
            let rateStrategy: ReserveInterestRateStrategy = self.reserveInterestRateStrategy.get(matchedReserve!!)!!;
            reserveData.updateInterestRates(reserveCache, rateStrategy, supplyAmount, 0);
            // update liquidity and set reserveData to storage back;
            let scaledSupplyAmount: Int = supplyAmount.rayDiv(reserveCache.nextLiquidityIndex);
            reserveData.availableLiquidity += supplyAmount;
            reserveData.totalSupply += scaledSupplyAmount;
            self.reservesData.set(matchedReserve!!, reserveData);

            self.updateUserAccountPosition(msg.queryId, msg.from, matchedReserve!!, scaledSupplyAmount, 0);
        }
    }

    fun updateUserAccountPosition(queryId: Int, ownerAddress: Address, reserveAddress: Address, supply: Int, borrow: Int) {
        let userAccountInit: StateInit = initOf UserAccount(myAddress(), ownerAddress);
        let userAccountAddress: Address = contractAddress(userAccountInit);
        send(SendParameters{
        to: userAccountAddress,
        value: 0,
        bounce: true,
        mode: SendRemainingValue,
        body: UpdatePosition{
            queryId: queryId,
            address: reserveAddress,
            supply: supply,
            borrow: borrow
        }.toCell(),
        code: userAccountInit.code,
        data: userAccountInit.data
        });
    }

    fun findReserveByPoolWalletAddress(poolWalletAddress: Address): Address? {
        let i: Int = 0;
        let matchedReserve: Address? = null;
        while (i < self.reservesLength && matchedReserve == null) {
            let reserveAddress: Address = self.reserves.get(i)!!;
            let reserveConfiguration: ReserveConfiguration = self.reservesConfiguration.get(reserveAddress)!!;
            if (poolWalletAddress == reserveConfiguration.poolWalletAddress) {
                matchedReserve = reserveAddress;
            }
            i = i + 1;
        }
        return matchedReserve;
    }

    fun getUserAccountInit(userAddress: Address): StateInit {
        return initOf UserAccount(myAddress(), userAddress);
    }

    fun getAssetATokenInit(content: Cell, asset: Address): StateInit {
        return initOf AToken(myAddress(), content, asset);
    }

    fun getAssetDTokenInit(content: Cell, asset: Address): StateInit {
        return initOf DToken(myAddress(), content, asset);
    }

    fun deployAToken(content: Cell, asset: Address): Address {
        let sinit: StateInit = self.getAssetATokenInit(content, asset);
        let aTokenAddress: Address = contractAddress(sinit);
        send(SendParameters{
            to: aTokenAddress,
            value: ton("0.05"), // pay for message, the deployment and give some TON for storage
            mode: SendIgnoreErrors,
            code: sinit.code,
            data: sinit.data,
            body: emptyCell()
        });
        return aTokenAddress;
    }

    fun deployDToken(content: Cell, asset: Address): Address {
        let sinit: StateInit = self.getAssetDTokenInit(content, asset);
        let dTokenAddress: Address = contractAddress(sinit);
        send(SendParameters{
            to: dTokenAddress,
            value: ton("0.05"), // pay for message, the deployment and give some TON for storage
            mode: SendIgnoreErrors,
            code: sinit.code,
            data: sinit.data,
            body: emptyCell()
        });
        return dTokenAddress;
    }

    fun addReserve(
        reserveAddress: Address,
        reserveConfiguration: ReserveConfiguration,
        contents: ATokenDTokenContents,
        interestRateStrategy: ReserveInterestRateStrategy
    ) {
        self.validateAddReserve(reserveAddress, reserveConfiguration);
        let now: Int = now();
        let newReserveData: ReserveData = ReserveData{
        liquidityIndex: RAY,
        currentLiquidityRate: 0,
        borrowIndex: RAY,
        currentBorrowRate: 0,
        totalSupply: 0,
        availableLiquidity: 0,
        accruedToTreasury: 0,
        totalBorrow: 0,
        lastUpdateTimestamp: now,
        price: 0
        };
        self.reserveInterestRateStrategy.set(reserveAddress, interestRateStrategy);
        self.reserves.set(self.reservesLength, reserveAddress);
        self.reservesData.set(reserveAddress, newReserveData);
        self.reservesLength += 1;
        // deploy atoken
        let aTokenAddress: Address = self.deployAToken(contents.aTokenContent, reserveAddress);
        reserveConfiguration.aTokenAddress = aTokenAddress;
        let dTokenAddress: Address = self.deployDToken(contents.dTokenContent, reserveAddress);
        reserveConfiguration.dTokenAddress = dTokenAddress;
        self.reservesConfiguration.set(reserveAddress, reserveConfiguration);
    }

    fun dropReserve(reserveIndex: Int) {
        require(reserveIndex < self.reservesLength, "Reserve index out of bounds");
        let reserveAddress: Address = self.reserves.get(reserveIndex)!!;
        let reserveData: ReserveData = self.reservesData.get(reserveAddress)!!;
        let reserveConfiguration: ReserveConfiguration = self.reservesConfiguration.get(reserveAddress)!!;

        self.validateDropReserve(reserveData);
        let lastReserveIndex: Int = self.reservesLength - 1;
        let lastReserveAddress: Address =  self.reserves.get(lastReserveIndex)!!;
        if (reserveIndex != lastReserveIndex) {
            self.reserves.set(reserveIndex, lastReserveAddress);
        }
        self.reserves.set(lastReserveIndex, null);
        self.reservesData.set(reserveAddress, null);
        self.reservesConfiguration.set(reserveAddress, null);
        self.reserveInterestRateStrategy.set(reserveAddress, null);
        self.reservesLength -= 1;
    }

    fun validateAddReserve(reserveAddress: Address, reserveConfiguration: ReserveConfiguration) {
        // TODO: add more validation on reserveConfiguration as required
        let existingReserveData: ReserveData? = self.reservesData.get(reserveAddress);
        require(existingReserveData == null, "Reserve already exists");
    }

    fun validateDropReserve(reserveData: ReserveData) {
        require(reserveData.accruedToTreasury == 0, "Treasury share not zero");
        require(reserveData.totalSupply == 0, "Liability not zero");
        require(reserveData.totalBorrow == 0, "Debt not zero");
    }

    // ===== Get functions =====
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

    get fun reserveDataForUI(reserveAddress: Address): ReserveDataForUI {
        let reserveData: ReserveData = self.reservesData.get(reserveAddress)!!;
        return ReserveDataForUI{
            liquidityIndex: reserveData.liquidityIndex,
            currentLiquidityRate: reserveData.currentLiquidityRate,
            borrowIndex: reserveData.borrowIndex,
            currentBorrowRate: reserveData.currentBorrowRate,
            totalSupply: reserveData.totalSupply,
            availableLiquidity: reserveData.availableLiquidity,
            accruedToTreasury: reserveData.accruedToTreasury,
            totalBorrow: reserveData.totalBorrow,
            lastUpdateTimestamp: reserveData.lastUpdateTimestamp,
            price: reserveData.price,
            normalizedIncome: reserveData.getNormalizedIncome(),
            normalizedDebt: reserveData.getNormalizedDebt(),
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
}
