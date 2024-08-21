import "@stdlib/ownable";
import "@stdlib/deploy";
import "@stdlib/stoppable";
import "../jetton/messages";
import "../types/message";
import "./message";
import "./struct.tact";

contract JettonVault with Ownable, Deployable, Resumable {
    const MIN_TONS_FOR_STORAGE: Int = ton("0.03");
    const TOKEN_TRANSFER_GAS_CONSUMPTION: Int = ton("0.05");
    const TOKEN_CLAIM_GAS_CONSUMPTION: Int = ton("0.05");
    const PROCESS_NOTIFICATION_GAS_CONSUMPTION: Int = ton("0.05");
    owner: Address;
    stopped: Bool;
    jettonWalletAddess: Address;
    claimableJettonMapping: map<Address, ClaimableJettonConfiguration>;
    jettonMappingLength: Int = 0;
    queryId: Int = 0;
    init(){
        self.owner = sender();
        self.stopped = true;
        // should be reset after deployment
        self.jettonWalletAddess = myAddress();
    }

    receive(msg: ResetJettonWalletAddress) {
        self.requireOwner();
        self.jettonWalletAddess = msg.newAddress;
        // could also be reset by calling 'Resume'
        self.stopped = false;
    }

    receive(msg: ConfigureJettonMapping){
        self.requireOwner();
        let existedClaimableJettonAddress: ClaimableJettonConfiguration? = self.claimableJettonMapping.get(msg.originJettonAddress);
        require(existedClaimableJettonAddress == null, "Claimable Jetton already configured");
        self.claimableJettonMapping.set(msg.originJettonAddress, ClaimableJettonConfiguration {
            jettonAddress: msg.claimableJettonAddress,
            claimHelper: msg.claimHelper,
        });
        self.jettonMappingLength += 1;
        self.reply("JettonMapping Configured".asComment());
    }

    receive(msg: DropJettonMapping){
        self.requireOwner();
        let existedClaimableJettonAddress: ClaimableJettonConfiguration? = self.claimableJettonMapping.get(msg.originJettonAddress);
        require(existedClaimableJettonAddress != null, "Claimable Jetton not configured");
        self.claimableJettonMapping.del(msg.originJettonAddress);
        self.jettonMappingLength += 1;
        self.reply("JettonMapping Dropped".asComment());
    }

    receive(msg: ClaimTargetJetton){
        let ctx: Context = context();
        let mapping: ClaimableJettonConfiguration? = self.claimableJettonMapping.get(msg.jettonAddress);
        require(mapping != null, "Invalid jetton address");
        // let claimableJettonAddress: Address = mapping!!.jettonAddress;
        let claimHelper: Address = mapping!!.claimHelper;
        require(ctx.sender == claimHelper, "Invalid sender");

        let fwdFee: Int = ctx.readForwardFee() * 5;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE;
        let computationAndActionFee: Int = self.TOKEN_CLAIM_GAS_CONSUMPTION + self.PROCESS_NOTIFICATION_GAS_CONSUMPTION;
        let totalFee: Int = (fwdFee + storageFee) + computationAndActionFee;
        require(ctx.value > totalFee, "Insufficient fee");

        let selfConsumption: Int = self.PROCESS_NOTIFICATION_GAS_CONSUMPTION + ctx.readForwardFee();
        let remainingMsgValue: Int = self.remainingValue(ctx.value, selfConsumption);
        self.sendTokenTransferByVault(msg.owner, msg.amount);
        return;
    }

    fun sendTokenTransferByVault(toAddress: Address, amount: Int) {
        let tokenTransferMsg: TokenTransfer = TokenTransfer{
            queryId: self.queryId,
            amount: amount,
            destination: toAddress,
            response_destination: toAddress,
            custom_payload: null,
            forward_ton_amount: 0,
            forward_payload: emptySlice()
        };
        self.queryId += 1;

        send(SendParameters{
            to: self.jettonWalletAddess,
            value: self.TOKEN_TRANSFER_GAS_CONSUMPTION,
            bounce: true,
            mode: SendPayGasSeparately,
            body: tokenTransferMsg.toCell()
        });
    }

    get fun allClaimableJettonMapping(): map<Address, ClaimableJettonConfiguration> {
        return self.claimableJettonMapping;
    }

    fun remainingValue(value: Int, selfConsumption: Int): Int {
        let msgValue: Int = value;
        let tonBalanceBeforeMsg: Int = myBalance() - msgValue;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE - min(tonBalanceBeforeMsg, self.MIN_TONS_FOR_STORAGE);
        msgValue = msgValue - (storageFee + selfConsumption);
        return msgValue;
    }
}