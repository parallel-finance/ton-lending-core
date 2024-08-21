import "@stdlib/ownable";
import "@stdlib/deploy";
import "@stdlib/stoppable";
import "../jetton/messages";
import "../types/message";
import "./message";

contract ClaimHelper with Ownable, Deployable, Resumable {
    const MIN_TONS_FOR_STORAGE: Int = ton("0.03");
    const TOKEN_CLAIM_GAS_CONSUMPTION: Int = ton("0.05");
    const PROCESS_NOTIFICATION_GAS_CONSUMPTION: Int = ton("0.05");
    owner: Address;
    stopped: Bool;
    jettonMasterAddess: Address;
    jettonWalletAddess: Address;
    vaultAddress: Address;

    init(jettonMasterAddess: Address, vaultAddress: Address){
        self.jettonMasterAddess = jettonMasterAddess;
        self.vaultAddress = vaultAddress;
        self.stopped = true;
        // should be reset after deployment
        self.jettonWalletAddess = myAddress();
        self.owner = sender();
    }

    receive(msg: ResetJettonWalletAddress) {
        self.requireOwner();
        self.jettonWalletAddess = msg.newAddress;
        // could also be reset by calling 'Resume'
        self.stopped = false;
    }

    receive(msg: TransferNotification){
        let ctx: Context = context();
        require(ctx.sender == self.jettonWalletAddess, "Invalid sender");
        let fwdFee: Int = ctx.readForwardFee() * 5;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE;
        let computationAndActionFee: Int = self.TOKEN_CLAIM_GAS_CONSUMPTION + self.PROCESS_NOTIFICATION_GAS_CONSUMPTION;
        let totalFee: Int = (fwdFee + storageFee) + computationAndActionFee;
        require(ctx.value > totalFee, "Insufficient fee");

        // let forwardPayload: Slice = msg.forward_payload;
        // let opCode: Int = forwardPayload.loadUint(32);
        // "ClaimReward"c
        // if (opCode == 0x7994ff68) {
        let claimAmount: Int = msg.amount;
        require(claimAmount > 0, "claim zero amount");
        let selfConsumption: Int = self.PROCESS_NOTIFICATION_GAS_CONSUMPTION + ctx.readForwardFee();
        let remainingMsgValue: Int = self.remainingValue(ctx.value, selfConsumption);
        send(SendParameters{
                to: self.vaultAddress,
                value: remainingMsgValue,
                bounce: true,
                mode: SendPayGasSeparately,
                body: ClaimTargetJetton{
                    jettonAddress: self.jettonMasterAddess,
                    owner: msg.from,
                    amount: claimAmount
                }.toCell()
            }
        );
        // }
        return;
    }

    fun remainingValue(value: Int, selfConsumption: Int): Int {
        let msgValue: Int = value;
        let tonBalanceBeforeMsg: Int = myBalance() - msgValue;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE - min(tonBalanceBeforeMsg, self.MIN_TONS_FOR_STORAGE);
        msgValue = msgValue - (storageFee + selfConsumption);
        return msgValue;
    }

    // fun getJettonWalletInit(address: Address): StateInit {
    // FunC implemented jetton wallet could not invoke initOf() func
    // }
}