import "@stdlib/deploy";
import "@stdlib/ownable";
import "@stdlib/stoppable";
import "./user-account";
import "./jetton/assetToken/atoken";
import "./jetton/assetToken/atoken-wallet";
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
        // for repay
        // for borrow
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
                borrower: context().sender,
                action: ACTION_BORROW,
                tokenAddress: msg.tokenAddress,
                amount: msg.amount
            }.toCell()
        });
        self.queryId += 1;
    }

    receive(msg: UserAccountDataResponse) {
        // check if the request is for borrow
        if(msg.action == 0) {
            let userAccountData: UserAccountData = msg.accountData;
            let isHealthy: Bool = self.isHealthyForAction(msg.action, msg.amount, userAccountData, self.reservesData);
            if (isHealthy) {
                let borrowAmount: Int = msg.amount;
                let reserveAddress: Address = msg.tokenAddress;
                let reserveData: ReserveData = self.reservesData.get(reserveAddress)!!;
                let reserveConfigration: ReserveConfiguration = self.reservesConfiguration.get(reserveAddress)!!;
                let reserveCache: ReserveCache = reserveData.cache(reserveConfigration);
                // _updateIndexes and _accrueToTreasury
                reserveCache = reserveData.updateState(reserveCache);

                // updateInterestRates
                let rateStrategy: ReserveInterestRateStrategy = self.reserveInterestRateStrategy.get(reserveAddress)!!;
                reserveData.updateInterestRates(reserveCache, rateStrategy, 0, borrowAmount);

                // update liquidity and set reserveData to storage back;
                let scaledBorrowAmount: Int = borrowAmount.rayDiv(reserveCache.nextBorrowIndex);
                reserveData.availableLiquidity -= borrowAmount;
                reserveData.totalBorrow += scaledBorrowAmount;
                self.reservesData.set(reserveAddress, reserveData);
                self.updateUserAccountPosition(msg.queryId, msg.borrower, msg.tokenAddress, 0, scaledBorrowAmount);
            }
        }
    }

    fun isHealthyForAction(action: Int, amount: Int, userAccountData: UserAccountData, reservesData: map<Address, ReserveData>): Bool {
        return true;
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
        lastUpdateTimestamp: now
        };
        self.reserveInterestRateStrategy.set(reserveAddress, interestRateStrategy);
        self.reserves.set(self.reservesLength, reserveAddress);
        self.reservesData.set(reserveAddress, newReserveData);
        self.reservesLength += 1;
        // deploy atoken
        let aTokenAddress: Address = self.deployAToken(contents.aTokenContent, reserveAddress);
        reserveConfiguration.aTokenAddress = aTokenAddress;
        // TODO deploy debtToken
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
        self.reserves.set(reserveIndex, lastReserveAddress);
        self.reserves.set(lastReserveIndex, null);
        self.reservesData.set(reserveAddress, null);
        self.reservesConfiguration.set(reserveAddress, null);
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

    get fun reserveConfiguration(reserveAddress: Address): ReserveConfiguration {
        return self.reservesConfiguration.get(reserveAddress)!!;
    }

    get fun calculateATokenAddress(content: Cell, reserveAddress: Address): Address {
        let sinit: StateInit = self.getAssetATokenInit(content, reserveAddress);
        let aTokenAddress: Address = contractAddress(sinit);
        return aTokenAddress;
    }

    get fun userATokenWalletAddress(asset: Address, user: Address): Address {
        let aToken: Address = self.reservesConfiguration.get(asset)!!.aTokenAddress;
        let sinit: StateInit = initOf ATokenDefaultWallet(aToken, myAddress(), asset, user);
        return contractAddress(sinit);
    }
}
