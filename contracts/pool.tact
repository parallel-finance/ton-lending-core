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
import "./pool-configurator";
import "./pool-acl";

contract Pool with Deployable, Ownable, Resumable, PoolView, PoolConfigurator, PoolACL {
    const MIN_TONS_FOR_STORAGE: Int = ton("0.03");
    const TOKEN_TRANSFER_GAS_CONSUMPTION: Int = ton("0.05");
    const TOKEN_MINT_GAS_CONSUMPTION: Int = ton("0.05");
    const TOKEN_BURN_GAS_CONSUMPTION: Int = ton("0.05");
    // update user account, process the response
    const SUPPLY_REPAY_GAS_CONSUMPTION: Int = ton("0.05");
    // check health factor, update user account, process the response
    const BORROW_GAS_CONSUMPTION: Int = ton("0.1");
    // check health factor, update user account, process the response
    const WITHDRAW_GAS_CONSUMPTION: Int = ton("0.1");
    // check health factor, update user account * 2, process the response * 2
    const LIQUIDATION_GAS_CONSUMPTION: Int = ton("0.15");

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
    // ACL admins
    admins: map<Int, RoleData>;

    // bounce messages
    updatePositionMsg: map<Int, UpdatePositionBounce>;

    // user reentrancy lock
    userLock: map<Address, Bool>;

    init() {
        self.owner = sender();
        self.stopped = false;
        self._acl_initialize(self.owner());
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
        self.requireFromUserAccount(msg.user);
        // delete stored updatePositionMsg
        self.updatePositionMsg.del(msg.queryId);
        // release user reentrancy lock
        self.releaseUserLock(msg.user);

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
        self.requireNotStopped();
        let reserveAddress: Address = msg.tokenAddress;
        let optionalReserveConfiguration: ReserveConfiguration? = self.reservesConfiguration.get(reserveAddress);
        require(optionalReserveConfiguration != null, "Reserve not supported");

        let ctx: Context = context();
        let fwdFee: Int = ctx.readForwardFee() * 5;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE;
        let computationAndActionFee: Int = self.TOKEN_TRANSFER_GAS_CONSUMPTION + self.TOKEN_MINT_GAS_CONSUMPTION + self.BORROW_GAS_CONSUMPTION;
        let totalFee: Int = fwdFee + storageFee + computationAndActionFee;
        require(ctx.value > totalFee, "Insufficient fee");

        let user: Address = sender();
        self.requireUserNotLocked(user);
        self.lockUser(user);

        // send message to get user account data
        let userAccountAddress: Address = self.userAccountAddress(user);
        // GetUserAccountData don't need to handle bounce
        send(SendParameters{
            to: userAccountAddress,
            value: 0,
            bounce: false,
            mode: SendRemainingValue,
            body: GetUserAccountData{
                queryId: self.queryId,
                user: user,
                action: ACTION_BORROW,
                tokenAddress: reserveAddress,
                amount: msg.amount,
                payload: emptySlice()
            }.toCell()
        });
        self.queryId += 1;
    }

    receive(msg: WithdrawToken) {
        self.requireNotStopped();
        let reserveAddress: Address = msg.tokenAddress;
        let optionalReserveConfiguration: ReserveConfiguration? = self.reservesConfiguration.get(reserveAddress);
        require(optionalReserveConfiguration != null, "Reserve not supported");

        let ctx: Context = context();
        let fwdFee: Int = ctx.readForwardFee() * 5;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE;
        let computationAndActionFee: Int = self.TOKEN_TRANSFER_GAS_CONSUMPTION + self.TOKEN_BURN_GAS_CONSUMPTION + self.WITHDRAW_GAS_CONSUMPTION;
        let totalFee: Int = fwdFee + storageFee + computationAndActionFee;
        require(ctx.value > totalFee, "Insufficient fee");

        // send message to get user account data
        let userAccountAddress: Address = self.userAccountAddress(sender());
        // GetUserAccountData don't need handle bounce
        send(SendParameters{
            to: userAccountAddress,
            value: 0,
            bounce: false,
            mode: SendRemainingValue,
            body: GetUserAccountData{
                queryId: self.queryId,
                user: sender(),
                action: ACTION_WITHDRAW,
                tokenAddress: msg.tokenAddress,
                amount: msg.amount,
                payload: emptySlice()
            }.toCell()
        });
        self.queryId += 1;
    }

    // bounced(src: bounced<GetUserAccountData>){
    //     self.releaseUserLock(src.user);
    // }

    // bounced(src: bounced<UpdatePosition>){
    //     self.releaseUserLock(src.user);
    // }

    receive(msg: UserAccountDataResponse) {
        self.requireFromUserAccount(msg.user);
        let ctx: Context = context();
        let reserveAddress: Address = msg.tokenAddress;

        let healthInfo: UserAccountHealthInfo = self.validateForAction(msg);

        let reserveData: ReserveData = self.reservesData.get(reserveAddress)!!;
        let reserveConfiguration: ReserveConfiguration = self.reservesConfiguration.get(reserveAddress)!!;
        let reserveCache: ReserveCache = reserveData.cache(reserveConfiguration);
        // _updateIndexes and _accrueToTreasury
        reserveCache = reserveData.updateState(reserveCache);

        let rateStrategy: ReserveInterestRateStrategy = self.reservesInterestRateStrategy.get(reserveAddress)!!;

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

            let selfConsumption: Int = self.BORROW_GAS_CONSUMPTION + self.TOKEN_TRANSFER_GAS_CONSUMPTION + ctx.readForwardFee() * 2;
            let remainingValue: Int = self.remainingValue(ctx.value, selfConsumption);
            self.updateUserAccountPosition(msg.user, msg.tokenAddress, 0, scaledBorrowAmount, remainingValue);
            // Transfer borrowAmount Token(tokenAddress) to the user.
            let poolWalletAddress: Address = reserveConfiguration.poolWalletAddress;
            if (poolWalletAddress == myAddress()) {
                // The ton received should be borrowAmount + remaining value
                send(SendParameters{
                    to: msg.user,
                    value: borrowAmount,
                    bounce: false,
                    mode: SendRemainingValue,
                    body: emptyCell(),
                });
            } else {
                self.sendTokenTransferByPool(poolWalletAddress, msg.user, borrowAmount);
            }
        }

        if(msg.action == ACTION_WITHDRAW) {
            let withdrawAmount: Int = msg.amount;
            let userReservePosition: TokenData = msg.accountData.positionsDetail.get(reserveAddress)!!;
            let userSupplyPosition: Int = userReservePosition.supply.rayMul(reserveCache.nextLiquidityIndex);
            if (withdrawAmount == UINT256_MAX) {
                withdrawAmount = userSupplyPosition;
            }

            // updateInterestRates
            reserveData.updateInterestRates(reserveCache, rateStrategy, 0, withdrawAmount);
            // update (scaled) total supply and available liquidity
            let scaledWithdrawAmount: Int = withdrawAmount.rayDiv(reserveCache.nextLiquidityIndex);
            reserveData.availableLiquidity -= withdrawAmount;
            reserveData.totalSupply -= scaledWithdrawAmount;
            // set reserveData to storage back
            self.reservesData.set(reserveAddress, reserveData);

            let selfConsumption: Int = self.WITHDRAW_GAS_CONSUMPTION + self.TOKEN_TRANSFER_GAS_CONSUMPTION + ctx.readForwardFee() * 2;
            let remainingValue: Int = self.remainingValue(ctx.value, selfConsumption);
            self.updateUserAccountPosition(msg.user, msg.tokenAddress, -scaledWithdrawAmount, 0, remainingValue);

            // Transfer withdrawAmount Token(tokenAddress) to the user.
            let poolWalletAddress: Address = reserveConfiguration.poolWalletAddress;
            if (poolWalletAddress == myAddress()) {
                // The ton received should be withdrawAmount + remaining value
                send(SendParameters{
                    to: msg.user,
                    value: withdrawAmount,
                    bounce: false,
                    mode: SendRemainingValue,
                    body: emptyCell(),
                });
            } else {
                self.sendTokenTransferByPool(poolWalletAddress, msg.user, withdrawAmount);
            }
        }

        if(msg.action == ACTION_REPAY) {
            let repayAmount: Int = msg.amount;
            let userReservePosition: TokenData = msg.accountData.positionsDetail.get(reserveAddress)!!;
            let userBorrowPosition: Int = userReservePosition.borrow.rayMul(reserveCache.nextBorrowIndex);
            if (repayAmount > userBorrowPosition) {
                repayAmount = userBorrowPosition;
            }

            // updateInterestRates
            reserveData.updateInterestRates(reserveCache, rateStrategy, repayAmount, 0);
            // update liquidity and set reserveData to storage back;
            let scaledRepayAmount: Int = repayAmount.rayDiv(reserveCache.nextBorrowIndex);
            reserveData.availableLiquidity += repayAmount;
            require(reserveData.totalBorrow >= scaledRepayAmount, "scaled totalBorrow overflow");
            reserveData.totalBorrow -= scaledRepayAmount;
            self.reservesData.set(reserveAddress, reserveData);

            let selfConsumption: Int = self.SUPPLY_REPAY_GAS_CONSUMPTION + ctx.readForwardFee();
            let remainingValue: Int = self.remainingValue(ctx.value, selfConsumption);
            self.updateUserAccountPosition(msg.user, reserveAddress, 0, -scaledRepayAmount, remainingValue);
        }

        if (msg.action == ACTION_LIQUIDATION) {
            let liquidation: Liquidation = Liquidation.fromCell(msg.payload.loadRef());
            let liquidationAmount: Int = msg.amount;
            let collateralReserve: Address = liquidation.collateralReserve;
            let liquidator: Address = liquidation.liquidator;

            // check borrower debt and collateral are not zero
            let userLiquidationPosition: TokenData? = msg.accountData.positionsDetail.get(reserveAddress);
            let userCollateralPosition: TokenData? = msg.accountData.positionsDetail.get(collateralReserve);
            require(userLiquidationPosition != null && userLiquidationPosition!!.borrow != 0, "user didn't borrow this debt");
            require(userCollateralPosition != null && userCollateralPosition!!.supply != 0, "user didn't supply this collateral");

            // fetch collateral ReserveData and ReserveConfiguration
            let collateralReserveData: ReserveData = self.reservesData.get(collateralReserve)!!;
            let collateralReserveConfiguration: ReserveConfiguration = self.reservesConfiguration.get(collateralReserve)!!;
            // calculate collateral nextLiquidityIndex
            let collateralNextLiquidityIndex: Int = collateralReserveData.getNormalizedIncome();

            // calculte liquidation closeFactor
            let closeFactor: Int = healthInfo.healthFactorInRay > CLOSE_FACTOR_HF_THRESHOLD ?
                DEFAULT_LIQUIDATION_CLOSE_FACTOR :
                MAX_LIQUIDATION_CLOSE_FACTOR;
            // calculate actual liquidationAmount = min(userDebt, the debt token amount that liquidator transferred)
            let userDebt: Int = userLiquidationPosition!!.borrow.rayMul(reserveCache.nextBorrowIndex).percentMul(closeFactor);
            let actualLiquidationAmount: Int = min(liquidationAmount, userDebt);
            // calculate user collateral amount
            let userCollateral: Int = userCollateralPosition!!.supply.rayMul(collateralNextLiquidityIndex);

            let collateralUint: Int = pow(10, collateralReserveConfiguration.decimals);
            let debtUint: Int = pow(10, reserveConfiguration.decimals);
            
            // calculate the max collateral amount based on the actualLiquidationAmount
            let maxCollateralToLiquidate: Int = (
                (reserveData.price * actualLiquidationAmount * collateralUint) / (collateralReserveData.price * debtUint)
            ).percentMul(collateralReserveConfiguration.liquidationBonus);

            // if user collateral amount can't cover `maxCollateralToLiquidate`, calculate the actualLiquidationAmount based on the user collateral
            let actualCollateralToLiquidate: Int = 0;
            if (maxCollateralToLiquidate > userCollateral) {
                actualCollateralToLiquidate = userCollateral;
                actualLiquidationAmount = (
                    (collateralReserveData.price * actualCollateralToLiquidate * debtUint) / (reserveData.price * collateralUint)
                ).percentDiv(collateralReserveConfiguration.liquidationBonus);
            } else {
                actualCollateralToLiquidate = maxCollateralToLiquidate;
            }

            // calculate the liquidation protocol fee = liquidation Bouns * configuration.liquidationProtocolFee
            let liquidationFee: Int = 0;
            if (collateralReserveConfiguration.liquidationProtocolFee != 0) {
                let bonusCollateral: Int = actualCollateralToLiquidate - 
                    actualCollateralToLiquidate.percentDiv(collateralReserveConfiguration.liquidationBonus);
                liquidationFee = bonusCollateral.percentMul(collateralReserveConfiguration.liquidationProtocolFee);
                // actualCollateralToLiquidate = actualCollateralToLiquidate - liquidationFee;
            }

            let poolWalletAddress: Address = collateralReserveConfiguration.poolWalletAddress;
            if (poolWalletAddress == myAddress()) {
                // The ton received should only be withdrawAmount
                send(SendParameters{
                    to: liquidator,
                    value: actualCollateralToLiquidate - liquidationFee,
                    bounce: false,
                    mode: 0,
                    body: emptyCell(),
                });
                send(SendParameters{
                    to: collateralReserveConfiguration.treasury,
                    value: liquidationFee,
                    bounce: false,
                    mode: 0,
                    body: emptyCell(),
                });
            } else {
                // Transfer collateral Token to the liquidator.
                self.sendTokenTransferByPool(poolWalletAddress, liquidator, actualCollateralToLiquidate - liquidationFee);
                // Transfer collateral Token to the reserve treasury.
                self.sendTokenTransferByPool(poolWalletAddress, collateralReserveConfiguration.treasury, liquidationFee);
            }

            
            
            // update user debt token position and burn dToken
            let scaledLiquidationAmount: Int = actualLiquidationAmount.rayDiv(reserveCache.nextBorrowIndex);
            reserveData.totalBorrow -= scaledLiquidationAmount;
            reserveCache.nextScaledDebt = reserveData.totalBorrow;

            reserveData.updateInterestRates(reserveCache, rateStrategy, actualLiquidationAmount, 0);
            
            reserveData.availableLiquidity += actualLiquidationAmount;
            self.reservesData.set(reserveAddress, reserveData);

            let selfConsumption: Int = self.LIQUIDATION_GAS_CONSUMPTION + self.TOKEN_TRANSFER_GAS_CONSUMPTION * 2 + ctx.readForwardFee() * 4;
            let remainingValue: Int = self.remainingValue(ctx.value, selfConsumption);
            self.updateUserAccountPosition(msg.user, reserveAddress, 0, -scaledLiquidationAmount, remainingValue / 2);

            // update user collateral token position and burn aToken
            collateralReserveData = self.reservesData.get(collateralReserve)!!;
            let collateralReserveCache: ReserveCache = collateralReserveData.cache(collateralReserveConfiguration);

            collateralReserveCache = collateralReserveData.updateState(collateralReserveCache);
            collateralReserveData.updateInterestRates(collateralReserveCache, rateStrategy, 0, actualCollateralToLiquidate);

            let scaledCollateralAmount: Int = actualCollateralToLiquidate.rayDiv(collateralReserveCache.nextLiquidityIndex);
            collateralReserveData.availableLiquidity -= actualCollateralToLiquidate;
            collateralReserveData.totalSupply -= scaledCollateralAmount;
            self.reservesData.set(collateralReserve, collateralReserveData);

            self.updateUserAccountPosition(msg.user, collateralReserve, -scaledCollateralAmount, 0, remainingValue / 2);
        }

        if (msg.action == ACTION_TRANSFER_ATOKEN) {
            let userATokenWallet: Address = self.userATokenWalletAddress(msg.tokenAddress, msg.user);
            // send TokenTransferByPool back to aTokenWallet
            send(SendParameters{
                to: userATokenWallet,
                value: 0,
                bounce: true,
                mode: SendRemainingValue,
                body: TokenTransferByPool{
                    payload: msg.payload
                }.toCell()
            });
        }
    }

    receive(msg: TokenExcesses) {
        // TODO: consider store the token transfer data and transfer token here
    }

    receive(msg: RerunBounceMsg) {
        if (msg.action == RERUN_ACTION_UPDATE_POSITION) {
            self.rerunUpdatePositionMsg(msg.queryId);
        }
    }

    receive(msg: SupplyTon) {
        self.requireNotStopped();
        let reserveAddress: Address = myAddress();
        let optionalReserveData: ReserveData? = self.reserveData(reserveAddress);
        require(optionalReserveData != null, "Reserve not supported");
        let reserveData: ReserveData = optionalReserveData!!;

        let ctx: Context = context();
        let fwdFee: Int = ctx.readForwardFee() * 3;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE;
        let computationAndActionFee: Int = self.TOKEN_MINT_GAS_CONSUMPTION + self.SUPPLY_REPAY_GAS_CONSUMPTION;
        let totalFee: Int = fwdFee + storageFee + computationAndActionFee;
        require(ctx.value > totalFee + msg.amount, "Insufficient fee");

        let reserveConfiguration: ReserveConfiguration = self.reservesConfiguration.get(reserveAddress)!!;
        let reserveCache: ReserveCache = reserveData.cache(reserveConfiguration);
        // _updateIndexes and _accrueToTreasury
        reserveCache = reserveData.updateState(reserveCache);

        let supplyAmount: Int = msg.amount;
        require(supplyAmount > 0, "amount zero");
        require(reserveConfiguration.isActive, "Token inactive");
        require(!reserveConfiguration.isFrozen, "Token Frozen");
        let reserveUint: Int = pow(10, reserveConfiguration.decimals);
        require(
            reserveConfiguration.supplyCap == 0 ||
            supplyAmount + reserveData.totalSupply.rayMul(reserveCache.nextLiquidityIndex) <= reserveConfiguration.supplyCap * reserveUint,
            "Supply cap is exceeded"
        );

        // updateInterestRates
        let rateStrategy: ReserveInterestRateStrategy = self.reservesInterestRateStrategy.get(reserveAddress)!!;
        reserveData.updateInterestRates(reserveCache, rateStrategy, supplyAmount, 0);
        // update liquidity and set reserveData to storage back;
        let scaledSupplyAmount: Int = supplyAmount.rayDiv(reserveCache.nextLiquidityIndex);
        reserveData.availableLiquidity += supplyAmount;
        reserveData.totalSupply += scaledSupplyAmount;
        self.reservesData.set(reserveAddress, reserveData);

        let remainingValue: Int = self.remainingValue(ctx.value, self.SUPPLY_REPAY_GAS_CONSUMPTION + ctx.readForwardFee());
        self.updateUserAccountPosition(ctx.sender, reserveAddress, scaledSupplyAmount, 0, remainingValue);
    }

    receive(msg: BorrowTon) {
        self.requireNotStopped();
        let reserveAddress: Address = myAddress();
        let optionalReserveData: ReserveData? = self.reserveData(reserveAddress);
        require(optionalReserveData != null, "Reserve not supported");

        let ctx: Context = context();
        let fwdFee: Int = ctx.readForwardFee() * 5;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE;
        let computationAndActionFee: Int = self.TOKEN_TRANSFER_GAS_CONSUMPTION + self.TOKEN_MINT_GAS_CONSUMPTION + self.BORROW_GAS_CONSUMPTION;
        let totalFee: Int = fwdFee + storageFee + computationAndActionFee;
        require(ctx.value > totalFee, "Insufficient fee");
        
        let user: Address = sender();
        self.requireUserNotLocked(user);
        self.lockUser(user);

        // send message to get user account data
        let userAccountAddress: Address = self.userAccountAddress(user);

        let remainingValue: Int = self.remainingValue(ctx.value, self.BORROW_GAS_CONSUMPTION + ctx.readForwardFee());
        // GetUserAccountData don'tSendRemainingValue need to handle bounce
        send(SendParameters{
            to: userAccountAddress,
            value: remainingValue,
            bounce: false,
            mode: SendPayGasSeparately,
            body: GetUserAccountData{
                queryId: self.queryId,
                user: user,
                action: ACTION_BORROW,
                tokenAddress: reserveAddress,
                amount: msg.amount,
                payload: emptySlice()
            }.toCell()
        });
        self.queryId += 1;
    }

    receive(msg: WithdrawTon) {
        let reserveAddress: Address = myAddress();
        let optionalReserveData: ReserveData? = self.reserveData(reserveAddress);
        require(optionalReserveData != null, "Reserve not supported");

        let ctx: Context = context();
        let fwdFee: Int = ctx.readForwardFee() * 5;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE;
        // TODO: TON transfer is cheaper than token transfer
        let computationAndActionFee: Int = self.TOKEN_TRANSFER_GAS_CONSUMPTION + self.TOKEN_BURN_GAS_CONSUMPTION + self.WITHDRAW_GAS_CONSUMPTION;
        let totalFee: Int = fwdFee + storageFee + computationAndActionFee;
        require(ctx.value > totalFee, "Insufficient fee");

        // send message to get user account data
        let userAccountAddress: Address = self.userAccountAddress(sender());

        let remainingValue: Int = self.remainingValue(ctx.value, self.WITHDRAW_GAS_CONSUMPTION + ctx.readForwardFee());
        // GetUserAccountData don'tSendRemainingValue need to handle bounce
        send(SendParameters{
            to: userAccountAddress,
            value: remainingValue,
            bounce: false,
            mode: SendPayGasSeparately,
            body: GetUserAccountData{
                queryId: self.queryId,
                user: sender(),
                action: ACTION_WITHDRAW,
                tokenAddress: reserveAddress,
                amount: msg.amount,
                payload: emptySlice()
            }.toCell()
        });
        self.queryId += 1;
    }

    receive(msg: RepayTon) {
        let reserveAddress: Address = myAddress();
        let optionalReserveData: ReserveData? = self.reserveData(reserveAddress);
        require(optionalReserveData != null, "Reserve not supported");
        let reserveData: ReserveData = optionalReserveData!!;

        let ctx: Context = context();
        let fwdFee: Int = ctx.readForwardFee() * 5;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE;
        let computationAndActionFee: Int = self.TOKEN_BURN_GAS_CONSUMPTION + self.SUPPLY_REPAY_GAS_CONSUMPTION;
        let totalFee: Int = fwdFee + storageFee + computationAndActionFee;
        require(ctx.value > totalFee, "Insufficient fee");

        let reserveConfigration: ReserveConfiguration = self.reservesConfiguration.get(reserveAddress)!!;
        let reserveCache: ReserveCache = reserveData.cache(reserveConfigration);
        // _updateIndexes and _accrueToTreasury
        reserveCache = reserveData.updateState(reserveCache);

        let repayAmount: Int = msg.amount;
        let user: Address = sender();
        let userAccountAddress: Address = self.userAccountAddress(user);
        let remainingValue: Int = self.remainingValue(ctx.value, self.SUPPLY_REPAY_GAS_CONSUMPTION + ctx.readForwardFee());
        send(SendParameters{
            to: userAccountAddress,
            value: remainingValue,
            bounce: true,
            mode: SendPayGasSeparately,
            body: GetUserAccountData{
                queryId: self.queryId,
                user: user,
                action: ACTION_REPAY,
                tokenAddress: reserveAddress,
                amount: repayAmount,
                payload: emptySlice()
            }.toCell()
        });
        self.queryId += 1;
    }

    receive(msg: LiquidateTon) {
        let debtReserve: Address = myAddress();
        let optionalDebtReserveData: ReserveData? = self.reserveData(debtReserve);
        require(optionalDebtReserveData != null, "Ton not supported");
        let reserveData: ReserveData = optionalDebtReserveData!!;

        let collateralReserve: ReserveData? = self.reservesData.get(msg.collateralReserve);
        require(collateralReserve != null, "Collateral reserve not found");

        let ctx: Context = context();
        let fwdFee: Int = ctx.readForwardFee() * 8;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE;
        let computationAndActionFee: Int = self.TOKEN_TRANSFER_GAS_CONSUMPTION * 2
            + self.TOKEN_BURN_GAS_CONSUMPTION * 2 
            + self.LIQUIDATION_GAS_CONSUMPTION;
        let totalFee: Int = fwdFee + storageFee + computationAndActionFee;
        require(ctx.value > totalFee, "Insufficient fee");

        let liquidationAmount: Int = msg.liquidationAmount;
        let liquidationMsg: Liquidation = Liquidation{
            liquidator: sender(),
            borrower: msg.borrower,
            liquidationReserve: debtReserve,
            collateralReserve: msg.collateralReserve,
            liquidationAmount: msg.liquidationAmount
        };

        let userAccountAddress: Address = self.userAccountAddress(msg.borrower);
        let payload: Slice = beginCell().storeRef(liquidationMsg.toCell()).asSlice();
        let remainingValue: Int = self.remainingValue(ctx.value, self.LIQUIDATION_GAS_CONSUMPTION + ctx.readForwardFee());

        send(SendParameters{
            to: userAccountAddress,
            value: remainingValue,
            bounce: true,
            mode: SendPayGasSeparately,
            body: GetUserAccountData{
                queryId: self.queryId,
                user: msg.borrower,
                action: ACTION_LIQUIDATION,
                tokenAddress: debtReserve,
                amount: liquidationAmount,
                payload: payload
            }.toCell()
        });
        self.queryId += 1;
    }

    receive(msg: SyncPrices) {
        self.syncPrices(msg);
    }

    receive(msg: MintToTreasury) {
        self.mintToTreasury(msg.reserve);
    }

    receive(msg: ReleaseUserLock) {
        let userAccount: Address = self.userAccountAddress(msg.user);
        let sender = sender();
        require(
            sender == userAccount || 
            self.hasRole(self.RISK_ADMIN_ROLE, sender), 
            "No access to release user lock"
        );
        self.releaseUserLock(msg.user);
    }

    fun syncPrices(msg: SyncPrices) {
        foreach (reserve, price in msg.prices) {
            let reserveData: ReserveData? = self.reservesData.get(reserve);
            if (reserveData != null) {
                let reserveDataAsserted: ReserveData = reserveData!!;
                reserveDataAsserted.price = price;
                self.reservesData.set(reserve, reserveDataAsserted);
            }
        }
        // Cashback
        send(SendParameters{
            to: msg.responseDestination,
            value: 0,
            bounce: false,
            mode: (SendRemainingValue + SendIgnoreErrors),
            body: emptyCell()
        });
    }

    fun remainingValue(value: Int, selfConsumption: Int): Int {
        let msgValue: Int = value;
        let tonBalanceBeforeMsg: Int = myBalance() - msgValue;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE - min(tonBalanceBeforeMsg, self.MIN_TONS_FOR_STORAGE);
        msgValue = msgValue - (storageFee + selfConsumption);
        return msgValue;
    }

    fun sendTokenTransferByPool(poolWalletAddress: Address, toAddress: Address, amount: Int) {
        let tokenTransferMsg: TokenTransfer = TokenTransfer{
            queryId: self.queryId,
            amount: amount,
            destination: toAddress,
            response_destination: toAddress,
            custom_payload: null,
            forward_ton_amount: 0,
            forward_payload: emptySlice()
        };
        self.queryId += 1;

        send(SendParameters{
            to: poolWalletAddress,
            value: self.TOKEN_TRANSFER_GAS_CONSUMPTION,
            bounce: true,
            mode: SendPayGasSeparately,
            body: tokenTransferMsg.toCell()
        });
    }

    fun validateForAction(msg: UserAccountDataResponse): UserAccountHealthInfo {
        let userAccountData: UserAccountData = msg.accountData;
        let reserve: Address = msg.tokenAddress;
        let amount: Int = msg.amount;

        let healthInfo: UserAccountHealthInfo = self.userAccountHealthInfo(userAccountData);
        let reserveData: ReserveData = self.reservesData.get(reserve)!!;
        let reserveConfiguration: ReserveConfiguration = self.reservesConfiguration.get(reserve)!!;
        if (msg.action == ACTION_BORROW) {
            // 1. check borrowingEnabled
            // 2. check reserve isActive / isFrozen
            // 3. check reserve availableLiquidity
            // 4. check borrow cap
            // 5. check HF for borrow
            require(reserveConfiguration.borrowingEnabled, "Borrowing disable for this token");
            require(reserveConfiguration.isActive, "Token inactive");
            require(!reserveConfiguration.isFrozen, "Token Frozen");
            require(reserveData.availableLiquidity >= amount, "invalid available liquidity");
            let reserveUint: Int = pow(10, reserveConfiguration.decimals);
            let normalizedDebt: Int = reserveData.getNormalizedDebt();
            require(
                reserveConfiguration.borrowCap == 0 ||
                amount + reserveData.totalBorrow.rayMul(normalizedDebt) <= reserveConfiguration.borrowCap * reserveUint,
                "Borrow cap is exceeded"
            );

            require(healthInfo.healthFactorInRay >= RAY, "HF < 1");
            let borrowAmountValue: Int = amount * reserveData.price / reserveUint;
            require(healthInfo.avgLtv != 0, "zero user avgLtv");
            let collateralNeeded: Int = borrowAmountValue.percentDiv(healthInfo.avgLtv);
            require(healthInfo.totalDebtInBaseCurrency + collateralNeeded <= healthInfo.totalSupplyInBaseCurrency, "collateral can't cover new borrow");
        }
        if (msg.action == ACTION_WITHDRAW) {
            // 1. check reserve isActive
            // 2. check reserve availableLiquidity
            // 3. check withdraw amount <= supply position
            // 4. check HF
            require(reserveConfiguration.isActive, "Token inactive");
            let withdrawAmount: Int = amount;

            let userReservePosition: TokenData? = userAccountData.positionsDetail.get(reserve);
            require(userReservePosition != null && userReservePosition!!.supply != 0, "zero supply position");

            let normalizedIncome: Int = reserveData.getNormalizedIncome();
            let userSupplyPosition: Int = userReservePosition!!.supply.rayMul(normalizedIncome);

            if (amount == UINT256_MAX) {
                withdrawAmount = userSupplyPosition;
            }
            require(reserveData.availableLiquidity >= withdrawAmount, "invalid available liquidity");
            require(reserveData.totalSupply >= withdrawAmount.rayDiv(normalizedIncome), "scaled totalSupply overflow");
            require(userSupplyPosition >= withdrawAmount, "invalid user supply position");

            require(healthInfo.healthFactorInRay >= RAY, "HF < 1");
            let reserveUint: Int = pow(10, reserveConfiguration.decimals);
            let withdrawValue: Int = withdrawAmount * reserveData.price / reserveUint;
            let withdrawValueMulLT: Int = withdrawValue.percentMul(reserveConfiguration.liquidationThreshold);
            let totalSupplyMulLT: Int = healthInfo.totalSupplyInBaseCurrency.percentMul(healthInfo.avgLiquidationThreshold);
            require(totalSupplyMulLT - withdrawValueMulLT >= healthInfo.totalDebtInBaseCurrency, "the left collateral can't cover debt");
        }
        if (msg.action == ACTION_REPAY) {
            // 1. check reserve isActive
            require(reserveConfiguration.isActive, "Token inactive");
            let userReservePosition: TokenData? = userAccountData.positionsDetail.get(reserve);
            require(userReservePosition != null && userReservePosition!!.borrow != 0, "zero borrow position");
        }
        if (msg.action == ACTION_LIQUIDATION) {
            require(healthInfo.healthFactorInRay < RAY, "HF >= 1");
            let liquidation: Liquidation = Liquidation.fromCell(msg.payload.loadRef());
            let collateralReserve: Address = liquidation.collateralReserve;
            let collateralReserveConfiguration: ReserveConfiguration = self.reservesConfiguration.get(collateralReserve)!!;
            let userCollateralPosition: TokenData = userAccountData.positionsDetail.get(collateralReserve)!!;
            require(collateralReserveConfiguration.liquidationThreshold != 0, "collateral can't be liquidated");
            require(collateralReserveConfiguration.isActive && reserveConfiguration.isActive, "reserve isn not active");
        }
        if (msg.action == ACTION_TRANSFER_ATOKEN) {
            require(reserveConfiguration.isActive, "Token inactive");
            let transferAmount: Int = amount;

            let userReservePosition: TokenData? = userAccountData.positionsDetail.get(reserve);
            require(userReservePosition != null && userReservePosition!!.supply >= transferAmount, "invalid aToken position");
            require(healthInfo.healthFactorInRay >= RAY, "HF < 1");

            let normalizedIncome: Int = reserveData.getNormalizedIncome();
            let userSupplyPosition: Int = userReservePosition!!.supply.rayMul(normalizedIncome);

            let reserveUint: Int = pow(10, reserveConfiguration.decimals);
            let transferValue: Int = transferAmount.rayMul(normalizedIncome) * reserveData.price / reserveUint;
            let transferValueMulLT: Int = transferValue.percentMul(reserveConfiguration.liquidationThreshold);
            let totalSupplyMulLT: Int = healthInfo.totalSupplyInBaseCurrency.percentMul(healthInfo.avgLiquidationThreshold);
            require(totalSupplyMulLT - transferValueMulLT >= healthInfo.totalDebtInBaseCurrency, "the left collateral can't cover debt");
        }

        return healthInfo;
    }

    fun mintAToken(asset: Address, user: Address, amount: Int) {
        let aTokenAddress: Address = self.reservesConfiguration.get(asset)!!.aTokenAddress;

        let mintMsg: Mint = Mint{
            queryId: self.queryId,
            amount: amount,
            receiver: user
        };
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
        let tokenBurnMsg: TokenBurn = TokenBurn{
            queryId: self.queryId,
            amount: amount,
            owner: user,
            response_destination: user
        };
        self.queryId += 1;
        let to: Address = self.userATokenWalletAddress(asset, user);

        send(SendParameters{
            to: to,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: tokenBurnMsg.toCell()
        });
    }

    fun burnDToken(asset: Address, user: Address, amount: Int) {
        let tokenBurnMsg: TokenBurn = TokenBurn{
            queryId: self.queryId,
            amount: amount,
            owner: user,
            response_destination: user
        };
        self.queryId += 1;
        let to: Address = self.userDTokenWalletAddress(asset, user);

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
        let mintMsg: Mint = Mint{
            queryId: self.queryId,
            amount: amount,
            receiver: user
        };
        self.queryId += 1;

        send(SendParameters{
            to: dTokenAddress,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: mintMsg.toCell()
        });
    }

    fun checkHFAndTransferAToken(msg: CheckAndTransferAToken) {
        let user: Address = msg.from;
        let userATokenWallet: Address = self.userATokenWalletAddress(msg.asset, user);
        require(sender() == userATokenWallet, "invalid sender");
        let userAccountAddress: Address = self.userAccountAddress(user);

        send(SendParameters{
            to: userAccountAddress,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: GetUserAccountData{
                queryId: self.queryId,
                user: user,
                action: ACTION_TRANSFER_ATOKEN,
                tokenAddress: msg.asset,
                amount: msg.amount,
                payload: msg.payload
            }.toCell()
        });
        self.queryId += 1;
    }

    fun processTokenNotification(msg: TokenNotification) {
        self.requireNotStopped();
        let matchedReserve: Address? = self.findReserveByPoolWalletAddress(context().sender);
        require(matchedReserve != null, "Reserve not found");

        let ctx: Context = context();
        let fwdFee: Int = ctx.readForwardFee() * 5;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE;
        let computationAndActionFee: Int = self.TOKEN_MINT_GAS_CONSUMPTION + self.SUPPLY_REPAY_GAS_CONSUMPTION;
        let totalFee: Int = fwdFee + storageFee + computationAndActionFee;
        require(ctx.value > totalFee, "Insufficient fee");
        // TODO: charge the storageFee here? Or just send the SendRemainingValue and pay as needed?

        let forwardPayload: Slice = msg.forward_payload;
        let opCode: Int = forwardPayload.loadUint(32);
        let reserveData: ReserveData = self.reserveData(matchedReserve!!);
        let reserveConfiguration: ReserveConfiguration = self.reservesConfiguration.get(matchedReserve!!)!!;
        let reserveCache: ReserveCache = reserveData.cache(reserveConfiguration);
        // _updateIndexes and _accrueToTreasury
        reserveCache = reserveData.updateState(reserveCache);

        // use crc32 code of 'Supply': utils.calculateRequestOpcode_1('Supply')
        if (opCode == 0x55b591ba) {
            let supplyAmount: Int = msg.amount;
            require(supplyAmount > 0, "amount zero");
            require(reserveConfiguration.isActive, "Token inactive");
            require(!reserveConfiguration.isFrozen, "Token Frozen");
            let reserveUint: Int = pow(10, reserveConfiguration.decimals);
            require(
                reserveConfiguration.supplyCap == 0 ||
                supplyAmount + reserveData.totalSupply.rayMul(reserveCache.nextLiquidityIndex) <= reserveConfiguration.supplyCap * reserveUint,
                "Supply cap is exceeded"
            );

            // updateInterestRates
            let rateStrategy: ReserveInterestRateStrategy = self.reservesInterestRateStrategy.get(matchedReserve!!)!!;
            reserveData.updateInterestRates(reserveCache, rateStrategy, supplyAmount, 0);
            // update liquidity and set reserveData to storage back;
            let scaledSupplyAmount: Int = supplyAmount.rayDiv(reserveCache.nextLiquidityIndex);
            reserveData.availableLiquidity += supplyAmount;
            reserveData.totalSupply += scaledSupplyAmount;
            self.reservesData.set(matchedReserve!!, reserveData);

            let selfConsumption: Int = self.SUPPLY_REPAY_GAS_CONSUMPTION + ctx.readForwardFee();
            let remainingValue: Int = self.remainingValue(ctx.value, selfConsumption);
            self.updateUserAccountPosition(msg.from, matchedReserve!!, scaledSupplyAmount, 0, remainingValue);
        }

        // use crc32 code of 'Repay': utils.calculateRequestOpcode_1('Repay')
        if (opCode == 0x9c797a9) {
            let repayAmount: Int = msg.amount;
            let user: Address = msg.from;
            let userAccountAddress: Address = self.userAccountAddress(user);
            send(SendParameters{
                to: userAccountAddress,
                value: 0,
                bounce: true,
                mode: SendRemainingValue,
                body: GetUserAccountData{
                    queryId: self.queryId,
                    user: user,
                    action: ACTION_REPAY,
                    tokenAddress: matchedReserve!!,
                    amount: repayAmount,
                    payload: emptySlice()
                }.toCell()
            });
            self.queryId += 1;
        }

        // use crc32 code of 'Liquidate': utils.calculateRequestOpcode_1('Liquidate')
        if (opCode == 0x1f03e59a) {
            // send message to get user account data
            // liquidation reserve
            let liquidationReserve: Address? = self.findReserveByPoolWalletAddress(context().sender);
            require(liquidationReserve != null, "Liquidation reserve not found");

            let borrower: Address = forwardPayload.loadAddress();
            // TODO risk: max supported token: 32
            let collateralIndex: Int = forwardPayload.loadUint(5);
            let collateralReserve: Address? = self.reserves.get(collateralIndex);
            require(collateralReserve != null, "Collateral reserve not found");

            let liquidationAmount: Int = msg.amount;
            let userAccountAddress: Address = self.userAccountAddress(borrower);
            // store collateralReserve
            let liquidationMsg: Liquidation = Liquidation{
                liquidator: msg.from,
                borrower: borrower,
                liquidationReserve: liquidationReserve!!,
                collateralReserve: collateralReserve!!,
                liquidationAmount: liquidationAmount
            };
            let payload: Slice = beginCell().storeRef(liquidationMsg.toCell()).asSlice();
            // TODO: This GetUserAccountData need to do bounce
            send(SendParameters{
                to: userAccountAddress,
                value: 0,
                bounce: true,
                mode: SendRemainingValue,
                body: GetUserAccountData{
                    queryId: self.queryId,
                    user: borrower,
                    action: ACTION_LIQUIDATION,
                    tokenAddress: liquidationReserve!!,
                    amount: liquidationAmount,
                    payload: payload
                }.toCell()
            });
            self.queryId += 1;
        }
    }

    fun updateUserAccountPosition(ownerAddress: Address, reserveAddress: Address, supply: Int, borrow: Int, msgValue: Int) {
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
        
        // TODO: more gas check
        send(SendParameters{
            to: userAccountAddress,
            value: msgValue,
            bounce: true,
            mode: SendPayGasSeparately,
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

    override fun findReserveByPoolWalletAddress(poolWalletAddress: Address): Address? {
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

    fun requireFromUserAccount(user: Address) {
        let userAccount: Address = self.userAccountAddress(user);
        require(userAccount == sender(), "Not from the user account");
    }

    fun mintToTreasury(reserve: Address) {
        let ctx: Context = context();
        let fwdFee: Int = ctx.readForwardFee() * 5;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE;
        let computationAndActionFee: Int = self.TOKEN_MINT_GAS_CONSUMPTION + self.SUPPLY_REPAY_GAS_CONSUMPTION;
        let totalFee: Int = fwdFee + storageFee + computationAndActionFee;
        require(ctx.value > totalFee, "Insufficient fee");

        let reserveData: ReserveData = self.reservesData.get(reserve)!!;
        let reserveConfiguration: ReserveConfiguration = self.reservesConfiguration.get(reserve)!!;
        
        // scaled amount
        let accruedToTreasury: Int = reserveData.accruedToTreasury;
        reserveData.accruedToTreasury = 0;
        reserveData.totalSupply += accruedToTreasury;

        self.reservesData.set(reserve, reserveData);
        
        let selfConsumption: Int = self.SUPPLY_REPAY_GAS_CONSUMPTION + ctx.readForwardFee();
        let remainingValue: Int = self.remainingValue(ctx.value, selfConsumption);

        self.updateUserAccountPosition(reserveConfiguration.treasury, reserve, accruedToTreasury, 0, remainingValue);
    }

    fun requireUserNotLocked(user: Address) {
        require(self.userLock.get(user) != true, "User Reentrancy Locked");
    }

    fun lockUser(user: Address) {
        self.userLock.set(user, true);
    }

    fun releaseUserLock(user: Address) {
        self.userLock.del(user);
    }
}
