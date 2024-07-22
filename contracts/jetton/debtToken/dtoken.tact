import "./dtoken-master";
import "../messages";

struct PoolDataInDToken {
    pool: Address;
    asset: Address;
}

contract DToken with DTokenJettonTrait {
    owner: Address; // PoolAddress
    stopped: Bool;

    totalSupply: Int as coins;
    content: Cell;
    mintable: Bool;
    asset: Address; // dToken underlying asset
    init(owner: Address, content: Cell, asset: Address){
        self.totalSupply = 0;
        self.owner = owner;
        self.mintable = true;
        self.content = content;
        self.asset = asset;
        self.stopped = false;
    }

    receive(msg: Mint){
        let ctx: Context = context();
        self.requireOwner();
        self.requireNotStopped();
        require(self.mintable, "Can't Mint Anymore");
        self.mint(msg.receiver, msg.amount, self.owner); // (to, amount, response_destination)
    }

    // ====== Get Methods ====== //

    get fun get_pool_data(): PoolDataInDToken {
        return PoolDataInDToken{pool: self.owner, asset: self.asset};
    }
}
