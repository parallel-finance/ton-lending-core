import "@stdlib/ownable";
import "@stdlib/deploy";
import "@stdlib/stoppable";
import "./atoken-wallet";
import "../abtoken-messages";
import "../types";
@interface("org.ton.jetton.master")
trait ATokenJettonTrait with Ownable, Deployable, Resumable {
    owner: Address; // PoolAddress
    stopped: Bool;
    totalSupply: Int;
    mintable: Bool;
    content: Cell;
    asset: Address; // atoken underlying asset

    // ACL: onlyPool
    receive(msg: TokenUpdateContent){
        self.requireOwner();
        self.content = msg.content;
    }

    // ACL: onlyPool
    receive(msg: TokenBurnNotification){
        self.requireNotStopped();
        self.requireWallet(msg.owner);
        self.totalSupply = (self.totalSupply - msg.amount);
        if (msg.response_destination != null) {
            // Cashback
            send(SendParameters{
                    to: msg.response_destination!!,
                    value: 0,
                    bounce: false,
                    mode: (SendRemainingValue + SendIgnoreErrors),
                    body: TokenExcesses{queryId: msg.queryId}.toCell()
                }
            );
        }
    }

    // @to The Address receive the Jetton token after minting
    // @amount The amount of Jetton token being minted
    // @response_destination The previous owner address
    fun mint(queryId: Int, to: Address, amount: Int, response_destination: Address) {
        self.totalSupply = (self.totalSupply + amount); // Update total supply

        let winit: StateInit = self.getJettonWalletInit(to); // Create message
        send(SendParameters{
                to: contractAddress(winit),
                value: 0,
                bounce: false,
                mode: SendRemainingValue,
                body: TokenTransferInternal{
                    queryId: queryId,
                    amount: amount,
                    from: myAddress(),
                    response_destination: response_destination,
                    forward_ton_amount: 0,
                    forward_payload: emptySlice()
                }.toCell(),
                code: winit.code,
                data: winit.data
            }
        );
    }

    fun requireWallet(owner: Address) {
        let ctx: Context = context();
        let winit: StateInit = self.getJettonWalletInit(owner);
        require(contractAddress(winit) == ctx.sender, "Invalid sender");
    }

    virtual fun getJettonWalletInit(address: Address): StateInit {
        // (master,pool,asset,user)
        return initOf ATokenDefaultWallet(myAddress(), self.owner, self.asset, address);
    }

    // ====== Get Methods ====== //

    get fun get_jetton_data(): JettonData {
        let code: Cell = self.getJettonWalletInit(myAddress()).code;
        return
            JettonData{
                totalSupply: self.totalSupply,
                mintable: self.mintable,
                owner: self.owner,
                content: self.content,
                walletCode: code
            };
    }

    get fun get_wallet_address(owner: Address): Address {
        let winit: StateInit = self.getJettonWalletInit(owner);
        return contractAddress(winit);
    }
}
