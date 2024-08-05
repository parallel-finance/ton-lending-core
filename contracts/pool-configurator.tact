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
    reserveInterestRateStrategy: map<Address, ReserveInterestRateStrategy>;
    // oracle provider address
    oracleProvider: Address?;
    // ACL admins
    admins: map<Int, RoleData>;
    // bounce messages
    updatePositionMsg: map<Int, UpdatePositionBounce>;

    receive(msg: AddReserve){
        self.requireNotStopped();
        self.requireAssetListingAdmin();
        self.addReserve(msg.reserveAddress, msg.reserveConfiguration, msg.contents, msg.reserveInterestRateStrategy);
        self.reply("Reserve added".asComment());
    }

    receive(msg: DropReserve){
        self.requireNotStopped();
        self.requirePoolAdmin();
        self.dropReserve(msg.reserveIndex);
        self.reply("Reserve dropped".asComment());
    }

    receive(msg: UpdateReserveConfiguration){
        // TODO ACL check
        self.reservesConfiguration.set(msg.reserve, msg.reserveConfiguration);
    }

    // Notice: Only for Test
    receive(msg: SetMockOraclePrice){
        let reserveData: ReserveData = self.reservesData.get(msg.asset)!!;
        reserveData.price = msg.price;
        self.reservesData.set(msg.asset, reserveData);
    }

    // update oracle provider address
    receive(msg: UpdateOracleProvider){
        // self.requireOwner();
        // TODO: add ACL check
        self.oracleProvider = msg.oracle;
    }

    fun addReserve(reserveAddress: Address,
        reserveConfiguration: ReserveConfiguration,
        contents: ATokenDTokenContents,
        interestRateStrategy: ReserveInterestRateStrategy) {
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
        let lastReserveIndex: Int = (self.reservesLength - 1);
        let lastReserveAddress: Address = self.reserves.get(lastReserveIndex)!!;
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
}