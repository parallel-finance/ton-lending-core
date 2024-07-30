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
trait PoolConfigurator with Ownable, Resumable {
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
    // bounce messages
    updatePositionMsg: map<Int, UpdatePositionBounce>;

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
}