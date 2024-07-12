import "./atoken-master";
message Mint {
    amount: Int;
    receiver: Address;
}
struct PoolDataInAToken {
    pool: Address;
    asset: Address;
}

contract AToken with ATokenJettonTrait {
    totalSupply: Int as coins;
    owner: Address; // PoolAddress
    content: Cell;
    mintable: Bool;
    asset: Address; // atoken underlying asset
    init(owner: Address, content: Cell, asset: Address){
        self.totalSupply = 0;
        self.owner = owner;
        self.mintable = true;
        self.content = content;
        self.asset = asset;
    }

    receive(msg: Mint){
        let ctx: Context = context();
        require(ctx.sender == self.owner, "Not Owner"); // comment this for tests
        require(self.mintable, "Can't Mint Anymore");
        self.mint(msg.receiver, msg.amount, self.owner); // (to, amount, response_destination)
    }

    // ====== Get Methods ====== //

    get fun get_pool_data(): PoolDataInAToken {
        return PoolDataInAToken{pool: self.owner, asset: self.asset};
    }
}