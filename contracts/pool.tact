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
import "./pool-view";

contract Pool with Deployable, Ownable, Resumable, PoolView {

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
    mintMsg: map<Int, MintBounce>;
    tokenTransferMsg: map<Int, TokenTransferBounce>;
    tokenBurnMsg: map<Int, TokenBurnBounce>;

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
        // TODO: check ctx sender is user's userAccount address
        let userAccount: Address = self.userAccountAddress(msg.user);
        require(userAccount == context().sender, "Not from the user account");
        // delete stored updatePositionMsg
        self.updatePositionMsg.del(msg.queryId);

        // for supply
        if (msg.supply > 0) {
            self.mintAToken(msg.asset, msg.user, msg.supply);
        }
        // for withdraw
        if (msg.supply < 0) {
            self.burnAToken(msg.asset, msg.user, -msg.supply);
        }
        // for repay
        if (msg.borrow < 0) {
            self.burnDToken(msg.asset, msg.user, -msg.borrow);
        }
        // for borrow
        if (msg.borrow > 0) {
            self.mintDToken(msg.asset, msg.user, msg.borrow);
        }
    }

    receive(msg: BorrowToken) {
        // send message to get user account data
        let userAccountAddress: Address = self.userAccountAddress(sender());
        let reserveAddress: Address = msg.tokenAddress;
        let reserveConfiguration: ReserveConfiguration? = self.reservesConfiguration.get(reserveAddress);
        require(reserveConfiguration != null, "Reserve not found");
        // GetUserAccountData don't need do bounce
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
        let userAccountAddress: Address = self.userAccountAddress(sender());
        let reserveAddress: Address = msg.tokenAddress;
        let reserveConfiguration: ReserveConfiguration? = self.reservesConfiguration.get(reserveAddress);
        require(reserveConfiguration != null, "Reserve not found");
        // GetUserAccountData don't need do bounce
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
            self.sendTokenTransferByPool(poolWalletAddress, msg.user, borrowAmount);
            // TODO: calculate fees and Ton to send
            self.updateUserAccountPosition(msg.user, msg.tokenAddress, 0, scaledBorrowAmount); 
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
            self.sendTokenTransferByPool(poolWalletAddress, msg.user, withdrawAmount);
            // TODO: calculate fees and Ton to send
            self.updateUserAccountPosition(msg.user, msg.tokenAddress, -scaledWithdrawAmount, 0);
        }
    }

    // Notice: Only for Test
    receive(msg: SetMockOraclePrice) {
        let reserveData: ReserveData = self.reservesData.get(msg.asset)!!;
        reserveData.price = msg.price;
        self.reservesData.set(msg.asset, reserveData);
    }

    receive(msg: TokenExcesses) {
        // TODO: consider store the token transfer data and transfer token here
        // because `self.queryId` is globally increment, 
        // we can delete the key of the queryId from `mintMsg` map and `tokenTransferMsg` map in the same time,
        // And only one map will be updated.
        self.mintMsg.del(msg.queryId);
        self.tokenTransferMsg.del(msg.queryId);
        self.tokenBurnMsg.del(msg.queryId);
    }

    receive(msg: RerunBounceMsg) {
        if (msg.action == RERUN_ACTION_UPDATE_POSITION) {
            self.rerunUpdatePositionMsg(msg.queryId);
        }
        if (msg.action == RERUN_ACTION_MINT) {
            self.rerunMintMsg(msg.queryId);
        }
        if (msg.action == RERUN_ACTION_TOKEN_TRANSFER) {
            self.rerunSendTokenTransferByPool(msg.queryId);
        }
        if (msg.action == RERUN_ACTION_TOKEN_BURN) {
            self.rerunTokenBurnMsg(msg.queryId);
        }
    }

    fun sendTokenTransferByPool(poolWalletAddress: Address, toAddress: Address, amount: Int) {
        let queryId: Int = self.queryId;
        let tokenTransferMsg: TokenTransfer = TokenTransfer{
            queryId: queryId,
            amount: amount,
            destination: toAddress,
            response_destination: myAddress(), // Pool need to receive TokenExcesses message
            custom_payload: null,
            forward_ton_amount: 0,
            forward_payload: emptySlice()
        };
        // store TokenTransferBounce
        let bounceMsg: TokenTransferBounce = TokenTransferBounce{
            to: poolWalletAddress,
            user: toAddress,
            msg: tokenTransferMsg
        };
        self.tokenTransferMsg.set(queryId, bounceMsg);
        self.queryId += 1;

        send(SendParameters{
            to: poolWalletAddress,
            value: ton("0.05"),
            bounce: true,
            mode: SendPayGasSeparately,
            body: tokenTransferMsg.toCell()
        });
    }

    fun rerunSendTokenTransferByPool(queryId: Int) {
        let bounce: TokenTransferBounce = self.tokenTransferMsg.get(queryId)!!;
        send(SendParameters{
            to: bounce.to,
            value: ton("0.05"),
            bounce: true,
            mode: SendPayGasSeparately,
            body: bounce.msg.toCell()
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

    fun mintAToken(asset: Address, user: Address, amount: Int) {
        let aTokenAddress: Address = self.reservesConfiguration.get(asset)!!.aTokenAddress;

        // store mintMsg
        let queryId: Int = self.queryId;
        let mintMsg: Mint = Mint{
            queryId: queryId,
            amount: amount,
            receiver: user
        };
        let bounce: MintBounce = MintBounce{
            to: aTokenAddress,
            user: user,
            msg: mintMsg
        };
        self.mintMsg.set(queryId, bounce);
        self.queryId += 1;

        send(SendParameters{
            to: aTokenAddress,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: mintMsg.toCell()
        });
    }

    fun burnAToken(asset: Address, user: Address, amount: Int) {
        let queryId: Int = self.queryId;
        let tokenBurnMsg: TokenBurn = TokenBurn{
            queryId: queryId,
            amount: amount,
            owner: user,
            response_destination: myAddress() // Pool need to receive TokenExcesses message
        };
        let to: Address = self.userATokenWalletAddress(asset, user);
        let bounce: TokenBurnBounce = TokenBurnBounce{
            to: to,
            user: user,
            msg: tokenBurnMsg
        };
        self.tokenBurnMsg.set(queryId, bounce);
        self.queryId += 1;

        send(SendParameters{
            to: to,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: tokenBurnMsg.toCell()
        });
    }

    fun burnDToken(asset: Address, user: Address, amount: Int) {
        let queryId: Int = self.queryId;
        let tokenBurnMsg: TokenBurn = TokenBurn{
            queryId: queryId,
            amount: amount,
            owner: user,
            response_destination: myAddress() // Pool need to receive TokenExcesses message
        };
        let to: Address = self.userDTokenWalletAddress(asset, user);
        let bounce: TokenBurnBounce = TokenBurnBounce{
            to: to,
            user: user,
            msg: tokenBurnMsg
        };
        self.tokenBurnMsg.set(queryId, bounce);
        self.queryId += 1;

        send(SendParameters{
            to: to,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: tokenBurnMsg.toCell()
        });
    }

    fun mintDToken(asset: Address, user: Address, amount: Int) {
        let dTokenAddress: Address = self.reservesConfiguration.get(asset)!!.dTokenAddress;
        // store mintMsg
        let queryId: Int = self.queryId;
        let mintMsg: Mint = Mint{
            queryId: queryId,
            amount: amount,
            receiver: user
        };
        let bounce: MintBounce = MintBounce{
            to: dTokenAddress,
            user: user,
            msg: mintMsg
        };
        self.mintMsg.set(queryId, bounce);
        self.queryId += 1;

        send(SendParameters{
            to: dTokenAddress,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: mintMsg.toCell()
        });
    }

    fun rerunMintMsg(queryId: Int) {
        let bounce: MintBounce = self.mintMsg.get(queryId)!!;
        send(SendParameters{
            to: bounce.to,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: bounce.msg.toCell()
        });
    }

    fun rerunTokenBurnMsg(queryId: Int) {
        let bounce: TokenBurnBounce = self.tokenBurnMsg.get(queryId)!!;
        send(SendParameters{
            to: bounce.to,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: bounce.msg.toCell()
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

        let forwardPayload: Slice = msg.forward_payload;
        let opCode: Int = forwardPayload.loadUint(32);
        let reserveData: ReserveData = self.reserveData(matchedReserve!!);
        let reserveConfigration: ReserveConfiguration = self.reservesConfiguration.get(matchedReserve!!)!!;
        let reserveCache: ReserveCache = reserveData.cache(reserveConfigration);
        // _updateIndexes and _accrueToTreasury
        reserveCache = reserveData.updateState(reserveCache);

        // use crc32 code of 'Supply': utils.calculateRequestOpcode_1('Supply')
        if (opCode == 0x55b591ba) {
            let supplyAmount: Int = msg.amount;
            // TODO: validateSupply

            // updateInterestRates
            let rateStrategy: ReserveInterestRateStrategy = self.reserveInterestRateStrategy.get(matchedReserve!!)!!;
            reserveData.updateInterestRates(reserveCache, rateStrategy, supplyAmount, 0);
            // update liquidity and set reserveData to storage back;
            let scaledSupplyAmount: Int = supplyAmount.rayDiv(reserveCache.nextLiquidityIndex);
            reserveData.availableLiquidity += supplyAmount;
            reserveData.totalSupply += scaledSupplyAmount;
            self.reservesData.set(matchedReserve!!, reserveData);

            self.updateUserAccountPosition(msg.from, matchedReserve!!, scaledSupplyAmount, 0);
        }

        // use crc32 code of 'Repay': utils.calculateRequestOpcode_1('Repay')
        if (opCode == 0x9c797a9) {
            let repayAmount: Int = msg.amount;
            // TODO: validate repay
            // reserve.totalBorrow >= scaledBorrowAmount?

            // updateInterestRates
            let rateStrategy: ReserveInterestRateStrategy = self.reserveInterestRateStrategy.get(matchedReserve!!)!!;
            reserveData.updateInterestRates(reserveCache, rateStrategy, repayAmount, 0);
            // update liquidity and set reserveData to storage back;
            let scaledBorrowAmount: Int = repayAmount.rayDiv(reserveCache.nextBorrowIndex);
            reserveData.availableLiquidity += repayAmount;
            reserveData.totalBorrow -= scaledBorrowAmount;
            self.reservesData.set(matchedReserve!!, reserveData);

            self.updateUserAccountPosition(msg.from, matchedReserve!!, 0, -scaledBorrowAmount);
        }
    }

    fun updateUserAccountPosition(ownerAddress: Address, reserveAddress: Address, supply: Int, borrow: Int) {
        let queryId: Int = self.queryId;
        let userAccountInit: StateInit = self.getUserAccountInit(ownerAddress);
        let userAccountAddress: Address = contractAddress(userAccountInit);
        let msg: UpdatePosition = UpdatePosition{
            queryId: queryId,
            address: reserveAddress,
            supply: supply,
            borrow: borrow
        };
        let updatePositionBounce: UpdatePositionBounce = UpdatePositionBounce{
            to: userAccountAddress,
            user: ownerAddress,
            msg: msg
        };
        
        self.updatePositionMsg.set(queryId, updatePositionBounce);
        self.queryId += 1;
        
        send(SendParameters{
            to: userAccountAddress,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: msg.toCell(),
            code: userAccountInit.code,
            data: userAccountInit.data
        });
    }

    // rerun the stored UpdatePositionMsg which isn't deleted in the UserPositionUpdated.
    fun rerunUpdatePositionMsg(queryId: Int) {
        let bounce: UpdatePositionBounce = self.updatePositionMsg.get(queryId)!!;

        let userAccountInit: StateInit = self.getUserAccountInit(bounce.user);
        let userAccountAddress: Address = contractAddress(userAccountInit);

        send(SendParameters{
            to: bounce.to,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: bounce.msg.toCell(),
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
}
