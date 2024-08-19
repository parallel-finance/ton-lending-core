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
import "./pool-acl";
import "./pool-view";
message ConfigureReserveAsCollateral {
    reserve: Address;
    ltv: Int as uint16;
    liquidationThreshold: Int as uint16;
    liquidationBonus: Int as uint16;
}
message SetReserveActive {
    reserve: Address;
    active: Bool;
}
message SetReserveFreeze {
    reserve: Address;
    freeze: Bool;
}
message SetReserveBorrowing {
    reserve: Address;
    enabled: Bool;
}
message SetReserveFactor {
    reserve: Address;
    reserveFactor: Int;
}
message SetSupplyCap {
    reserve: Address;
    supplyCap: Int;
}
message SetBorrowCap {
    reserve: Address;
    borrowCap: Int;
}
message SetLiquidationProtocolFee {
    reserve: Address;
    fee: Int;
}
message SetReserveInterestRateStrategy {
    reserve: Address;
    strategy: ReserveInterestRateStrategy;
}
message PausePool {
    paused: Bool;
}
message UpdateXTokenContent {
    token: Address;
    content: Cell;
}
message StopXToken {
    token: Address;
    stopped: Bool;
}
message RescueToken {
    wallet: Address;
    amount: Int;
    to: Address;
}
trait PoolConfigurator with Ownable, Resumable, PoolACL, PoolView {
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

    // requireAssetListingOrPoolAdmin
    receive(msg: AddReserve){
        self.requireNotStopped();
        self.requireAssetListingOrPoolAdmin();
        self.addReserve(msg.reserveAddress, msg.reserveConfiguration, msg.contents, msg.reserveInterestRateStrategy);
        self.reply("Reserve added".asComment());
    }

    // requirePoolAdmin
    receive(msg: DropReserve){
        self.requireNotStopped();
        self.requirePoolAdmin();
        self.dropReserve(msg.reserveIndex);
        self.reply("Reserve dropped".asComment());
    }

    // requireRiskOrPoolAdmin
    receive(msg: ConfigureReserveAsCollateral){
        self.requireRiskOrPoolAdmin();

        let _configuration: ReserveConfiguration? = self.reservesConfiguration.get(msg.reserve);
        require(_configuration != null, "reserve not found");
        let configuration: ReserveConfiguration = _configuration!!;
        let reserveData: ReserveData = self.reservesData.get(msg.reserve)!!;

        self.validateLTVAndLiquidationConfig(reserveData, msg.ltv, msg.liquidationThreshold, msg.liquidationBonus);

        configuration.ltv = msg.ltv;
        configuration.liquidationThreshold = msg.liquidationThreshold;
        configuration.liquidationBonus = msg.liquidationBonus;
        self.reservesConfiguration.set(msg.reserve, configuration);
        self.reply("ConfigureReserveAsCollateral successfully".asComment());
    }

    // requireEmergencyOrPoolAdmin or requirePoolAdmin
    receive(msg: SetReserveActive){
        if (msg.active == false) {
            self.requireEmergencyOrPoolAdmin();
        } else {
            self.requirePoolAdmin();
        }

        let _configuration: ReserveConfiguration? = self.reservesConfiguration.get(msg.reserve);
        require(_configuration != null, "reserve not found");
        let configuration: ReserveConfiguration = _configuration!!;

        configuration.isActive = msg.active;
        self.reservesConfiguration.set(msg.reserve, configuration);
        self.reply("SetReserveActive successfully".asComment());
    }

    // requireRiskOrPoolAdmin
    receive(msg: SetReserveFreeze){
        self.requireRiskOrPoolAdmin();

        let _configuration: ReserveConfiguration? = self.reservesConfiguration.get(msg.reserve);
        require(_configuration != null, "reserve not found");
        let configuration: ReserveConfiguration = _configuration!!;

        configuration.isFrozen = msg.freeze;
        self.reservesConfiguration.set(msg.reserve, configuration);
        self.reply("SetReserveFreeze successfully".asComment());
    }

    // requireRiskOrPoolAdmin
    receive(msg: SetReserveBorrowing){
        self.requireRiskOrPoolAdmin();
        
        let _configuration: ReserveConfiguration? = self.reservesConfiguration.get(msg.reserve);
        require(_configuration != null, "reserve not found");
        let configuration: ReserveConfiguration = _configuration!!;

        configuration.borrowingEnabled = msg.enabled;
        self.reservesConfiguration.set(msg.reserve, configuration);
        self.reply("SetReserveBorrowing successfully".asComment());
    }

