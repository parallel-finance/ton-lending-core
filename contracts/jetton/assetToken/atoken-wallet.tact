import "../messages";
import "../types";

@interface("org.ton.jetton.wallet")
contract ATokenDefaultWallet
{
    const minTonsForStorage: Int = ton("0.01");
    const gasConsumption: Int = ton("0.01");
    balance: Int;
    owner: Address;
    master: Address;
    pool: Address; // pool address
    asset: Address; // underyingAsset
    init(master: Address, pool: Address, asset: Address, owner: Address){
        self.balance = 0;
        self.owner = owner;
        self.master = master;
        self.pool = pool;
        self.asset = asset;
    }

    fun getJettonWalletInit(address: Address): StateInit {
        // (master,pool,asset,user)
        return initOf ATokenDefaultWallet(self.master, self.pool, self.asset, address);
    }

    // ACL: onlyPool

    receive(msg: TokenTransferByPool){
        // Check sender
        let ctx: Context = context();
        require(ctx.sender == self.pool, "Invalid sender");
        let tokenTransferMsg: TokenTransfer = TokenTransfer.fromCell(msg.payload.loadRef());
        // Gas checks
        let fwdFee: Int = (ctx.readForwardFee() + ctx.readForwardFee());
        let final: Int = ((2 * self.gasConsumption + self.minTonsForStorage) + fwdFee);
        require(ctx.value > min(final, ton("0.01")), "Invalid value!!");
        // Update balance
        self.balance = (self.balance - tokenTransferMsg.amount);
        require(self.balance >= 0, "Invalid balance");
        let init: StateInit = self.getJettonWalletInit(tokenTransferMsg.destination);
        let walletAddress: Address = contractAddress(init);
        send(SendParameters{
                to: walletAddress,
                value: 0,
                mode: SendRemainingValue,
                bounce: false,
                body: TokenTransferInternal{
                    queryId: tokenTransferMsg.queryId,
                    amount: tokenTransferMsg.amount,
                    from: self.owner,
                    response_destination: tokenTransferMsg.response_destination,
                    forward_ton_amount: tokenTransferMsg.forward_ton_amount,
                    forward_payload: tokenTransferMsg.forward_payload
                }.toCell(),
                code: init.code,
                data: init.data
            }
        );
    }

    // FromWallet.TokenTransfer -> Pool.CheckAndTransferAToken -> FromWallet.TokenTransferByPool -> ToWallet.TokenTransferInternal
    receive(msg: TokenTransfer){
        // 0xf8a7ea5
        let ctx: Context = context(); // Check sender
        require(ctx.sender == self.owner, "Invalid sender");
        // TODO: Gas checks
        // check balance
        require(self.balance >= msg.amount, "Invalid balance");
        let tokenTransferMsg: TokenTransfer = TokenTransfer{
            queryId: msg.queryId,
            amount: msg.amount,
            destination: msg.destination,
            response_destination: msg.response_destination,
            custom_payload: msg.custom_payload,
            forward_ton_amount: msg.forward_ton_amount,
            forward_payload: msg.forward_payload
        };
        send(SendParameters{
                to: self.pool,
                value: 0,
                mode: SendRemainingValue,
                bounce: false,
                body: CheckAndTransferAToken{
                    asset: self.asset,
                    from: ctx.sender,
                    amount: msg.amount,
                    payload: beginCell().storeRef(tokenTransferMsg.toCell()).asSlice()
                }.toCell()
            }
        );
    }

    receive(msg: TokenTransferInternal){
        // 0x178d4519
        let ctx: Context = context();
        if (ctx.sender != self.master) {
            let sinit: StateInit = self.getJettonWalletInit(msg.from);
            require(contractAddress(sinit) == ctx.sender, "Invalid sender!");
        }
        // Update balance
        self.balance = (self.balance + msg.amount);
        require(self.balance >= 0, "Invalid balance");
        // Get value for gas
        let msgValue: Int = self.msgValue(ctx.value);
        let fwdFee: Int = ctx.readForwardFee();
        msgValue = ((msgValue - msg.forward_ton_amount) - fwdFee);
        // 0x7362d09c - notify the new owner of JettonToken that the transfer is complete
        if (msg.forward_ton_amount > 0) {
            send(SendParameters{
                    to: self.owner,
                    value: msg.forward_ton_amount,
                    mode: (SendPayGasSeparately + SendIgnoreErrors),
                    bounce: false,
                    body: TokenNotification{
                        queryId: msg.queryId,
                        amount: msg.amount,
                        from: msg.from,
                        forward_payload: msg.forward_payload
                    }.toCell()
                }
            );
        }
        // 0xd53276db -- Cashback to the original Sender
        if (msg.response_destination != null) {
            send(SendParameters{
                    to: msg.response_destination,
                    value: msgValue,
                    bounce: false,
                    body: TokenExcesses{queryId: msg.queryId}.toCell(),
                    mode: SendIgnoreErrors
                }
            );
        }
    }

    receive(msg: TokenBurn){
        let ctx: Context = context();
        require(ctx.sender == self.pool, "Invalid sender"); // Check sender

        self.balance = (self.balance - msg.amount); // Update balance
        require(self.balance >= 0, "Invalid balance");
        let fwdFee: Int = ctx.readForwardFee(); // Gas checks
        require(ctx.value > ((fwdFee + 2 * self.gasConsumption) + self.minTonsForStorage), "Invalid value - Burn");
        // Burn tokens
        send(SendParameters{
                to: self.master,
                value: 0,
                mode: SendRemainingValue,
                bounce: true,
                body: TokenBurnNotification{
                    queryId: msg.queryId,
                    amount: msg.amount,
                    owner: self.owner,
                    response_destination: self.owner
                }.toCell()
            }
        );
    }

    get fun msgValue(value: Int): Int {
        let msgValue: Int = value;
        let tonBalanceBeforeMsg: Int = (myBalance() - msgValue);
        let storageFee: Int = (self.minTonsForStorage - min(tonBalanceBeforeMsg, self.minTonsForStorage));
        msgValue = (msgValue - (storageFee + self.gasConsumption));
        return msgValue;
    }

    bounced(src: bounced<TokenTransferInternal>){
        self.balance = (self.balance + src.amount);
    }

    bounced(src: bounced<TokenBurnNotification>){
        self.balance = (self.balance + src.amount);
    }

    get fun get_wallet_data(): JettonWalletData {
        return
            JettonWalletData{
                balance: self.balance,
                owner: self.owner,
                master: self.master,
                walletCode: self.getJettonWalletInit(self.owner).code
            };
    }
}