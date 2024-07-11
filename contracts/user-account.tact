import "@stdlib/deploy";

struct TokenData {
    supply: Int as int128;
    borrow: Int as int128;
    asCollateral: Bool;
}

message UpdatePosition {
    queryId: Int as uint64;
    address: Address;
    supply: Int as int128;
    borrow: Int as int128;
}

struct UpdatePositionResponse {
    positions: map<Int, Address>;
    positionsLength: Int;
    positionsDetail: map<Address, TokenData>;
}

contract UserAccount with Deployable {
    owner: Address;
    master: Address;

    positions: map<Int, Address>;
    positionsLength: Int as uint16 = 0;
    positionsDetail: map<Address, TokenData>;

    init(master: Address, owner: Address) {
        self.owner = owner;
        self.master = master;
    }

    fun requireMaster() {
        require(context().sender == self.master, "Invalid sender");
    }

    fun processUpdatePosition(position: UpdatePosition) {
        let existingTokenData: TokenData? = self.positionsDetail.get(position.address);
        if (existingTokenData == null) {
            self.positions.set(self.positionsLength, position.address);
            self.positionsDetail.set(position.address, TokenData{
                supply: position.supply,
                borrow: position.borrow,
                asCollateral: true
            });
            self.positionsLength += 1;
        } else {
            let currentTokenData: TokenData = self.positionsDetail.get(position.address)!!;
            let updatedTokenData: TokenData = TokenData{
                supply: currentTokenData.supply + position.supply,
                borrow: currentTokenData.borrow + position.borrow,
                asCollateral: currentTokenData.asCollateral
            };
            self.positionsDetail.set(position.address, updatedTokenData);
        }
    }

    receive(msg: UpdatePosition) {
        self.requireMaster();
        self.processUpdatePosition(msg);
        // TODO: consider return the updated position data?
        self.reply("Position updated".asComment());
    }

    get fun account(): UpdatePositionResponse {
        return UpdatePositionResponse{
            positions: self.positions,
            positionsLength: self.positionsLength,
            positionsDetail: self.positionsDetail
        };
    }
}