    // requireRiskOrPoolAdmin
    receive(msg: SetReserveFactor){
        self.requireRiskOrPoolAdmin();
        
        let _configuration: ReserveConfiguration? = self.reservesConfiguration.get(msg.reserve);
        require(_configuration != null, "reserve not found");
        let configuration: ReserveConfiguration = _configuration!!;

        require(msg.reserveFactor <= PERCENTAGE_FACTOR, "Invalid reserve factor");

        configuration.reserveFactor = msg.reserveFactor;
        self.reservesConfiguration.set(msg.reserve, configuration);
        self.reply("SetReserveFactor successfully".asComment());
    }

    // requireRiskOrPoolAdmin
    receive(msg: SetSupplyCap){
        self.requireRiskOrPoolAdmin();

        let _configuration: ReserveConfiguration? = self.reservesConfiguration.get(msg.reserve);
        require(_configuration != null, "reserve not found");
        let configuration: ReserveConfiguration = _configuration!!;

        configuration.supplyCap = msg.supplyCap;
        self.reservesConfiguration.set(msg.reserve, configuration);
        self.reply("SetSupplyCap successfully".asComment());
    }

    // requireRiskOrPoolAdmin
    receive(msg: SetBorrowCap){
        self.requireRiskOrPoolAdmin();

        let _configuration: ReserveConfiguration? = self.reservesConfiguration.get(msg.reserve);
        require(_configuration != null, "reserve not found");
        let configuration: ReserveConfiguration = _configuration!!;

        configuration.borrowCap = msg.borrowCap;
        self.reservesConfiguration.set(msg.reserve, configuration);
        self.reply("SetBorrowCap successfully".asComment());
    }

    // requireRiskOrPoolAdmin
    receive(msg: SetLiquidationProtocolFee){
        self.requireRiskOrPoolAdmin();
        
        let _configuration: ReserveConfiguration? = self.reservesConfiguration.get(msg.reserve);
        require(_configuration != null, "reserve not found");
        let configuration: ReserveConfiguration = _configuration!!;

        configuration.liquidationProtocolFee = msg.fee;
        self.reservesConfiguration.set(msg.reserve, configuration);
        self.reply("SetLiquidationProtocolFee successfully".asComment());
    }

    // requireRiskOrPoolAdmin
    receive(msg: SetReserveInterestRateStrategy){
        self.requireRiskOrPoolAdmin();
        let strategy: ReserveInterestRateStrategy? = self.reservesInterestRateStrategy.get(msg.reserve);
        require(strategy != null, "reserve not found");
        self.reservesInterestRateStrategy.set(msg.reserve, msg.strategy);
        self.reply("SetReserveInterestRateStrategy successfully".asComment());
    }

    // requireEmergencyAdmin / requirePoolAdmin
    // set all reserve active or inactive
    receive(msg: PausePool){
        if (msg.paused == true) {
            self.requireEmergencyOrPoolAdmin();
        } else {
            self.requirePoolAdmin();
        }
        let reservesConfiguration: map<Address, ReserveConfiguration> = self.reservesConfiguration;
        foreach (reserve , configuration in reservesConfiguration) {
            configuration.isActive = !msg.paused;
            self.reservesConfiguration.set(reserve, configuration);
        }
        self.reply("PausePool successfully".asComment());
    }

    // requireRiskOrPoolAdmin
    // update dtoken/atoken content
    receive(msg: UpdateXTokenContent) {
        self.requireRiskOrPoolAdmin();
        send(SendParameters{
            to: msg.token,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: TokenUpdateContent{
                content: msg.content
            }.toCell()
        });
    }

    // requireEmergencyOrPoolAdmin / requirePoolAdmin
    // stop or resume dtoken/atoken
    receive(msg: StopXToken) {
        let message: Cell = emptyCell();
        if (msg.stopped == true) {
            self.requireEmergencyOrPoolAdmin();
            message = "Stop".asComment();
        } else {
            self.requirePoolAdmin();
            message = "Resume".asComment();
        }
        send(SendParameters{
            to: msg.token,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: message
        });
    }

    // requirePoolAdmin
    // update oracle provider address
    receive(msg: UpdateOracleProvider){
        self.requirePoolAdmin();
        self.oracleProvider = msg.oracle;
        self.reply("UpdateOracleProvider successfully".asComment());
    }

