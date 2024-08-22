import "@stdlib/ownable";
import "@stdlib/deploy";
import "@stdlib/stoppable";
import "../jetton/messages";
import "./time-vesting";
struct TimeVestingMasterData {
    owner: Address;
    stopped: Bool;
    tayWallet: Address?;
    vestingPeriod: Int as uint32;
}
message SetTayWallet {
    tayWallet: Address;
}
message SetVestingPeriod {
    vestingPeriod: Int;
}

contract TimeVestingMaster with Ownable, Deployable, Resumable {
    override const storageReserve: Int = ton("0.005");
    owner: Address;
    stopped: Bool;
    // self TAY jetton wallet address
    tayWallet: Address?;
    // 90 days 90 * 24 * 60 * 60
    vestingPeriod: Int as uint32 = 7776000;
    // totalLocked
    totalLocked: Int as coins = 0;
    init(){
        self.owner = sender();
        self.stopped = false;
    }

    // ====== Received Messages ====== //

    receive(msg: TokenNotification){
        self.processTokenNotification(msg);
    }

    receive(msg: LockClaimed){
        self.requireFromUserTimeVesting(msg.user);
        self.sendTayTokenTransfer(msg);
    }

    receive(msg: SetTayWallet){
        self.requireOwner();
        self.tayWallet = msg.tayWallet;
        self.reply("SetTayWallet successfully".asComment());
    }

    receive(msg: SetVestingPeriod){
        self.requireOwner();
        self.vestingPeriod = msg.vestingPeriod;
        self.reply("SetVestingPeriod successfully".asComment());
    }

    receive(msg: TokenExcesses){}

    // ====== Internal Methods ====== //

    fun processTokenNotification(msg: TokenNotification) {
        let opCode: Int = msg.forward_payload.loadUint(32);
        let user: Address = msg.forward_payload.loadAddress();
        // utils.calculateRequestOpcode_1("AddLock")
        if (opCode == 0x63ed65e && sender() == self.tayWallet!!) {
            let userTimeVestingInit: StateInit = self.userTimeVestingInit(user);
            self.totalLocked += msg.amount;
            self.forward(contractAddress(userTimeVestingInit),
                AddLock{user: user, amount: msg.amount, releaseTime: now() + self.vestingPeriod}.toCell(),
                false,
                userTimeVestingInit
            );
        }
    }

    fun sendTayTokenTransfer(msg: LockClaimed) {
        // pre-check Tay balance of myAddress()
        self.totalLocked -= msg.amount;
        self.forward(self.tayWallet!!,
            TokenTransfer{
                queryId: 0,
                amount: msg.amount,
                destination: msg.user,
                response_destination: msg.user,
                custom_payload: null,
                forward_ton_amount: 0,
                forward_payload: emptySlice()
            }.toCell(),
            false,
            null
        );
    }

    fun requireFromUserTimeVesting(user: Address) {
        let userTimeVesting: Address = self.userTimeVestingAddress(user);
        require(sender() == userTimeVesting, "Not from user TimeVesting");
    }

    // ====== Get Methods ====== //

    get fun userTimeVestingInit(owner: Address): StateInit {
        return initOf TimeVesting(myAddress(), owner);
    }

    get fun userTimeVestingAddress(owner: Address): Address {
        return contractAddress(self.userTimeVestingInit(owner));
    }

    get fun timeVestingMasterData(): TimeVestingMasterData {
        return
            TimeVestingMasterData{
                owner: self.owner,
                stopped: self.stopped,
                tayWallet: self.tayWallet,
                vestingPeriod: self.vestingPeriod
            };
    }
}