import "@stdlib/deploy";
import "./types/message";
import "./constants";

contract UserAccount with Deployable {
    const MIN_TONS_FOR_STORAGE: Int = ton("0.01");
    const GAS_CONSUMPTION: Int = ton("0.01");

    owner: Address;
    master: Address;

    positions: map<Int, Address>;
    positionsLength: Int as uint16 = 0;
    positionsDetail: map<Address, TokenData>;

    init(master: Address, owner: Address) {
        self.owner = owner;
        self.master = master;
    }

    receive(msg: SetUserReserveAsCollateral) {
        self.requireOwner();
        
        let _tokenData: TokenData? = self.positionsDetail.get(msg.reserve);
        require(_tokenData != null && _tokenData!!.supply > 0, "No supply position for this reserve");
        let tokenData: TokenData = _tokenData!!;
        if (tokenData.asCollateral == msg.asCollateral) {
            self.cashback("SetUserReserveAsCollateral skip");
            return;
        }
        
        if (msg.asCollateral == true) {
            tokenData.asCollateral = true;
            self.positionsDetail.set(msg.reserve, tokenData);
            self.cashback("SetUserReserveAsCollateral successfully");
        } else {
            let positionDetail: map<Address, TokenData> = self.positionsDetail;
            tokenData.asCollateral = false;
            positionDetail.set(msg.reserve, tokenData);
            
            let ctx: Context = context();
            let msgValue: Int = self.msgValue(ctx.value) - ctx.readForwardFee();
            send(SendParameters{
                to: self.master,
                value: msgValue,
                mode: SendPayGasSeparately,
                bounce: false,
                body: UserAccountDataResponse{
                    queryId: 0,
                    user: self.owner,
                    tokenAddress: msg.reserve,
                    action: ACTION_SET_USER_RESERVE_NOT_AS_COLLATERAL,
                    amount: 0,
                    accountData: UserAccountData{
                        positions: self.positions,
                        positionsLength: self.positionsLength,
                        positionsDetail: positionDetail
                    },
                    payload: emptySlice()
                }.toCell()
            });
        }
    }

    receive(msg: SetUserReserveNotAsCollateralFromPool) {
        self.requireMaster();
        
        let tokenData: TokenData = self.positionsDetail.get(msg.reserve)!!;
        tokenData.asCollateral = false;
        self.positionsDetail.set(msg.reserve, tokenData);
        self.cashback("SetUserReserveNotAsCollateral successfully");
    }

    receive(msg: UpdatePosition) {
        self.requireMaster();
        self.processUpdatePosition(msg);
        let ctx: Context = context();
        let msgValue: Int = self.msgValue(ctx.value) - ctx.readForwardFee();
        send(SendParameters{
            to: self.master,
            value: msgValue,
            mode: SendPayGasSeparately,
            bounce: true,
            body: UserPositionUpdated{
                queryId: msg.queryId,
                user: self.owner,
                asset: msg.address,
                supply: msg.supply,
                borrow: msg.borrow
            }.toCell()
        });
    }

    receive(msg: GetUserAccountData) {
        self.requireMaster();
        let ctx: Context = context();
        let msgValue: Int = self.msgValue(ctx.value) - ctx.readForwardFee();
        send(SendParameters{
            to: context().sender,
            value: msgValue,
            mode: SendPayGasSeparately,
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
                },
                payload: msg.payload
            }.toCell()
        });
    }

    fun msgValue(value: Int): Int {
        let msgValue: Int = value;
        let tonBalanceBeforeMsg: Int = myBalance() - msgValue;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE - min(tonBalanceBeforeMsg, self.MIN_TONS_FOR_STORAGE);
        msgValue = msgValue - (storageFee + self.GAS_CONSUMPTION);
        return msgValue;
    }

    fun requireMaster() {
        require(context().sender == self.master, "Invalid sender, not master");
    }

    fun requireOwner() {
        require(context().sender == self.owner, "Invalid sender, not owner");
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

    fun cashback(comment: String) {
        self.forward(self.owner, comment.asComment(), false, null);
    }

    get fun account(): UserAccountData {
        return UserAccountData{
            positions: self.positions,
            positionsLength: self.positionsLength,
            positionsDetail: self.positionsDetail
        };
    }
}
