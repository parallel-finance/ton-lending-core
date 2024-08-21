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
    const INITIATE_TIME_VESTING_GAS_CONSUMPTION: Int = ton("0.04");
    owner: Address;
    stopped: Bool;
    jettonWalletAddess: Address;
    claimableConfigurations: map<Address, ClaimableConfiguration>;
    claimableConfigurationLength: Int = 0;
    queryId: Int = 0;
    init(){
        self.owner = sender();
        self.stopped = true;
        // should be reset after deployment
        self.jettonWalletAddess = myAddress();
    }

    receive(msg: SetJettonWalletAddress) {
        self.requireOwner();
        self.jettonWalletAddess = msg.newAddress;
        // could also be reset by calling 'Resume'
        self.stopped = false;
    }

    receive(msg: ConfigureClaimableConfiguration){
        self.requireOwner();
        let existedClaimableAddress: ClaimableConfiguration? = self.claimableConfigurations.get(msg.originJettonAddress);
        // require(existedClaimableAddress == null, "Claimable Jetton already configured");
        self.claimableConfigurations.set(msg.originJettonAddress, ClaimableConfiguration {
            jettonWalletAddress: msg.jettonWalletAddress,
            targetBeneficiary: msg.targetBeneficiary,
            claimType: msg.claimType,
            claimHelper: msg.claimHelper,
        });
        self.claimableConfigurationLength += 1;
        self.reply("ClaimableConfiguration Added".asComment());
    }

    receive(msg: DropJettonMapping){
        self.requireOwner();
        let existedClaimableConfiguration: ClaimableConfiguration? = self.claimableConfigurations.get(msg.originJettonAddress);
        require(existedClaimableConfiguration != null, "Claimable Jetton not configured");
        self.claimableConfigurations.del(msg.originJettonAddress);
        self.claimableConfigurationLength -= 1;
        self.reply("ClaimableConfiguration Dropped".asComment());
    }

    receive(msg: ClaimTargetJetton){
        let ctx: Context = context();
        let config: ClaimableConfiguration? = self.claimableConfigurations.get(msg.jettonAddress);
        require(config != null, "Invalid jetton address");
        let jettonWalletAddress: Address = config!!.jettonWalletAddress;
        require(ctx.sender == config!!.claimHelper, "Invalid sender");

        let fwdFee: Int = ctx.readForwardFee() * 5;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE;
        let computationAndActionFee: Int = self.TOKEN_CLAIM_GAS_CONSUMPTION + self.PROCESS_NOTIFICATION_GAS_CONSUMPTION;
        let totalFee: Int = (fwdFee + storageFee) + computationAndActionFee;
        require(ctx.value > totalFee, "Insufficient fee");

        let selfConsumption: Int = self.PROCESS_NOTIFICATION_GAS_CONSUMPTION + ctx.readForwardFee();
        let remainingMsgValue: Int = self.remainingValue(ctx.value, selfConsumption);

        let claimType: Int = config!!.claimType;
        if (claimType == 0) {
            self.sendJettonTransferViaVault(jettonWalletAddress, msg.owner, msg.amount);
        }
        if (claimType == 1) {
            self.initiateTimeVestingViaVault(jettonWalletAddress, config!!.targetBeneficiary, msg.owner, msg.amount);
        }
    }

    fun sendJettonTransferViaVault(jettonWalletAddress: Address, toAddress: Address, amount: Int) {
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
            to: jettonWalletAddress,
            value: self.TOKEN_TRANSFER_GAS_CONSUMPTION,
            bounce: true,
            mode: SendPayGasSeparately,
            body: tokenTransferMsg.toCell()
        });
    }

    fun initiateTimeVestingViaVault(jettonWalletAddress: Address, toAddress: Address, owner: Address, amount: Int) {
        let tokenTransferMsg: TokenTransfer = TokenTransfer{
            queryId: self.queryId,
            amount: amount,
            destination: toAddress,
            response_destination: toAddress,
            custom_payload: null,
            forward_ton_amount: self.INITIATE_TIME_VESTING_GAS_CONSUMPTION,
            forward_payload: beginCell().storeUint(0x63ed65e, 32).endCell().asSlice()
        };
        self.queryId += 1;

        send(SendParameters{
            to: jettonWalletAddress,
            value: self.TOKEN_TRANSFER_GAS_CONSUMPTION,
            bounce: true,
            mode: SendPayGasSeparately,
            body: tokenTransferMsg.toCell()
        });
    }

    get fun allClaimableJettonMapping(): map<Address, ClaimableConfiguration> {
        return self.claimableConfigurations;
    }

    fun remainingValue(value: Int, selfConsumption: Int): Int {
        let msgValue: Int = value;
        let tonBalanceBeforeMsg: Int = myBalance() - msgValue;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE - min(tonBalanceBeforeMsg, self.MIN_TONS_FOR_STORAGE);
        msgValue = msgValue - (storageFee + selfConsumption);
        return msgValue;
    }
}