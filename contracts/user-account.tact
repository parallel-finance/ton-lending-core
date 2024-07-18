import "@stdlib/deploy";
import "./types/message";

struct TokenData {
    supply: Int as int128;
    borrow: Int as int128;
    asCollateral: Bool;
}

struct UserAccountData {
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
            let newBorrow: Int = currentTokenData.borrow + position.borrow;
            let updatedTokenData: TokenData = TokenData{
                supply: currentTokenData.supply + position.supply,
                borrow: newBorrow > 0 ? newBorrow : 0,
                asCollateral: currentTokenData.asCollateral
            };
            self.positionsDetail.set(position.address, updatedTokenData);
        }
    }

    receive(msg: UpdatePosition) {
        self.requireMaster();
        self.processUpdatePosition(msg);
        // TODO: consider return the updated position data?
        send(SendParameters{
            to: self.master,
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: UserPositionUpdated{
                user: self.owner,
                asset: msg.address,
                supply: msg.supply,
                borrow: msg.borrow
            }.toCell()
        });
    }

    receive(msg: GetUserAccountData) {
        self.requireMaster();
        send(SendParameters{
            to: context().sender,
            value: 0,
            mode: SendRemainingValue,
            bounce: false,
            body: UserAccountDataResponse{
                queryId: msg.queryId,
                user: msg.user,
                tokenAddress: msg.tokenAddress,
                action: msg.action,
                amount: msg.amount,
                accountData: UserAccountData{
                    positions: self.positions,
                    positionsLength: self.positionsLength,
                    positionsDetail: self.positionsDetail
                }
            }.toCell()
        });
    }

    get fun account(): UserAccountData {
        return UserAccountData{
            positions: self.positions,
            positionsLength: self.positionsLength,
            positionsDetail: self.positionsDetail
        };
    }
}