    // requirePoolAdmin
    // rescue token from Pool
    receive(msg: RescueToken){
        self.requirePoolAdmin();
        let reserve: Address? = self.findReserveByPoolWalletAddress(msg.wallet);
        require(reserve == null, "Invalid wallet of reserve");
        let tokenTransferMsg: TokenTransfer = TokenTransfer{
            queryId: 0,
            amount: msg.amount,
            destination: msg.to,
            response_destination: sender(),
            custom_payload: null,
            forward_ton_amount: 0,
            forward_payload: emptySlice()
        };
        send(SendParameters{
            to: msg.wallet,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: tokenTransferMsg.toCell()
        });
    }

    // Notice: Only for Test
    receive(msg: SetMockOraclePrice){
        let reserveData: ReserveData = self.reservesData.get(msg.asset)!!;
        reserveData.price = msg.price;
        self.reservesData.set(msg.asset, reserveData);
        self.reply("SetMockOraclePrice successfully".asComment());
    }

    fun addReserve(
        reserveAddress: Address,
        reserveConfiguration: ReserveConfiguration,
        contents: ATokenDTokenContents,
        interestRateStrategy: ReserveInterestRateStrategy
    ) {
        let existingReserveData: ReserveData? = self.reservesData.get(reserveAddress);
        require(existingReserveData == null, "Reserve already exists");

        let newReserveData: ReserveData = ReserveData{
            liquidityIndex: RAY,
            currentLiquidityRate: 0,
            borrowIndex: RAY,
            currentBorrowRate: 0,
            totalSupply: 0,
            availableLiquidity: 0,
            accruedToTreasury: 0,
            totalBorrow: 0,
            lastUpdateTimestamp: now(),
            price: 0
        };
        self.validateLTVAndLiquidationConfig(newReserveData,
            reserveConfiguration.ltv,
            reserveConfiguration.liquidationThreshold,
            reserveConfiguration.liquidationBonus
        );

        self.reservesInterestRateStrategy.set(reserveAddress, interestRateStrategy);
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
        let lastReserveIndex: Int = (self.reservesLength - 1);
        let lastReserveAddress: Address = self.reserves.get(lastReserveIndex)!!;
        if (reserveIndex != lastReserveIndex) {
            self.reserves.set(reserveIndex, lastReserveAddress);
        }
        self.reserves.set(lastReserveIndex, null);
        self.reservesData.set(reserveAddress, null);
        self.reservesConfiguration.set(reserveAddress, null);
        self.reservesInterestRateStrategy.set(reserveAddress, null);
        self.reservesLength -= 1;
    }

    fun validateDropReserve(reserveData: ReserveData) {
        require(reserveData.accruedToTreasury == 0, "Treasury share not zero");
        require(reserveData.totalSupply == 0, "Liability not zero");
        require(reserveData.totalBorrow == 0, "Debt not zero");
    }

    fun validateLTVAndLiquidationConfig(
        reserveData: ReserveData,
        ltv: Int,
        liquidationThreshold: Int,
        liquidationBonus: Int
    ) {
        //validation of the parameters: the LTV can
        //only be lower or equal than the liquidation threshold
        //(otherwise a loan against the asset would cause instantaneous liquidation)
        require(ltv <= liquidationThreshold, "Invalid reserve params");
        if (liquidationThreshold != 0) {
            //liquidation bonus must be bigger than 100.00%, otherwise the liquidator would receive less
            //collateral than needed to cover the debt
            require(liquidationBonus >= PERCENTAGE_FACTOR, "Invalid reserve params");
            //if threshold * bonus is less than PERCENTAGE_FACTOR, it's guaranteed that at the moment
            //a loan is taken there is enough collateral available to cover the liquidation bonus
            require(liquidationThreshold.percentMul(liquidationBonus) <= PERCENTAGE_FACTOR, "Invalid reserve params");
        } else {
            require(liquidationBonus == 0, "Invalid reserve params");
            //if the liquidation threshold is being set to 0,
            // the reserve is being disabled as collateral. To do so,
            //we need to ensure no liquidity is supplied
            require(reserveData.totalSupply == 0, "Liability not zero");
        }
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
            }
        );
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
            }
        );
        return dTokenAddress;
    }

    abstract fun findReserveByPoolWalletAddress(poolWalletAddress: Address): Address?;
}